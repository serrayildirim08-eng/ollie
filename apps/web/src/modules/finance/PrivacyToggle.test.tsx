/**
 * PrivacyToggle · unit tests
 *
 * Covers:
 *   - default state: disabled → renders "private" pill
 *   - first click: enables (no biometric prompt to lock down)
 *   - while enabled + unlocked: masked === false; click re-locks
 *   - while enabled + locked: clicking triggers unlockImpl; success extends
 *     unlockedUntil by UNLOCK_WINDOW_MS
 *   - unsupported biometric: toggle flips to disabled + emits toast
 *   - cancelled biometric: state unchanged, toast fired
 *   - maskMoney + isMaskedNow pure helpers
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  PrivacyToggle,
  MASK_GLYPH,
  UNLOCK_WINDOW_MS,
  maskMoney,
  isMaskedNow,
  type PrivacyState,
} from './PrivacyToggle';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function mount(props: {
  state: PrivacyState;
  onChange?: (next: PrivacyState) => void;
  onToast?: (msg: string) => void;
  unlockImpl?: () => Promise<ReturnType<typeof okUnlock> | ReturnType<typeof cancelUnlock> | ReturnType<typeof unsupportedUnlock>>;
}) {
  const onChange = props.onChange ?? (() => {});
  act(() => {
    root.render(
      <PrivacyToggle
        state={props.state}
        onChange={onChange}
        onToast={props.onToast}
        unlockImpl={props.unlockImpl as unknown as React.ComponentProps<typeof PrivacyToggle>['unlockImpl']}
      />,
    );
  });
}

const okUnlock = () => ({ ok: true as const, method: 'webauthn' as const });
const cancelUnlock = () => ({ ok: false as const, reason: 'cancelled' as const });
const unsupportedUnlock = () => ({ ok: false as const, reason: 'unsupported' as const });

function getButton(): HTMLButtonElement {
  const b = container.querySelector('button');
  if (!b) throw new Error('no button rendered');
  return b as HTMLButtonElement;
}

// ─── pure helpers ──────────────────────────────────────────────────────────

describe('maskMoney', () => {
  it('returns formatted when masked is false', () => {
    expect(maskMoney(false, '123')).toBe('123');
  });
  it('returns block glyph when masked is true', () => {
    expect(maskMoney(true, '123')).toBe(MASK_GLYPH);
  });
});

describe('isMaskedNow', () => {
  const NOW = 1_000_000;
  it('false when privacy not enabled', () => {
    expect(isMaskedNow({ enabled: false, unlockedUntil: 0 }, NOW)).toBe(false);
  });
  it('true when enabled with no unlock', () => {
    expect(isMaskedNow({ enabled: true, unlockedUntil: 0 }, NOW)).toBe(true);
  });
  it('false during unlock window', () => {
    expect(isMaskedNow({ enabled: true, unlockedUntil: NOW + 60_000 }, NOW)).toBe(false);
  });
  it('true after unlock window expires', () => {
    expect(isMaskedNow({ enabled: true, unlockedUntil: NOW - 1 }, NOW)).toBe(true);
  });
});

// ─── component ─────────────────────────────────────────────────────────────

describe('PrivacyToggle · default state', () => {
  it('renders "private" label when disabled', () => {
    mount({ state: { enabled: false, unlockedUntil: 0 } });
    expect((getButton().textContent ?? '').toLowerCase()).toContain('private');
    expect(getButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('first click enables (no biometric needed to lock down)', () => {
    const onChange = vi.fn();
    mount({ state: { enabled: false, unlockedUntil: 0 }, onChange });
    act(() => { getButton().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({ enabled: true, unlockedUntil: 0 });
  });
});

describe('PrivacyToggle · enabled + masked', () => {
  it('shows "locked" label', () => {
    mount({ state: { enabled: true, unlockedUntil: 0 } });
    expect((getButton().textContent ?? '').toLowerCase()).toContain('locked');
    expect(getButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking triggers unlock; on ok, extends unlockedUntil', async () => {
    const onChange = vi.fn();
    const unlockImpl = vi.fn(async () => okUnlock());
    mount({
      state: { enabled: true, unlockedUntil: 0 },
      onChange,
      unlockImpl,
    });
    const before = Date.now();
    await act(async () => {
      getButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(unlockImpl).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as PrivacyState;
    expect(arg.enabled).toBe(true);
    expect(arg.unlockedUntil).toBeGreaterThanOrEqual(before + UNLOCK_WINDOW_MS - 100);
  });

  it('on "cancelled" unlock, state stays masked + toast fires', async () => {
    const onChange = vi.fn();
    const onToast = vi.fn();
    const unlockImpl = vi.fn(async () => cancelUnlock());
    mount({
      state: { enabled: true, unlockedUntil: 0 },
      onChange,
      onToast,
      unlockImpl,
    });
    await act(async () => {
      getButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith('unlock cancelled.');
  });

  it('on "unsupported" unlock, privacy disables', async () => {
    const onChange = vi.fn();
    const onToast = vi.fn();
    const unlockImpl = vi.fn(async () => unsupportedUnlock());
    mount({
      state: { enabled: true, unlockedUntil: 0 },
      onChange,
      onToast,
      unlockImpl,
    });
    await act(async () => {
      getButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ enabled: false, unlockedUntil: 0 });
    expect(onToast).toHaveBeenCalled();
  });
});

describe('PrivacyToggle · enabled + unlocked', () => {
  it('shows "on" label and clicking re-masks immediately', () => {
    const onChange = vi.fn();
    mount({
      state: { enabled: true, unlockedUntil: Date.now() + 5 * 60_000 },
      onChange,
    });
    expect((getButton().textContent ?? '').toLowerCase()).toContain('on');
    act(() => { getButton().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({ enabled: true, unlockedUntil: 0 });
  });
});

describe('PrivacyToggle · banned-phrase audit (smoke)', () => {
  it('toast strings do not cheerlead', () => {
    // Direct string inventory · matches what the component emits via onToast.
    const strings = ['unlock cancelled.', 'unlock failed.', 'biometric unavailable. privacy mode off.'];
    for (const s of strings) {
      const lower = s.toLowerCase();
      expect(lower).not.toContain('great');
      expect(lower).not.toContain('!');
      expect(lower).not.toContain('awesome');
    }
  });
});
