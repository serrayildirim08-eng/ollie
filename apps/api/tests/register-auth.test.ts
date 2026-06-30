/**
 * Audit H9 — /register-token must derive user_id from a verified identity, not
 * trust the request body. Previously it authenticated with a client-shipped
 * shared secret and keyed the token by body.user_id, so any caller could
 * register a token for any user. Now it requires a Clerk JWT (x-user-jwt) and
 * keys by the verified sub.
 *
 * We drive the verify through its Supabase fallback (mock global fetch on
 * /auth/v1/user) so no RS256/JWKS minting is needed — verifyClerkJwt fails fast
 * on the non-JWT token and the Supabase leg returns the verified id.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/worker';

function makeKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [], list_complete: true } as unknown as KVNamespaceListResult<unknown>; },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

function makeEnv(kv: KVNamespace) {
  return {
    APNS_KEY_ID: 'k', APNS_TEAM_ID: 't', APNS_BUNDLE_ID: 'b',
    APNS_AUTH_KEY: 'key', APNS_USE_SANDBOX: '1',
    REGISTER_SHARED_SECRET: 'server-only-secret',
    CLERK_ISSUER: 'https://clerk.test',
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_ANON_KEY: 'anon-key',
    // SUPABASE_SERVICE_ROLE_KEY intentionally unset → mirrorTokenToPostgres skips.
    DEVICE_TOKENS: kv,
  } as unknown as Parameters<typeof worker.fetch>[1];
}

function req(headers: Record<string, string>, body: unknown): Request {
  return new Request('https://push.test/register-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('audit H9 · /register-token identity', () => {
  it('rejects a request with no x-user-jwt (401)', async () => {
    const kv = makeKv();
    const resp = await worker.fetch(req({}, { token: 'apns-tok', platform: 'ios' }), makeEnv(kv));
    expect(resp.status).toBe(401);
    expect(kv.store.size).toBe(0);
  });

  it('derives user_id from the verified identity and ignores body.user_id', async () => {
    const kv = makeKv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'verified-user' }), { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const resp = await worker.fetch(
      req({ 'x-user-jwt': 'opaque-supabase-token' },
          { token: 'apns-tok', platform: 'ios', user_id: 'ATTACKER-SPOOF' }),
      makeEnv(kv),
    );

    expect(resp.status).toBe(200);
    // Keyed by the VERIFIED id, never the spoofed body value.
    expect(kv.store.has('user:verified-user')).toBe(true);
    expect(kv.store.has('user:ATTACKER-SPOOF')).toBe(false);
    expect(JSON.parse(kv.store.get('user:verified-user')!).user_id).toBe('verified-user');
  });

  it('rejects when the identity cannot be verified (401)', async () => {
    const kv = makeKv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const resp = await worker.fetch(
      req({ 'x-user-jwt': 'bad-token' }, { token: 'apns-tok', platform: 'ios' }),
      makeEnv(kv),
    );
    expect(resp.status).toBe(401);
    expect(kv.store.size).toBe(0);
  });
});
