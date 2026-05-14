/**
 * @ollie/capacitor-healthkit · permissions tests
 *
 * Verifies the permission flow when the Capacitor runtime is not
 * available (web/SSR) — must return UNSUPPORTED, NEVER throw. The
 * native-runtime path is exercised in the sync test via pluginOverride.
 */

import { describe, expect, it } from 'vitest';
import { getPermissionStatus, requestPermissions } from '../src/permissions';
import { HK_AUTH_UNSUPPORTED } from '../src/types';

describe('requestPermissions (web/SSR)', () => {
  it('returns UNSUPPORTED when no Capacitor runtime is present', async () => {
    const r = await requestPermissions();
    expect(r.status).toBe(HK_AUTH_UNSUPPORTED);
    expect(r.available).toBe(false);
    expect(r.granted).toEqual([]);
    expect(r.denied).toEqual([]);
  });

  it('does not throw when called with custom types', async () => {
    const r = await requestPermissions({ types: ['stepCount', 'sleepAnalysis'] });
    expect(r.status).toBe(HK_AUTH_UNSUPPORTED);
    expect(r.available).toBe(false);
  });
});

describe('getPermissionStatus (web/SSR)', () => {
  it('returns UNSUPPORTED when no Capacitor runtime is present', async () => {
    const s = await getPermissionStatus();
    expect(s).toBe(HK_AUTH_UNSUPPORTED);
  });
});
