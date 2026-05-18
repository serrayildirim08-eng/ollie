/**
 * app-lock · unit tests
 *
 * Covers the state helpers behind the app-lock curtain:
 *   - default: feature OFF, app NOT locked
 *   - enable / disable; disabling also clears a live lock
 *   - lockApp is a no-op when the feature is disabled
 *   - relockIfIdle: locks only when enabled, not already locked, and the
 *     background gap exceeds the threshold
 *   - seedColdBootLock: cold boot comes up locked iff the feature is on
 */

import { describe, it, expect, beforeEach } from 'vitest';

// localStorage stub — jsdom's --localstorage-file path is invalid in this
// runner, so the @ollie/store browser adapter needs a Map-backed stand-in.
const _ls = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => _ls.get(k) ?? null,
    setItem: (k: string, v: string) => { _ls.set(k, v); },
    removeItem: (k: string) => { _ls.delete(k); },
    clear: () => { _ls.clear(); },
    get length() { return _ls.size; },
    key: (i: number) => Array.from(_ls.keys())[i] ?? null,
  },
  configurable: true,
  writable: true,
});

import { store } from '../store';
import {
  RELOCK_AFTER_MS,
  isAppLockEnabled,
  setAppLockEnabled,
  isAppLocked,
  lockApp,
  unlockApp,
  markBackgrounded,
  relockIfIdle,
  seedColdBootLock,
} from './app-lock';

beforeEach(() => {
  _ls.clear();
  store._reset();
});

describe('app-lock · default state', () => {
  it('feature is off by default', () => {
    expect(isAppLockEnabled()).toBe(false);
  });

  it('app is not locked by default', () => {
    expect(isAppLocked()).toBe(false);
  });
});

describe('app-lock · enable / disable', () => {
  it('setAppLockEnabled(true) turns the feature on', () => {
    setAppLockEnabled(true);
    expect(isAppLockEnabled()).toBe(true);
  });

  it('disabling the feature also clears a live lock', () => {
    setAppLockEnabled(true);
    lockApp();
    expect(isAppLocked()).toBe(true);
    setAppLockEnabled(false);
    expect(isAppLockEnabled()).toBe(false);
    expect(isAppLocked()).toBe(false); // not stranded behind the curtain
  });
});

describe('app-lock · lock / unlock', () => {
  it('lockApp is a no-op when the feature is disabled', () => {
    lockApp();
    expect(isAppLocked()).toBe(false);
  });

  it('lockApp draws the curtain when the feature is enabled', () => {
    setAppLockEnabled(true);
    lockApp();
    expect(isAppLocked()).toBe(true);
  });

  it('unlockApp lifts the curtain', () => {
    setAppLockEnabled(true);
    lockApp();
    unlockApp();
    expect(isAppLocked()).toBe(false);
  });
});

describe('app-lock · relockIfIdle', () => {
  it('does nothing when the feature is disabled', () => {
    markBackgrounded(0);
    expect(relockIfIdle(RELOCK_AFTER_MS + 1)).toBe(false);
    expect(isAppLocked()).toBe(false);
  });

  it('does not re-lock when the background gap is under the threshold', () => {
    setAppLockEnabled(true);
    markBackgrounded(1000);
    expect(relockIfIdle(1000 + RELOCK_AFTER_MS - 1)).toBe(false);
    expect(isAppLocked()).toBe(false);
  });

  it('re-locks when the background gap exceeds the threshold', () => {
    setAppLockEnabled(true);
    markBackgrounded(1000);
    expect(relockIfIdle(1000 + RELOCK_AFTER_MS + 1)).toBe(true);
    expect(isAppLocked()).toBe(true);
  });

  it('does nothing when already locked', () => {
    setAppLockEnabled(true);
    lockApp();
    markBackgrounded(0);
    expect(relockIfIdle(RELOCK_AFTER_MS + 1)).toBe(false); // already locked
  });

  it('does nothing when the app was never backgrounded', () => {
    setAppLockEnabled(true);
    expect(relockIfIdle(Date.now())).toBe(false);
    expect(isAppLocked()).toBe(false);
  });
});

describe('app-lock · seedColdBootLock', () => {
  it('cold boot comes up unlocked when the feature is off', () => {
    expect(seedColdBootLock()).toBe(false);
    expect(isAppLocked()).toBe(false);
  });

  it('cold boot comes up locked when the feature is on', () => {
    setAppLockEnabled(true);
    expect(seedColdBootLock()).toBe(true);
    expect(isAppLocked()).toBe(true);
  });
});
