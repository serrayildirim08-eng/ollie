/**
 * @ollie/notifications · capacitor backend — APNs register-token body
 *
 * Guards the critical-fix invariant: the `/register-token` POST body must
 * carry `user_id` whenever a session exists, and must OMIT the key (not
 * send null) when there is no session yet. The worker mirrors the token
 * into the joinable Postgres `push_tokens` table only when `body.user_id`
 * is present — without it iOS remote push is silently never delivered.
 */

import { describe, it, expect } from 'vitest';
import { buildRegistrationBody } from '../src/backends/capacitor';

describe('buildRegistrationBody', () => {
  it('includes user_id when a session id is supplied', () => {
    const body = buildRegistrationBody('apns-tok-abc', 'user-123', 1_700_000_000);
    expect(body).toEqual({
      token: 'apns-tok-abc',
      platform: 'ios',
      registered_at: 1_700_000_000,
      user_id: 'user-123',
    });
  });

  it('omits user_id entirely when none is available (pre-sign-in)', () => {
    const body = buildRegistrationBody('apns-tok-abc', null, 1_700_000_000);
    expect(body).toEqual({
      token: 'apns-tok-abc',
      platform: 'ios',
      registered_at: 1_700_000_000,
    });
    expect('user_id' in body).toBe(false);
  });

  it('omits user_id for undefined and empty-string (never sends a falsy id)', () => {
    expect('user_id' in buildRegistrationBody('t', undefined, 1)).toBe(false);
    expect('user_id' in buildRegistrationBody('t', '', 1)).toBe(false);
  });

  it('always pins platform to ios', () => {
    expect(buildRegistrationBody('t', 'u', 1).platform).toBe('ios');
  });

  it('serialises to JSON the worker can parse (round-trip)', () => {
    const body = buildRegistrationBody('tok', 'user-9', 42);
    const parsed = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    expect(parsed.user_id).toBe('user-9');
    expect(parsed.token).toBe('tok');
  });
});
