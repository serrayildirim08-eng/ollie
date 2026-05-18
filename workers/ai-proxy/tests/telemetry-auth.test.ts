/**
 * Tests for the auth gate on the telemetry endpoints (S2 security fix).
 *
 * /enrich-dump, /ingest-event and /label use the service-role key, so the
 * worker's fetch entrypoint MUST:
 *   - reject a request with no Authorization header (401)
 *   - reject a request whose JWT Supabase does not recognise (401)
 *   - rate-limit per verified user id (429 after RATE_MAX in the window)
 *   - forward to the handler once a valid JWT is presented
 *
 * The JWT is "verified" by a Supabase GET /auth/v1/user call, which we
 * mock here. Handler-internal behaviour is covered by the dedicated
 * enrich-dump / ingest-event suites; this file only exercises the gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';

type WorkerEnv = Parameters<typeof worker.fetch>[1];

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

function makeEnv(): WorkerEnv {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-fake',
    CACHE_KV: makeKv(),
    RATE_KV: makeKv(),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-fake',
    SUPABASE_ANON_KEY: 'anon-fake',
  } as unknown as WorkerEnv;
}

function makeReq(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.dev${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Mock Supabase GET /auth/v1/user. `validToken` resolves to a user id;
 * anything else returns 401. All other URLs (the handler's own REST/
 * Anthropic calls) return a generic 2xx so the handler can complete.
 */
function mockFetch(validToken: string, userId: string) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) {
        const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
        if (auth === `Bearer ${validToken}`) {
          return new Response(JSON.stringify({ id: userId }), { status: 200 });
        }
        return new Response('', { status: 401 });
      }
      // Handler's downstream calls (Supabase REST insert, etc.) — succeed.
      return new Response(null, { status: 201 });
    },
  );
}

const ENDPOINTS = ['/enrich-dump', '/ingest-event', '/label'] as const;

describe('telemetry auth gate · missing / bad JWT', () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  for (const path of ENDPOINTS) {
    it(`${path} → 401 with no Authorization header`, async () => {
      const resp = await worker.fetch(makeReq(path, {}), makeEnv());
      expect(resp.status).toBe(401);
      const body = (await resp.json()) as { error: string };
      expect(body.error).toBe('unauthorized');
    });

    it(`${path} → 401 when Supabase rejects the JWT`, async () => {
      spy = mockFetch('good-token', 'user-1');
      const resp = await worker.fetch(
        makeReq(path, {}, { authorization: 'Bearer forged-token' }),
        makeEnv(),
      );
      expect(resp.status).toBe(401);
      const body = (await resp.json()) as { error: string };
      expect(body.error).toBe('invalid_jwt');
    });
  }
});

describe('telemetry auth gate · valid JWT reaches the handler', () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => {
    spy = mockFetch('good-token', 'user-42');
  });
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  it('/ingest-event with a valid JWT is forwarded (not 401)', async () => {
    const resp = await worker.fetch(
      makeReq(
        '/ingest-event',
        { table: 'retention_events', row: { user_hash: 'h' } },
        { authorization: 'Bearer good-token' },
      ),
      makeEnv(),
    );
    expect(resp.status).not.toBe(401);
    expect(resp.status).toBe(200);
  });

  it('/enrich-dump with a valid JWT is forwarded (not 401)', async () => {
    const resp = await worker.fetch(
      makeReq(
        '/enrich-dump',
        {
          user_hash: 'h',
          device_id: 'd',
          event_ts: '2026-05-16T00:00:00Z',
          locale: 'en',
          country: 'INTL',
          modality: 'text',
          raw_text: 'hello',
          app_version: 'test',
        },
        { authorization: 'Bearer good-token' },
      ),
      makeEnv(),
    );
    expect(resp.status).not.toBe(401);
    expect(resp.status).toBe(200);
  });
});

describe('telemetry auth gate · per-user rate limit', () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => {
    spy = mockFetch('good-token', 'user-rl');
  });
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  it('returns 429 once the per-user telemetry limit is exceeded', async () => {
    // RATE_KV is shared across calls within one env instance, so reuse it.
    const env = makeEnv();
    const fire = () =>
      worker.fetch(
        makeReq(
          '/ingest-event',
          { table: 'retention_events', row: { user_hash: 'h' } },
          { authorization: 'Bearer good-token' },
        ),
        env,
      );

    // RATE_MAX is 10/min. The 11th call for the same verified user → 429.
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const resp = await fire();
      if (resp.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
