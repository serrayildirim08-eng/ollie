/**
 * SettingsScreen.SecuritySection · flow tests (app-lock · 2026-05-18)
 *
 * Covers the app-lock opt-in toggle:
 *   - DEFAULT OFF — nobody gets surprise-locked
 *   - supported device: toggling ON writes shared.app_lock.enabled = true
 *   - supported device: toggling OFF writes it back to false
 *   - unsupported device: the switch is non-interactive (aria-disabled),
 *     reads OFF, and a clicking it does NOT enable the feature
 *
 * Mirrors SettingsScreen.research.test.tsx — same react-dom-into-jsdom
 * pattern, same `../store` stub so the test doesn't transitively pull in
 * '@ollie/store/react'. We import SecuritySection directly (named export).
 *
 * The `../store` stub here is a real Map-backed mini-store so the
 * setAppLockEnabled → store.set → useStoreSlice re-render chain actually
 * runs — the toggle's reactivity is part of the contract under test.
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── biometric capability mock — flipped per test ────────────────────────────
let supported = true;
vi.mock('../lib/biometric', () => ({
  isBiometricSupported: () => supported,
  unlock: vi.fn(),
}));

// ─── a real Map-backed mini-store stub ───────────────────────────────────────
// Behaves like @ollie/store enough for the app-lock helpers + useStoreSlice:
// get/set/subscribeKey with key-scoped subscribers. Shared by both the
// `store` export and `useStoreSlice`.
const mocks = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const subs = new Map<string, Set<(v: unknown) => void>>();
  const k = (mod: string, key: string) => `${mod}::${key}`;
  const miniStore = {
    get: <T,>(mod: string, key: string, def?: T): T => {
      const v = data.get(k(mod, key));
      return (v === undefined ? def : v) as T;
    },
    set: <T,>(mod: string, key: string, value: T): void => {
      data.set(k(mod, key), value);
      subs.get(k(mod, key))?.forEach((cb) => cb(value));
    },
    subscribeKey: <T,>(mod: string, key: string, cb: (v: T) => void): (() => void) => {
      const id = k(mod, key);
      if (!subs.has(id)) subs.set(id, new Set());
      subs.get(id)!.add(cb as (v: unknown) => void);
      return () => subs.get(id)?.delete(cb as (v: unknown) => void);
    },
    _reset: () => { data.clear(); subs.clear(); },
  };
  return { data, subs, miniStore };
});

vi.mock('../store', () => {
  // useStoreSlice: seed-on-first-read + subscribe so a store.set re-renders.
  function useStoreSlice<T>(mod: string, key: string, def: T): [T, (v: T) => void] {
    const [value, setValue] = React.useState<T>(() =>
      mocks.miniStore.get<T>(mod, key, def),
    );
    React.useEffect(() => {
      const unsub = mocks.miniStore.subscribeKey<T>(mod, key, setValue);
      return unsub;
    }, [mod, key]);
    return [value, (v: T) => mocks.miniStore.set(mod, key, v)];
  }
  return { store: mocks.miniStore, useStoreSlice };
});

// ─── transitive-dep stubs (mirrors research test) ────────────────────────────
vi.mock('../lib/account-boot', () => ({ getAccount: () => null, bootAccount: () => ({}) }));
vi.mock('../lib/user-hash', () => ({ readUserHash: () => null }));
vi.mock('../lib/device', () => ({ getAppVersion: () => 'test', getDeviceId: () => 'test-device' }));
vi.mock('@ollie/backup', () => ({
  exportBackup: vi.fn(),
  envelopeToFileBytes: vi.fn(),
  defaultFilename: vi.fn(),
  importBackup: vi.fn(),
}));
vi.mock('../lib/invite', () => ({ generateInvite: vi.fn() }));

// Now safe to import — all transitive deps mocked.
import { SecuritySection } from './SettingsScreen';
import { APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY } from '../lib/app-lock';

let container: HTMLDivElement;
let root: Root;

function mount(): void {
  act(() => { root.render(<SecuritySection />); });
}

function getToggle(): HTMLElement {
  const el = container.querySelector('[aria-label^="unlock with face id"]');
  if (!el) throw new Error('security toggle not found');
  return el as HTMLElement;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  supported = true;
  mocks.miniStore._reset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('SecuritySection · default state', () => {
  it('the app-lock toggle is OFF by default', () => {
    mount();
    const toggle = getToggle();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('reads the feature flag straight from the store', () => {
    mocks.miniStore.set(APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY, true);
    mount();
    expect(getToggle().getAttribute('aria-checked')).toBe('true');
  });
});

describe('SecuritySection · supported device', () => {
  it('toggling ON writes shared.app_lock.enabled = true', () => {
    mount();
    click(getToggle());
    expect(mocks.miniStore.get(APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY, false)).toBe(true);
  });

  it('toggling OFF writes the flag back to false', () => {
    mocks.miniStore.set(APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY, true);
    mount();
    click(getToggle());
    expect(mocks.miniStore.get(APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY, false)).toBe(false);
  });

  it('the toggle re-renders to reflect the new store value', () => {
    mount();
    click(getToggle());
    expect(getToggle().getAttribute('aria-checked')).toBe('true');
  });
});

describe('SecuritySection · unsupported device', () => {
  it('the switch is non-interactive (aria-disabled) when biometrics are absent', () => {
    supported = false;
    mount();
    const toggle = getToggle();
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking the disabled switch does NOT enable the feature', () => {
    supported = false;
    mount();
    click(getToggle());
    expect(mocks.miniStore.get(APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY, false)).toBe(false);
  });

  it('shows a quiet "no biometrics" hint instead of the unlock blurb', () => {
    supported = false;
    mount();
    expect(container.textContent).toContain('no face id or fingerprint');
  });
});
