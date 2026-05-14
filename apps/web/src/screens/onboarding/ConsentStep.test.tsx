/**
 * ConsentStep · flow tests (Sprint B' · pivot 2026-05-14)
 *
 * Covers the acceptance contract:
 *   - new user can't proceed without explicitly tapping continue
 *   - necessary toggle is locked-ON (cannot flip off)
 *   - research toggle defaults OFF, is reversible
 *   - "what gets sent" expands the three-line detail list
 *   - on continue, setConsent() is called with the final state
 *   - on continue, consent:set event fires with the same state
 *
 * Renders via react-dom into jsdom — same pattern as ConsentScreen.test.tsx.
 */

import React, { act } from 'react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// vi.mock() is hoisted to the top of the file before any imports, so
// any module-level references inside the factory must also be hoisted.
// vi.hoisted() lets us co-locate the spies with the mocks they back.
const mocks = vi.hoisted(() => ({
  setConsentSpy: vi.fn().mockResolvedValue(undefined),
  emitSpy: vi.fn(),
}));

vi.mock('@ollie/consent', () => ({
  setConsent: mocks.setConsentSpy,
  configureConsent: vi.fn(),
  defaultConsent: vi.fn(() => ({
    necessary: true,
    marketing: false,
    research_optin: false,
    set_at: 0,
    v: 1,
  })),
  CONSENT_STORE_MODULE: 'consent',
  CONSENT_STORE_KEY: 'state',
  CONSENT_PIVOT_TS: Date.UTC(2026, 4, 14),
}));

vi.mock('@ollie/events', () => ({
  emit: mocks.emitSpy,
}));

const { setConsentSpy, emitSpy } = mocks;

import { ConsentStep } from './ConsentStep';

let container: HTMLDivElement;
let root: Root;

function mount(props?: Partial<React.ComponentProps<typeof ConsentStep>>) {
  const finalProps: React.ComponentProps<typeof ConsentStep> = {
    userId: 'user-test',
    source: 'onboarding',
    onContinue: () => {},
    ...props,
  };
  act(() => {
    root.render(<ConsentStep {...finalProps} />);
  });
}

function getToggle(label: string): HTMLButtonElement {
  const el = container.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`toggle "${label}" not found`);
  return el as HTMLButtonElement;
}

function getContinue(): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  const found = buttons.find((b) => {
    const t = (b.textContent ?? '').trim().toLowerCase();
    return t === 'continue' || t === '…';
  });
  if (!found) throw new Error('continue button not found');
  return found;
}

function getExpand(): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  const found = buttons.find((b) => /what gets sent/i.test(b.textContent ?? ''));
  if (!found) throw new Error('expand button not found');
  return found;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  setConsentSpy.mockClear();
  emitSpy.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('ConsentStep · defaults', () => {
  it('research toggle defaults to OFF', () => {
    mount();
    const research = getToggle('research');
    expect(research.getAttribute('aria-checked')).toBe('false');
  });

  it('necessary toggle is locked-ON', () => {
    mount();
    const necessary = getToggle('necessary');
    expect(necessary.getAttribute('aria-checked')).toBe('true');
    expect(necessary.getAttribute('aria-disabled')).toBe('true');
  });

  it('continue button is enabled by default (necessary is always satisfied)', () => {
    mount();
    expect(getContinue().disabled).toBe(false);
  });
});

describe('ConsentStep · research toggle is reversible', () => {
  it('can be turned ON then back OFF', () => {
    mount();
    const research = getToggle('research');
    expect(research.getAttribute('aria-checked')).toBe('false');
    click(research);
    expect(research.getAttribute('aria-checked')).toBe('true');
    click(research);
    expect(research.getAttribute('aria-checked')).toBe('false');
  });
});

describe('ConsentStep · necessary cannot be turned off', () => {
  it('click on locked necessary toggle is a no-op', () => {
    mount();
    const necessary = getToggle('necessary');
    click(necessary);
    expect(necessary.getAttribute('aria-checked')).toBe('true');
  });
});

describe('ConsentStep · "what gets sent" expansion', () => {
  it('details are hidden by default', () => {
    mount();
    expect(container.querySelector('#consent-research-details')).toBeNull();
    expect(getExpand().getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking the expand button reveals three detail lines', () => {
    mount();
    click(getExpand());
    const details = container.querySelector('#consent-research-details');
    expect(details).not.toBeNull();
    expect(getExpand().getAttribute('aria-expanded')).toBe('true');
    const items = details!.querySelectorAll('li');
    expect(items.length).toBe(3);
  });

  it('toggles closed again on second tap', () => {
    mount();
    click(getExpand());
    click(getExpand());
    expect(container.querySelector('#consent-research-details')).toBeNull();
  });
});

describe('ConsentStep · continue persistence', () => {
  it('calls setConsent with research_optin: false when toggle is OFF', async () => {
    const onContinue = vi.fn();
    mount({ onContinue });
    click(getContinue());
    await flushMicrotasks();
    await flushMicrotasks();
    expect(setConsentSpy).toHaveBeenCalledTimes(1);
    expect(setConsentSpy.mock.calls[0][0]).toBe('user-test');
    expect(setConsentSpy.mock.calls[0][1]).toMatchObject({
      necessary: true,
      research_optin: false,
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('calls setConsent with research_optin: true after the user opts in', async () => {
    const onContinue = vi.fn();
    mount({ onContinue });
    click(getToggle('research'));
    click(getContinue());
    await flushMicrotasks();
    await flushMicrotasks();
    expect(setConsentSpy.mock.calls[0][1]).toMatchObject({
      research_optin: true,
    });
  });

  it('emits consent:set with the same shape on continue', async () => {
    mount({ source: 'onboarding' });
    click(getToggle('research'));
    click(getContinue());
    await flushMicrotasks();
    await flushMicrotasks();
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0]).toBe('consent:set');
    const payload = emitSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.necessary).toBe(true);
    expect(payload.research_optin).toBe(true);
    expect(payload.source).toBe('onboarding');
    expect(typeof payload.ts).toBe('number');
  });

  it('emits consent:set with source: "reprompt" for pre-pivot users', async () => {
    mount({ source: 'reprompt' });
    click(getContinue());
    await flushMicrotasks();
    await flushMicrotasks();
    expect(emitSpy.mock.calls[0][1]).toMatchObject({ source: 'reprompt' });
  });
});

describe('ConsentStep · initial prop hydration', () => {
  it('honors initial.research_optin = true by pre-checking the toggle', () => {
    mount({ initial: { research_optin: true } });
    const research = getToggle('research');
    expect(research.getAttribute('aria-checked')).toBe('true');
  });

  it('preserves initial.marketing through to setConsent', async () => {
    mount({ initial: { marketing: true } });
    click(getContinue());
    await flushMicrotasks();
    await flushMicrotasks();
    expect(setConsentSpy.mock.calls[0][1]).toMatchObject({ marketing: true });
  });
});
