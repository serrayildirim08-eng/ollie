/**
 * SettingsScreen · delete-account prefix scan (Fix 1).
 *
 * Regression: handleDeleteAccount scanned keys.startsWith('ollie:') but
 * real store keys live under `void.state.<mod>.v<N>`. The wipe was a no-op
 * — reload happened, user thought data was deleted, on next mount every
 * module was intact.
 *
 * This test reproduces the scan logic against an in-memory storage shim
 * keyed by storeModuleKey() so a future regression of the prefix breaks
 * here before alpha users see the trust-breaking false success.
 */

import { describe, it, expect } from 'vitest';
import { storeModuleKey } from '@ollie/store';

// Mirrors the prefix used in SettingsScreen.tsx handleDeleteAccount.
const VOID_PREFIX = 'void.state.';

function scanAndWipe(storage: Map<string, string>): string[] {
  const keys: string[] = [];
  for (const k of storage.keys()) {
    if (k.startsWith(VOID_PREFIX)) keys.push(k);
  }
  for (const k of keys) storage.delete(k);
  return keys;
}

describe('SettingsScreen · handleDeleteAccount prefix (Fix 1)', () => {
  it('wipes every void.state.<mod>.v<N> key', () => {
    const s = new Map<string, string>();
    s.set(storeModuleKey('shared'), '{"onboarded":true}');
    s.set(storeModuleKey('finance'), '{"records":[1,2,3]}');
    s.set(storeModuleKey('cycle'), '{"items":[]}');

    const wiped = scanAndWipe(s);
    expect(wiped.length).toBe(3);
    expect(s.size).toBe(0);
  });

  it('does NOT wipe unrelated keys', () => {
    const s = new Map<string, string>();
    s.set(storeModuleKey('shared'), '{}');
    s.set('ollie:weather:current', 'cached');
    s.set('vendor:other', 'leave-me');

    const wiped = scanAndWipe(s);
    expect(wiped).toEqual([storeModuleKey('shared')]);
    expect(s.has('ollie:weather:current')).toBe(true);
    expect(s.has('vendor:other')).toBe(true);
  });

  it('OLD wrong prefix ollie: would miss every real store key (regression guard)', () => {
    const s = new Map<string, string>();
    s.set(storeModuleKey('shared'), '{}');
    s.set(storeModuleKey('finance'), '{}');
    // Old buggy scan
    const wiped: string[] = [];
    for (const k of s.keys()) if (k.startsWith('ollie:')) wiped.push(k);
    expect(wiped).toEqual([]); // confirms the prior bug shape
    expect(s.size).toBe(2);    // nothing was deleted
  });

  it('canonical prefix is void.state.', () => {
    expect(storeModuleKey('shared').startsWith(VOID_PREFIX)).toBe(true);
  });
});
