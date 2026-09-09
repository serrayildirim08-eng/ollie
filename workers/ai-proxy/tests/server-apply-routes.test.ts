/**
 * Auth-gate tests for the server-apply HTTP surface (A6b · pre-merge audit).
 *
 * handleApplyInbox / handleSyncGroceryPantry both call authUser(), which:
 *   - returns 401 when the Authorization header is missing / not a bearer / the
 *     Clerk JWT is invalid;
 *   - honours STAGING_TEST_BEARER ONLY when env.ENVIRONMENT !== 'production'
 *     (the prod side-door is refused — audit #24, mirrors dump #43).
 *
 * We mock verifyClerkJwt (same seam as dump.test.ts) so no real JWKS round-trip
 * is needed, and stub the underlying server-apply DB functions so a 200 path
 * proves only that auth succeeded — not the Supabase plumbing (covered by
 * server-apply.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the Clerk verifier: 'good-clerk-token' → a user id, anything else throws
// (authUser catches the throw and returns null → 401).
vi.mock('../src/clerk-verify', () => ({
  verifyClerkJwt: vi.fn(async (jwt: string) => {
    if (jwt === 'good-clerk-token') return 'user_clerk_ok';
    throw new Error('invalid jwt');
  }),
}));

// Stub the DB layer so a passed auth gate returns 200 without any HTTP.
vi.mock('../src/router/server-apply', () => ({
  applyInbox: vi.fn(async () => ({ applied: 0 })),
  pullGroceryPantry: vi.fn(async () => []),
}));

import { handleApplyInbox, handleSyncGroceryPantry } from '../src/router/server-apply-routes';
import { verifyClerkJwt } from '../src/clerk-verify';

interface TestEnv {
  CLERK_ISSUER?: string;
  STAGING_TEST_BEARER?: string;
  ENVIRONMENT?: string;
  RATE_KV?: KVNamespace;
}

// Minimal in-memory KV so the per-user rate-limit (checkRate) path runs. The
// limit is 60/min so the handful of calls per test never trips it.
function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(overrides: TestEnv = {}): TestEnv {
  return {
    CLERK_ISSUER: 'https://faithful-stag-15.clerk.accounts.dev',
    RATE_KV: makeKv(),
    ...overrides,
  };
}

function applyReq(headers: Record<string, string> = {}): Request {
  return new Request('https://worker.dev/apply-inbox', { method: 'POST', headers });
}

function syncReq(headers: Record<string, string> = {}): Request {
  return new Request('https://worker.dev/sync/grocery-pantry?since=2026-01-01T00:00:00Z', {
    method: 'GET',
    headers,
  });
}

beforeEach(() => {
  vi.mocked(verifyClerkJwt).mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('server-apply routes · auth 401', () => {
  it('handleApplyInbox → 401 with no Authorization header', async () => {
    const res = await handleApplyInbox(applyReq(), makeEnv() as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');
  });

  it('handleApplyInbox → 401 when the bearer is an invalid Clerk JWT', async () => {
    const res = await handleApplyInbox(
      applyReq({ authorization: 'Bearer forged-token' }),
      makeEnv() as never,
    );
    expect(res.status).toBe(401);
  });

  it('handleApplyInbox → 401 when header is not a Bearer scheme', async () => {
    const res = await handleApplyInbox(
      applyReq({ authorization: 'Basic abc123' }),
      makeEnv() as never,
    );
    expect(res.status).toBe(401);
    // Not even a bearer — Clerk verify is never reached.
    expect(vi.mocked(verifyClerkJwt)).not.toHaveBeenCalled();
  });

  it('handleSyncGroceryPantry → 401 with no Authorization header', async () => {
    const res = await handleSyncGroceryPantry(syncReq(), makeEnv() as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');
  });

  it('handleSyncGroceryPantry → 401 when the bearer is an invalid Clerk JWT', async () => {
    const res = await handleSyncGroceryPantry(
      syncReq({ authorization: 'Bearer forged-token' }),
      makeEnv() as never,
    );
    expect(res.status).toBe(401);
  });

  it('handleApplyInbox → 200 with a valid Clerk JWT', async () => {
    const res = await handleApplyInbox(
      applyReq({ authorization: 'Bearer good-clerk-token' }),
      makeEnv() as never,
    );
    expect(res.status).toBe(200);
  });
});

describe('server-apply routes · staging side-door refused on production', () => {
  const DOOR = 'door-secret';

  it('apply-inbox: STAGING_TEST_BEARER REFUSED on production (falls through to Clerk → 401)', async () => {
    const env = makeEnv({ ENVIRONMENT: 'production', STAGING_TEST_BEARER: DOOR });
    const res = await handleApplyInbox(applyReq({ authorization: `Bearer ${DOOR}` }), env as never);
    // Door not taken → Clerk verify ran on the door secret → rejected → 401.
    expect(res.status).toBe(401);
    expect(vi.mocked(verifyClerkJwt)).toHaveBeenCalledWith(DOOR, expect.anything());
  });

  it('apply-inbox: STAGING_TEST_BEARER ACCEPTED on non-production (skips Clerk → 200)', async () => {
    const env = makeEnv({ ENVIRONMENT: 'staging', STAGING_TEST_BEARER: DOOR });
    const res = await handleApplyInbox(applyReq({ authorization: `Bearer ${DOOR}` }), env as never);
    expect(res.status).toBe(200);
    // Door taken → Clerk verify never called.
    expect(vi.mocked(verifyClerkJwt)).not.toHaveBeenCalled();
  });

  it('apply-inbox: STAGING_TEST_BEARER ACCEPTED when ENVIRONMENT is unset (skips Clerk → 200)', async () => {
    const env = makeEnv({ STAGING_TEST_BEARER: DOOR }); // ENVIRONMENT undefined
    const res = await handleApplyInbox(applyReq({ authorization: `Bearer ${DOOR}` }), env as never);
    expect(res.status).toBe(200);
    expect(vi.mocked(verifyClerkJwt)).not.toHaveBeenCalled();
  });

  it('sync/grocery-pantry: STAGING_TEST_BEARER REFUSED on production (→ 401)', async () => {
    const env = makeEnv({ ENVIRONMENT: 'production', STAGING_TEST_BEARER: DOOR });
    const res = await handleSyncGroceryPantry(syncReq({ authorization: `Bearer ${DOOR}` }), env as never);
    expect(res.status).toBe(401);
    expect(vi.mocked(verifyClerkJwt)).toHaveBeenCalledWith(DOOR, expect.anything());
  });

  it('sync/grocery-pantry: STAGING_TEST_BEARER ACCEPTED on non-production (→ 200)', async () => {
    const env = makeEnv({ ENVIRONMENT: 'staging', STAGING_TEST_BEARER: DOOR });
    const res = await handleSyncGroceryPantry(syncReq({ authorization: `Bearer ${DOOR}` }), env as never);
    expect(res.status).toBe(200);
    expect(vi.mocked(verifyClerkJwt)).not.toHaveBeenCalled();
  });
});
