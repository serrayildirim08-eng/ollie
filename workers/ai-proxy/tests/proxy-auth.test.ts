/**
 * Tests for the auth gate on the raw Anthropic proxy endpoints
 * (/brain-dump + /v1/messages) — alpha blocker "proxy-auth".
 *
 * These endpoints forward to api.anthropic.com signed with our
 * ANTHROPIC_API_KEY, so the worker MUST:
 *   - reject a request with no Authorization header (401)
 *   - reject a spoofed x-user-id when no/invalid Bearer is present (401),
 *     and NEVER derive the rate-limit key from the caller-supplied header
 *   - forward to api.anthropic.com once a valid Clerk JWT is presented, and
 *     key the rate limit on the verified `sub` (so rotating x-user-id cannot
 *     bypass the bucket, and a victim's id cannot be poisoned)
 *
 * The Clerk JWT is verified against a mocked JWKS (see clerk-verify.test.ts
 * for the helper pattern). The upstream Anthropic call is mocked too so no
 * real network / key is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import worker from '../src/index';
import { _resetClerkJwksCache } from '../src/clerk-verify';

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const CLERK_ISSUER = 'https://faithful-stag-15.clerk.accounts.dev';
const CLERK_JWKS_URL = `${CLERK_ISSUER}/.well-known/jwks.json`;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

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
    async list() {
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
      } as unknown as KVNamespaceListResult<unknown>;
    },
  } as unknown as KVNamespace;
}

/** Enforced-by-default env (no T0_JWT_ENFORCED override) with Clerk wired. */
function makeEnv(extra: Record<string, unknown> = {}): WorkerEnv {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-fake',
    CACHE_KV: makeKv(),
    RATE_KV: makeKv(),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-fake',
    SUPABASE_ANON_KEY: 'anon-fake',
    CLERK_ISSUER,
    ...extra,
  } as unknown as WorkerEnv;
}

function makeReq(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://worker.dev${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

interface KeyMaterial {
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
  kid: string;
}

async function makeKey(): Promise<KeyMaterial> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const kid = 'proxy-test-kid';
  publicJwk.kid = kid;
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';
  return { privateKey, publicJwk, kid };
}

async function mintJwt(k: KeyMaterial, sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: k.kid })
    .setSubject(sub)
    .setIssuer(CLERK_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(k.privateKey);
}

/**
 * Mock fetch: serve the JWKS, and return a fixed 200 for the upstream
 * Anthropic call. `upstreamCalls` lets a test assert the key was/wasn't
 * forwarded. Any other URL 404s so a leak is visible.
 */
function mockNet(publicJwk: Record<string, unknown>) {
  const upstreamCalls: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === CLERK_JWKS_URL) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === ANTHROPIC_URL) {
        upstreamCalls.push(url);
        return new Response(JSON.stringify({ content: [{ text: 'ok' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    },
  );
  return { spy, upstreamCalls };
}

const ENDPOINTS = ['/brain-dump', '/v1/messages'] as const;

describe('proxy auth gate · missing / spoofed credentials', () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => _resetClerkJwksCache());
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  for (const path of ENDPOINTS) {
    it(`${path} → 401 with no Authorization header`, async () => {
      const net = mockNet({});
      spy = net.spy;
      const resp = await worker.fetch(
        makeReq(path, { model: 'claude-haiku-4-5-20251001', messages: [] }),
        makeEnv(),
      );
      expect(resp.status).toBe(401);
      const body = (await resp.json()) as { error: string };
      expect(body.error).toBe('unauthorized');
      // The Anthropic key must never be forwarded for an unauthed call.
      expect(net.upstreamCalls).toHaveLength(0);
    });

    it(`${path} → 401 when a spoofed x-user-id is sent without a Bearer`, async () => {
      const net = mockNet({});
      spy = net.spy;
      const resp = await worker.fetch(
        makeReq(
          path,
          { model: 'claude-haiku-4-5-20251001', messages: [] },
          { 'x-user-id': 'victim-user-id' },
        ),
        makeEnv(),
      );
      // The spoofable header is NOT an auth credential — must still 401.
      expect(resp.status).toBe(401);
      expect(net.upstreamCalls).toHaveLength(0);
    });

    it(`${path} → 401 for an invalid/forged Bearer`, async () => {
      const real = await makeKey();
      const forged = await makeKey();
      const net = mockNet(real.publicJwk); // JWKS publishes the real key only
      spy = net.spy;
      // Token signed by the foreign key but stamped with the real kid.
      const tampered = await mintJwt(
        { ...forged, kid: real.kid },
        'user_evil',
      );
      const resp = await worker.fetch(
        makeReq(
          path,
          { model: 'claude-haiku-4-5-20251001', messages: [] },
          { authorization: `Bearer ${tampered}` },
        ),
        makeEnv(),
      );
      expect(resp.status).toBe(401);
      const body = (await resp.json()) as { error: string };
      expect(body.error).toBe('invalid_jwt');
      expect(net.upstreamCalls).toHaveLength(0);
    });
  }
});

describe('proxy auth gate · valid Clerk JWT happy path', () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => _resetClerkJwksCache());
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  it('/brain-dump forwards to Anthropic once a valid JWT is presented', async () => {
    const k = await makeKey();
    const net = mockNet(k.publicJwk);
    spy = net.spy;
    const jwt = await mintJwt(k, 'user_happy');
    const resp = await worker.fetch(
      makeReq(
        '/brain-dump',
        { model: 'claude-haiku-4-5-20251001', messages: [] },
        { authorization: `Bearer ${jwt}` },
      ),
      makeEnv(),
    );
    expect(resp.status).toBe(200);
    expect(net.upstreamCalls).toHaveLength(1);
  });

  it('rate limit keys on the verified sub, not the x-user-id header', async () => {
    const k = await makeKey();
    const net = mockNet(k.publicJwk);
    spy = net.spy;
    const jwt = await mintJwt(k, 'user_rl');
    const env = makeEnv(); // shared RATE_KV across calls

    // Fire >10/min for the SAME verified sub but ROTATE x-user-id each call.
    // If the key were header-derived, rotating would dodge the bucket and we
    // would never see a 429. Keying on sub means the 11th call is limited.
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const resp = await worker.fetch(
        makeReq(
          '/brain-dump',
          { model: 'claude-haiku-4-5-20251001', messages: [`call-${i}`] },
          { authorization: `Bearer ${jwt}`, 'x-user-id': `rotating-${i}` },
        ),
        env,
      );
      if (resp.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});

describe('proxy auth gate · dev escape hatch', () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => _resetClerkJwksCache());
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  it('T0_JWT_ENFORCED="0" (non-prod) allows the x-user-id fallback', async () => {
    const net = mockNet({});
    spy = net.spy;
    const resp = await worker.fetch(
      makeReq(
        '/brain-dump',
        { model: 'claude-haiku-4-5-20251001', messages: [] },
        { 'x-user-id': 'dev-user' },
      ),
      makeEnv({ T0_JWT_ENFORCED: '0' }),
    );
    expect(resp.status).toBe(200);
    expect(net.upstreamCalls).toHaveLength(1);
  });

  it('T0_JWT_ENFORCED="0" is still slammed shut when ENVIRONMENT="production"', async () => {
    const net = mockNet({});
    spy = net.spy;
    const resp = await worker.fetch(
      makeReq(
        '/brain-dump',
        { model: 'claude-haiku-4-5-20251001', messages: [] },
        { 'x-user-id': 'attacker' },
      ),
      makeEnv({ T0_JWT_ENFORCED: '0', ENVIRONMENT: 'production' }),
    );
    expect(resp.status).toBe(401);
    expect(net.upstreamCalls).toHaveLength(0);
  });
});
