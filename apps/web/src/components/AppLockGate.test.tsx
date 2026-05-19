/**
 * AppLockGate · unit tests
 *
 * The re-entry curtain. Covers:
 *   - supported device: auto-runs biometric on mount; a pass calls
 *     onUnlocked
 *   - cancelled biometric: stays locked, "try again" CTA shown, error line
 *   - unsupported device: skips straight to the passphrase field, no
 *     dead "try again" loop
 *   - "use passphrase" link switches to the passphrase escape hatch
 *   - passphrase escape hatch: correct passphrase → onUnlocked;
 *     wrong passphrase → stays locked with an error
 *   - the user is NEVER stranded — a path out always exists
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { BiometricResult } from '../lib/biometric';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── biometric module mock ───────────────────────────────────────────────────
// isBiometricSupported is read synchronously on mount, so it has to be a
// mock we can flip per-test. `unlock` is passed in via the unlockImpl prop
// in these tests, so only isBiometricSupported needs mocking here.
let supported = true;
vi.mock('../lib/biometric', () => ({
  isBiometricSupported: () => supported,
  // `unlock` is referenced as the prop default — provide a harmless stub.
  unlock: async (): Promise<BiometricResult> => ({ ok: false, reason: 'cancelled' }),
}));

import { AppLockGate } from './AppLockGate';
import type { VaultClient } from '@ollie/auth';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  supported = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** A minimal VaultClient stub — only `unlock()` is exercised by the gate. */
function makeVault(unlockOk: boolean): VaultClient {
  return {
    state: () => ({ exists: true, unlocked: true }),
    encryptionKey: () => null,
    create: async () => ({ ok: true }),
    unlock: async () =>
      unlockOk
        ? { ok: true }
        : { ok: false, code: 'wrong-passphrase', message: 'nope' },
    lock: () => {},
    reset: () => {},
    strength: async () => ({ score: 0, band: 'weak', notes: [] }),
  } as unknown as VaultClient;
}

const okUnlock = async (): Promise<BiometricResult> => ({ ok: true, method: 'webauthn' });
const cancelUnlock = async (): Promise<BiometricResult> => ({ ok: false, reason: 'cancelled' });
const unsupportedUnlock = async (): Promise<BiometricResult> => ({
  ok: false,
  reason: 'unsupported',
});

function mount(props: {
  vault?: VaultClient | null;
  onUnlocked: () => void;
  unlockImpl?: () => Promise<BiometricResult>;
}): void {
  act(() => {
    root.render(
      <AppLockGate
        vault={props.vault === undefined ? makeVault(true) : props.vault}
        onUnlocked={props.onUnlocked}
        unlockImpl={props.unlockImpl as React.ComponentProps<typeof AppLockGate>['unlockImpl']}
      />,
    );
  });
}

/** Let pending microtasks (the awaited unlock) settle. */
async function flush(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/**
 * Set a controlled <input>'s value the way React expects. Assigning
 * `.value` directly bypasses React's value tracker, so the synthetic
 * onChange never fires; the native setter + an `input` event does.
 */
function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function btnByText(text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').toLowerCase().includes(text.toLowerCase()),
    ) ?? null
  );
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('AppLockGate · supported device', () => {
  it('renders the locked curtain dialog', async () => {
    mount({ onUnlocked: () => {}, unlockImpl: cancelUnlock });
    await flush(); // let the auto-triggered biometric prompt settle
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('auto-runs the biometric prompt on mount and unlocks on a pass', async () => {
    const onUnlocked = vi.fn();
    mount({ onUnlocked, unlockImpl: okUnlock });
    await flush();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('a cancelled biometric leaves the curtain up with a "try again" CTA', async () => {
    const onUnlocked = vi.fn();
    mount({ onUnlocked, unlockImpl: cancelUnlock });
    await flush();
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(btnByText('try again')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('always offers a passphrase escape hatch even on a supported device', async () => {
    mount({ onUnlocked: () => {}, unlockImpl: cancelUnlock });
    await flush();
    expect(btnByText('use passphrase')).not.toBeNull();
  });

  it('an unsupported result from the prompt falls back to the passphrase field', async () => {
    // The device claimed support but the prompt reported unsupported
    // (no enrolment) — the user must not be left on a dead try-again CTA.
    mount({ onUnlocked: () => {}, unlockImpl: unsupportedUnlock });
    await flush();
    expect(container.querySelector('#app-lock-passphrase')).not.toBeNull();
  });
});

describe('AppLockGate · unsupported device', () => {
  it('skips straight to the passphrase field — no dead try-again loop', () => {
    supported = false;
    mount({ onUnlocked: () => {} });
    expect(container.querySelector('#app-lock-passphrase')).not.toBeNull();
    // No biometric "try again" path on a device that can't do it.
    expect(btnByText('try again')).toBeNull();
  });
});

describe('AppLockGate · passphrase escape hatch', () => {
  it('"use passphrase" reveals the passphrase field', async () => {
    mount({ onUnlocked: () => {}, unlockImpl: cancelUnlock });
    await flush();
    click(btnByText('use passphrase')!);
    expect(container.querySelector('#app-lock-passphrase')).not.toBeNull();
  });

  it('a correct passphrase unlocks the app', async () => {
    const onUnlocked = vi.fn();
    supported = false; // land on the passphrase field directly
    mount({ onUnlocked, vault: makeVault(true) });
    const input = container.querySelector<HTMLInputElement>('#app-lock-passphrase')!;
    typeInto(input, 'correct horse battery staple');
    click(btnByText('unlock')!);
    await flush();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('a wrong passphrase keeps the curtain up with an error', async () => {
    const onUnlocked = vi.fn();
    supported = false;
    mount({ onUnlocked, vault: makeVault(false) });
    const input = container.querySelector<HTMLInputElement>('#app-lock-passphrase')!;
    typeInto(input, 'wrong');
    click(btnByText('unlock')!);
    await flush();
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('never strands the user — a null vault still lifts the curtain', async () => {
    const onUnlocked = vi.fn();
    supported = false;
    // No vault to verify against — the fail-open branch must still unlock.
    mount({ onUnlocked, vault: null });
    const input = container.querySelector<HTMLInputElement>('#app-lock-passphrase')!;
    typeInto(input, 'anything');
    click(btnByText('unlock')!);
    await flush();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });
});
