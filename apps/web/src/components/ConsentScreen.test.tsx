/**
 * ConsentScreen · unit tests
 *
 * Covers the consent-rewrite invariants:
 *   - necessary toggle defaults OFF
 *   - marketing toggle defaults ON
 *   - necessary is one-way: once ON, clicking again does NOT flip back
 *   - continue button is disabled until necessary === true
 *   - on continue, the store receives consent.necessary=true and the
 *     marketing value the user landed on
 *
 * Renders into a real DOM via react-dom (jsdom env per vitest.config.ts),
 * matching how the rest of the codebase runs without a React-testing-
 * library dependency.
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

// React 18 needs this flag set for act() to suppress the "not
// configured to support act" warning in jsdom. Vitest's jsdom env
// otherwise looks like a browser to React.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the store BEFORE the component is imported.
vi.mock('../store', () => {
  const data = new Map<string, unknown>();
  return {
    store: {
      set: vi.fn((mod: string, key: string, value: unknown) => {
        data.set(`${mod}:${key}`, value);
      }),
      get: vi.fn((mod: string, key: string, fallback: unknown) => {
        const k = `${mod}:${key}`;
        return data.has(k) ? data.get(k) : fallback;
      }),
      __data: data,
    },
  };
});

import { ConsentScreen } from './ConsentScreen';
import { store } from '../store';

let container: HTMLDivElement;
let root: Root;

function mount(onContinue: () => void = () => {}): void {
  act(() => {
    root.render(<ConsentScreen onContinue={onContinue} />);
  });
}

function getToggle(label: string): HTMLButtonElement {
  const el = container.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`toggle "${label}" not found`);
  return el as HTMLButtonElement;
}

function getContinue(): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  const found = buttons.find((b) => (b.textContent ?? '').trim().toLowerCase() === 'continue');
  if (!found) throw new Error('continue button not found');
  return found;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  // Reset store state between tests.
  (store as unknown as { __data: Map<string, unknown> }).__data.clear();
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('ConsentScreen · defaults', () => {
  it('marketing toggle defaults to ON', () => {
    mount();
    const marketing = getToggle('marketing cookies');
    expect(marketing.getAttribute('aria-checked')).toBe('true');
  });

  it('necessary toggle defaults to OFF', () => {
    mount();
    const necessary = getToggle('necessary opt-in');
    expect(necessary.getAttribute('aria-checked')).toBe('false');
  });
});

describe('ConsentScreen · continue gating', () => {
  it('continue is disabled when necessary is OFF', () => {
    mount();
    const cont = getContinue();
    expect(cont.disabled).toBe(true);
  });

  it('continue becomes enabled after necessary is flipped ON', () => {
    mount();
    click(getToggle('necessary opt-in'));
    const cont = getContinue();
    expect(cont.disabled).toBe(false);
  });

  it('calls onContinue only after necessary is ON', () => {
    const onContinue = vi.fn();
    mount(onContinue);
    click(getContinue());
    expect(onContinue).not.toHaveBeenCalled();

    click(getToggle('necessary opt-in'));
    click(getContinue());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('ConsentScreen · necessary is one-way', () => {
  it('clicking necessary while ON does NOT flip back OFF', () => {
    mount();
    const necessary = getToggle('necessary opt-in');

    click(necessary);
    expect(necessary.getAttribute('aria-checked')).toBe('true');

    // Try to turn it off — should be a no-op.
    click(necessary);
    expect(necessary.getAttribute('aria-checked')).toBe('true');
  });

  it('once ON, necessary is marked aria-disabled', () => {
    mount();
    const necessary = getToggle('necessary opt-in');
    expect(necessary.getAttribute('aria-disabled')).toBeNull();

    click(necessary);
    expect(necessary.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('ConsentScreen · marketing toggle is bidirectional', () => {
  it('can be turned OFF then back ON', () => {
    mount();
    const marketing = getToggle('marketing cookies');
    expect(marketing.getAttribute('aria-checked')).toBe('true');

    click(marketing);
    expect(marketing.getAttribute('aria-checked')).toBe('false');

    click(marketing);
    expect(marketing.getAttribute('aria-checked')).toBe('true');
  });
});

describe('ConsentScreen · store writes', () => {
  // Görev 1 (2026-05-15): ConsentScreen now persists to the canonical
  // @ollie/consent `consent.state` row (module 'consent', key 'state')
  // via setMarketingConsentSync / setNecessaryConsentSync — NOT the legacy
  // raw `shared.consent.*` keys.

  /** Latest payload written to the canonical consent.state row. */
  function lastConsentRow(): { necessary?: boolean; marketing?: boolean } | undefined {
    const calls = (store.set as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
      const [mod, key, value] = calls[i];
      if (mod === 'consent' && key === 'state') {
        return value as { necessary?: boolean; marketing?: boolean };
      }
    }
    return undefined;
  }

  it('writes the canonical consent row with the new marketing value on toggle', () => {
    mount();
    click(getToggle('marketing cookies'));
    expect(store.set).toHaveBeenCalledWith(
      'consent',
      'state',
      expect.objectContaining({ marketing: false, necessary: true }),
    );
    click(getToggle('marketing cookies'));
    expect(lastConsentRow()).toMatchObject({ marketing: true, necessary: true });
  });

  it('writes the canonical consent row with necessary=true on the one-way flip', () => {
    mount();
    click(getToggle('necessary opt-in'));
    expect(store.set).toHaveBeenCalledWith(
      'consent',
      'state',
      expect.objectContaining({ necessary: true }),
    );
  });

  it('on continue, persists both necessary=true and marketing to consent.state', () => {
    mount();
    // Turn marketing OFF so we can verify the value is written through.
    click(getToggle('marketing cookies'));
    click(getToggle('necessary opt-in'));
    click(getContinue());

    // Final canonical row carries both decisions.
    expect(lastConsentRow()).toMatchObject({ necessary: true, marketing: false });
  });

  it('does NOT write the consent row on a no-op click while locked', () => {
    mount();
    click(getToggle('necessary opt-in'));
    const callsAfterFirst = (store.set as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    click(getToggle('necessary opt-in'));
    const callsAfterSecond = (store.set as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});
