/**
 * Tests for /route/:module — module-agnostic AI semantic routing.
 *
 * Coverage:
 *   - Unknown module → 404
 *   - Missing/empty text → 400
 *   - Cache hit path (mock Voyage + mock Supabase RPC returning row)
 *   - Cache miss path (mock Voyage + mock Supabase RPC empty + mock Groq)
 *   - Voyage failure → 502
 *   - Groq failure → 502
 *   - T0_JWT_ENFORCED=1 with missing auth → 401
 *
 * Integration (T0 + T1 required, not run here):
 *   Real pgvector lookup + Groq call needs deployed DB + API keys.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';

// ─── env stub ─────────────────────────────────────────────────────────────────

function makeEnv(overrides: Partial<RouteEnv> = {}): RouteEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    VOYAGE_API_KEY: 'voy-test-key',
    GROQ_API_KEY: 'groq-test-key',
    T0_JWT_ENFORCED: '0', // dev/open default; auth tests override with '1'
    ...overrides,
  };
}

function makeReq(body: unknown, module = 'grocery'): Request {
  return new Request(`https://worker.dev/route/${module}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── fetch mock helpers ───────────────────────────────────────────────────────

type FetchMockFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeVoyageOk(): FetchMockFn {
  return async (url) => {
    if (url.includes('voyageai.com')) {
      const embedding = Array(1024).fill(0.1);
      return new Response(JSON.stringify({ data: [{ embedding }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Supabase RPC — cache miss (empty array)
    if (url.includes('routing_cache_lookup')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Supabase cache write
    if (url.includes('routing_cache')) {
      return new Response('', { status: 201 });
    }
    return new Response('not found', { status: 404 });
  };
}

function makeCacheHitFetch(): FetchMockFn {
  return async (url) => {
    if (url.includes('voyageai.com')) {
      return new Response(
        JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('routing_cache_lookup')) {
      const row = {
        id: 'cache-row-1',
        classification: {
          intent: 'acquire',
          language: 'en',
          items: [{ name: 'milk', canonical: 'milk', category: 'dairy', intent: 'acquire', target: 'shopping' }],
        },
        language: 'en',
      };
      return new Response(JSON.stringify([row]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // hit_count PATCH
    if (url.includes('routing_cache')) {
      return new Response('', { status: 204 });
    }
    return new Response('not found', { status: 404 });
  };
}

function makeGroqFetch(classification: unknown): FetchMockFn {
  return async (url) => {
    if (url.includes('voyageai.com')) {
      return new Response(
        JSON.stringify({ data: [{ embedding: Array(1024).fill(0.05) }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('routing_cache_lookup')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('api.groq.com')) {
      const groqResp = {
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'classify_grocery_items',
                arguments: JSON.stringify(classification),
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      };
      return new Response(JSON.stringify(groqResp), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // cache write
    if (url.includes('routing_cache')) {
      return new Response('', { status: 201 });
    }
    return new Response('not found', { status: 404 });
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('/route/:module — routing', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── guard rails ───────────────────────────────────────────────────────────

  it('returns 404 for unknown module', async () => {
    const req = makeReq({ text: 'buy milk' }, 'unknown_module');
    const res = await handleRoute(req, makeEnv(), 'unknown_module');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unknown_module');
  });

  it('returns 400 for missing text', async () => {
    const req = makeReq({ text: '' });
    const res = await handleRoute(req, makeEnv(), 'grocery');
    expect(res.status).toBe(400);
  });

  it('returns 400 for bad JSON', async () => {
    const req = new Request('https://worker.dev/route/grocery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await handleRoute(req, makeEnv(), 'grocery');
    expect(res.status).toBe(400);
  });

  it('returns 413 when Content-Length exceeds the body cap (audit #38)', async () => {
    const req = new Request('https://worker.dev/route/grocery', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(512 * 1024) },
      body: JSON.stringify({ text: 'buy milk' }),
    });
    const res = await handleRoute(req, makeEnv(), 'grocery');
    expect(res.status).toBe(413);
  });

  it('returns 413 when parsed text exceeds the char cap (audit #38)', async () => {
    const req = makeReq({ text: 'x'.repeat(10_001) });
    const res = await handleRoute(req, makeEnv(), 'grocery');
    expect(res.status).toBe(413);
    expect((await res.json() as { error: string }).error).toBe('text_too_large');
  });

  it('returns 401 when T0_JWT_ENFORCED=1 and no auth header', async () => {
    const req = makeReq({ text: 'buy milk' });
    const res = await handleRoute(req, makeEnv({ T0_JWT_ENFORCED: '1' }), 'grocery');
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  // ── cache hit path ────────────────────────────────────────────────────────

  it('cache hit: returns source=cache_hit with classification', async () => {
    fetchSpy.mockImplementation(makeCacheHitFetch() as unknown as typeof fetch);

    const req = makeReq({ text: 'need to get milk', dumpId: 'dump-1' });
    const res = await handleRoute(req, makeEnv(), 'grocery');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      source: string;
      latencyMs: number;
      classification: { items: unknown[] };
      language: string;
    };
    expect(body.source).toBe('cache_hit');
    expect(body.language).toBe('en');
    expect(Array.isArray(body.classification.items)).toBe(true);
    expect(body.classification.items).toHaveLength(1);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('cache hit: fires hit_count PATCH update async', async () => {
    const fetchMock = vi.fn(makeCacheHitFetch() as unknown as typeof fetch);
    fetchSpy.mockImplementation(fetchMock);

    const req = makeReq({ text: 'need eggs' });
    await handleRoute(req, makeEnv(), 'grocery');

    // Give the fire-and-forget PATCH a tick to run
    await new Promise((r) => setTimeout(r, 10));

    const patchCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('routing_cache') && !url.includes('lookup'),
    );
    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('cache hit: increments via the routing_cache_increment RPC (S2 · fix 2), not a broken PATCH', async () => {
    const fetchMock = vi.fn(makeCacheHitFetch() as unknown as typeof fetch);
    fetchSpy.mockImplementation(fetchMock);

    await handleRoute(makeReq({ text: 'need eggs' }), makeEnv(), 'grocery');
    await new Promise((r) => setTimeout(r, 10)); // let the fire-and-forget RPC run

    const incCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('rpc/routing_cache_increment'),
    );
    expect(incCall).toBeDefined();

    const [, init] = incCall as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    // Atomic SQL increment by id — NEVER the PostgREST `{ increment: 1 }` object
    // that silently failed and left hit_count pinned at 0.
    expect(body).toEqual({ p_id: 'cache-row-1' });
    expect(JSON.stringify(body)).not.toContain('increment');
  });

  // ── cache miss → Groq ─────────────────────────────────────────────────────

  it('cache miss: calls Groq, returns source=groq_miss', async () => {
    const classification = {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'bread', canonical: 'bread', category: 'pantry', intent: 'acquire', target: 'shopping', shelfLifeDays: 7 },
      ],
    };
    fetchSpy.mockImplementation(makeGroqFetch(classification) as unknown as typeof fetch);

    const req = makeReq({ text: 'grab some bread', dumpId: 'dump-2' });
    const res = await handleRoute(req, makeEnv(), 'grocery');

    expect(res.status).toBe(200);
    const body = await res.json() as { source: string; language: string; classification: unknown };
    expect(body.source).toBe('groq_miss');
    expect(body.language).toBe('en');
    expect(body.classification).toBeTruthy();
  });

  it('cache miss: fires cache write async', async () => {
    const classification = {
      intent: 'acquire',
      language: 'tr',
      items: [{ name: 'süt', canonical: 'milk', category: 'dairy', intent: 'acquire', target: 'shopping' }],
    };
    const fetchMock = vi.fn(makeGroqFetch(classification) as unknown as typeof fetch);
    fetchSpy.mockImplementation(fetchMock);

    const req = makeReq({ text: 'süt almam lazım' });
    await handleRoute(req, makeEnv(), 'grocery');
    await new Promise((r) => setTimeout(r, 10));

    const writeCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('routing_cache') &&
        !url.includes('lookup') &&
        (init as RequestInit)?.method === 'POST',
    );
    expect(writeCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── upstream failure paths ────────────────────────────────────────────────

  it('voyage failure returns 502', async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('voyageai.com')) {
        return new Response('rate limited', { status: 429 });
      }
      return new Response('ok', { status: 200 });
    });

    const req = makeReq({ text: 'get apples' });
    const res = await handleRoute(req, makeEnv(), 'grocery');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('voyage_embed_failed');
  });

  it('groq failure returns 502', async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('voyageai.com')) {
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
          { status: 200 },
        );
      }
      if (typeof url === 'string' && url.includes('routing_cache_lookup')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === 'string' && url.includes('api.groq.com')) {
        return new Response('internal error', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    });

    const req = makeReq({ text: 'buy eggs' });
    const res = await handleRoute(req, makeEnv(), 'grocery');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });
});
