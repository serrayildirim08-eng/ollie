/**
 * workers/apns-push — tests for the APNs forwarder worker (audit #5).
 *
 * Covers:
 *   - method / path 404s
 *   - shared-secret gate (missing, wrong, and fail-closed on unset secret)
 *   - request-body validation (400s)
 *   - happy path: forwards to api.push.apple.com, returns upstream status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { type Env } from '../src/index';

// ─── key helper ─────────────────────────────────────────────────────────────

function toPem(pkcs8: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(pkcs8);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

async function makeApplePem(): Promise<string> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  return toPem((await crypto.subtle.exportKey('pkcs8', kp.privateKey)) as ArrayBuffer);
}

// ─── env / KV stub ──────────────────────────────────────────────────────────

function makeKv(): KVNamespace {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => data.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { data.set(k, v); }),
    delete: vi.fn(async (k: string) => { data.delete(k); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
  } as unknown as KVNamespace;
}

async function makeEnv(over: Partial<Env> = {}): Promise<Env> {
  return {
    APPLE_AUTH_KEY: await makeApplePem(),
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_BUNDLE_ID: 'app.ollie.ollie',
    APNS_INTERNAL_SECRET: 'push-secret',
    RATE_KV: makeKv(),
    ...over,
  } as Env;
}

const SECRET_HEADER = { authorization: 'Bearer push-secret' };

function pushReq(body: unknown, headers: Record<string, string> = {}, method = 'POST', path = '/push'): Request {
  return new Request(`https://apns.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

describe('apns-push worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('404s a non-POST request', async () => {
    const res = await worker.fetch(pushReq(null, SECRET_HEADER, 'GET'), await makeEnv());
    expect(res.status).toBe(404);
  });

  it('404s an unknown path', async () => {
    const res = await worker.fetch(pushReq({}, SECRET_HEADER, 'POST', '/nope'), await makeEnv());
    expect(res.status).toBe(404);
  });

  it('401s when the Authorization header is missing', async () => {
    const res = await worker.fetch(pushReq({ deviceToken: 'd', payload: {} }), await makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('401s on a wrong shared secret', async () => {
    const res = await worker.fetch(
      pushReq({ deviceToken: 'd', payload: {} }, { authorization: 'Bearer wrong' }),
      await makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('fails CLOSED — 401 when APNS_INTERNAL_SECRET is unset', async () => {
    const env = await makeEnv({ APNS_INTERNAL_SECRET: '' });
    const res = await worker.fetch(
      pushReq({ deviceToken: 'd', payload: {} }, { authorization: 'Bearer anything' }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('400s invalid JSON', async () => {
    const res = await worker.fetch(pushReq('{not json', SECRET_HEADER), await makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('400s a missing deviceToken', async () => {
    const res = await worker.fetch(pushReq({ payload: {} }, SECRET_HEADER), await makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_deviceToken' });
  });

  it('400s a missing payload', async () => {
    const res = await worker.fetch(pushReq({ deviceToken: 'd' }, SECRET_HEADER), await makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_payload' });
  });

  it('happy path: forwards to api.push.apple.com and returns the upstream status', async () => {
    let calledUrl = '';
    const fetchSpy = vi.fn(async (url: string | URL) => {
      calledUrl = String(url);
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await worker.fetch(
      pushReq({ deviceToken: 'abcd1234', payload: { aps: { alert: 'hi' } } }, SECRET_HEADER),
      await makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(calledUrl).toBe('https://api.push.apple.com/3/device/abcd1234');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates an APNs failure status + body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 }),
    ));
    const res = await worker.fetch(
      pushReq({ deviceToken: 'abcd1234', payload: { aps: {} } }, SECRET_HEADER),
      await makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ reason: 'BadDeviceToken' });
  });
});
