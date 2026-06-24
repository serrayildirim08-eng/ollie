/**
 * workers/apns-push — tests (audit #162).
 *
 * This worker holds the Apple p8 + does ES256 JWT signing + auth + a per-user
 * rate limiter, yet had ZERO coverage. This suite pins the security contract:
 *   - missing internal secret  → 401 (fail CLOSED)
 *   - wrong bearer             → 401
 *   - non-hex device token     → 400
 *   - valid request            → signs a JWT and forwards to APNs (200 passthrough)
 *   - rate-limit exceeded      → 429
 *
 * The "valid" path uses a freshly generated P-256 key exported as a PKCS8 PEM
 * so we exercise the real `crypto.subtle` ES256 signing code, not a stub.
 */

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import worker, { type Env } from '../src/index';

// ─── generate a real ECDSA P-256 PEM for the signing path ──────────────────────

let APPLE_AUTH_KEY = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer;
  const b64 = Buffer.from(new Uint8Array(pkcs8)).toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  APPLE_AUTH_KEY = `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
});

// ─── KV stub ───────────────────────────────────────────────────────────────────

function makeKv(): KVNamespace {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => data.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { data.set(k, v); }),
    delete: vi.fn(async (k: string) => { data.delete(k); }),
    list: vi.fn(async () => ({ keys: [...data.keys()].map((name) => ({ name })) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const SECRET = 'internal-shared-secret';
const VALID_TOKEN = 'a'.repeat(64); // 64 hex chars

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    APPLE_AUTH_KEY,
    APPLE_KEY_ID: 'ABC1234567',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_BUNDLE_ID: 'app.ollie.ollie',
    APNS_INTERNAL_SECRET: SECRET,
    RATE_KV: makeKv(),
    ...over,
  };
}

function pushReq(body: unknown, bearer: string | null = SECRET): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
  return new Request('https://apns.test/push', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const goodBody = { deviceToken: VALID_TOKEN, payload: { aps: { alert: 'hi' } }, userId: 'user_1' };

describe('apns-push worker', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => { /* fresh per test via makeEnv */ });

  it('404s a non-/push or non-POST request', async () => {
    const res = await worker.fetch(new Request('https://apns.test/other', { method: 'POST' }), makeEnv());
    expect(res.status).toBe(404);
    const res2 = await worker.fetch(new Request('https://apns.test/push', { method: 'GET' }), makeEnv());
    expect(res2.status).toBe(404);
  });

  it('401s (fail CLOSED) when the internal secret is unset', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await worker.fetch(pushReq(goodBody), makeEnv({ APNS_INTERNAL_SECRET: '' as any }));
    expect(res.status).toBe(401);
  });

  it('401s on a wrong bearer token', async () => {
    const res = await worker.fetch(pushReq(goodBody, 'wrong-secret'), makeEnv());
    expect(res.status).toBe(401);
  });

  it('401s when the Authorization header is missing', async () => {
    const res = await worker.fetch(pushReq(goodBody, null), makeEnv());
    expect(res.status).toBe(401);
  });

  it('400s a non-hex device token', async () => {
    const res = await worker.fetch(
      pushReq({ ...goodBody, deviceToken: 'not-hex-!!!-token' }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('invalid_deviceToken');
  });

  it('400s a missing payload', async () => {
    const res = await worker.fetch(
      pushReq({ deviceToken: VALID_TOKEN }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('signs an ES256 JWT and forwards a valid request to APNs', async () => {
    let calledUrl = '';
    let authHeader = '';
    let apnsTopic = '';
    const fetchSpy = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calledUrl = String(url);
      const h = new Headers(init?.headers);
      authHeader = h.get('authorization') ?? '';
      apnsTopic = h.get('apns-topic') ?? '';
      // APNs returns empty body + 200 on success.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await worker.fetch(pushReq(goodBody), makeEnv());

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calledUrl).toBe(`https://api.push.apple.com/3/device/${VALID_TOKEN}`);
    expect(apnsTopic).toBe('app.ollie.ollie');
    // A real signed JWT has three dot-delimited segments.
    expect(authHeader).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('429s once the per-user rate limit (5/sec) is exceeded (KV fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const env = makeEnv(); // no RATE_LIMITER → KV fallback path; shared KV across the loop
    let saw429 = false;
    for (let i = 0; i < 7; i++) {
      const res = await worker.fetch(pushReq(goodBody), env);
      if (res.status === 429) { saw429 = true; break; }
    }
    expect(saw429).toBe(true);
  });

  it('prefers the native (atomic) limiter over the racy KV counter when present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    // Native binding that admits the first 2 calls then denies — atomic, so it
    // cannot be defeated by concurrency the way the KV read-modify-write is.
    let admitted = 0;
    const limiter = { limit: vi.fn(async () => ({ success: admitted++ < 2 })) };
    const kv = makeKv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = makeEnv({ RATE_LIMITER: limiter as any, RATE_KV: kv });

    const r1 = await worker.fetch(pushReq(goodBody), env);
    const r2 = await worker.fetch(pushReq(goodBody), env);
    const r3 = await worker.fetch(pushReq(goodBody), env);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    // The native binding decided every call; the racy KV counter was never touched.
    expect(limiter.limit).toHaveBeenCalledTimes(3);
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('atomic limiter holds the ceiling under a concurrent burst', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    // Real atomic counter: each call increments before deciding, so even a
    // simultaneous burst cannot over-admit past the ceiling (the KV path could).
    let count = 0;
    const CEILING = 5;
    const limiter = {
      limit: vi.fn(async () => {
        count += 1;
        return { success: count <= CEILING };
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = makeEnv({ RATE_LIMITER: limiter as any });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => worker.fetch(pushReq(goodBody), env)),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const limited = results.filter((r) => r.status === 429).length;

    expect(ok).toBe(CEILING);
    expect(limited).toBe(20 - CEILING);
  });
});
