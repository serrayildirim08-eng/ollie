/**
 * Tests for GET /shelf-life/all and GET /shelf-life/lookup/:item.
 *
 * Covered:
 *   - /all: 200 with non-empty items + aliases + version
 *   - /all: ETag is stable across two consecutive calls
 *   - /all: If-None-Match (matching) → 304
 *   - /all: Cache-Control: public, max-age=86400 header present
 *   - /lookup/milk → 200 with canonical:'milk' + days + category
 *   - /lookup/süt → resolves via alias to canonical:'milk'
 *   - /lookup/Milk → resolves via case normalization
 *   - /lookup/toilet%20paper → percent-decoding works
 *   - /lookup/asdfqwerty → 404
 *   - /lookup/ (empty) → 404, not 500
 *   - /lookup rate-limit kicks in after the configured budget
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index';

type WorkerEnv = Parameters<typeof worker.fetch>[1];

// ─── env stubs ───────────────────────────────────────────────────────────────

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

/**
 * Build the worker env. By default no RateLimiter binding is provided, so
 * the worker falls back to the KV fixed-window counter (RATE_MAX = 10/min).
 * Tests that want to validate rate-limit semantics use this default; tests
 * that don't care provide a permissive limiter to avoid flakes.
 */
function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-fake',
    CACHE_KV: makeKv(),
    RATE_KV: makeKv(),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-fake',
    SUPABASE_ANON_KEY: 'anon-fake',
    T0_JWT_ENFORCED: '0',
    ...overrides,
  } as unknown as WorkerEnv;
}

function makeReq(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.dev${path}`, {
    method: 'GET',
    headers: {
      // Provide a stable rate-limit key so identical-bucket tests work without
      // depending on Cloudflare's CF-Connecting-IP injection in test env.
      'x-user-id': 'test-user',
      ...headers,
    },
  });
}

// ─── /shelf-life/all ─────────────────────────────────────────────────────────

describe('GET /shelf-life/all', () => {
  it('returns 200 with non-empty items + aliases + version', async () => {
    const resp = await worker.fetch(makeReq('/shelf-life/all'), makeEnv());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      items: Record<string, { days: number; category: string }>;
      aliases: Record<string, string>;
      version: string;
    };
    expect(Object.keys(body.items).length).toBeGreaterThan(500);
    expect(Object.keys(body.aliases).length).toBeGreaterThan(50);
    expect(body.version).toMatch(/^[0-9a-f]{8}$/);
    // Spot-check a known canonical so we know the data flowed through.
    expect(body.items.milk).toBeDefined();
    expect(body.items.milk.category).toBe('dairy');
  });

  it('ETag is stable across two consecutive calls', async () => {
    const env = makeEnv();
    const a = await worker.fetch(makeReq('/shelf-life/all'), env);
    const b = await worker.fetch(makeReq('/shelf-life/all'), env);
    const etagA = a.headers.get('etag');
    const etagB = b.headers.get('etag');
    expect(etagA).toBeTruthy();
    expect(etagA).toBe(etagB);
  });

  it('If-None-Match with matching ETag returns 304', async () => {
    const env = makeEnv();
    const first = await worker.fetch(makeReq('/shelf-life/all'), env);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await worker.fetch(
      makeReq('/shelf-life/all', { 'if-none-match': etag as string }),
      env,
    );
    expect(second.status).toBe(304);
    // 304 must still carry the validators for the caller's revalidation logic.
    expect(second.headers.get('etag')).toBe(etag);
  });

  it('sets Cache-Control: public, max-age=86400', async () => {
    const resp = await worker.fetch(makeReq('/shelf-life/all'), makeEnv());
    expect(resp.headers.get('cache-control')).toBe('public, max-age=86400');
  });
});

// ─── /shelf-life/lookup/:item ────────────────────────────────────────────────

describe('GET /shelf-life/lookup/:item', () => {
  it('200 for canonical English item — returns canonical + days + category', async () => {
    const resp = await worker.fetch(makeReq('/shelf-life/lookup/milk'), makeEnv());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      canonical: string;
      days: number;
      category: string;
      openedDays?: number;
    };
    expect(body.canonical).toBe('milk');
    expect(body.category).toBe('dairy');
    expect(body.days).toBeGreaterThan(0);
  });

  it('resolves Turkish alias `süt` to canonical `milk`', async () => {
    const milk = await worker.fetch(makeReq('/shelf-life/lookup/milk'), makeEnv());
    const sut = await worker.fetch(
      // Encode the diacritic the way a browser would.
      makeReq(`/shelf-life/lookup/${encodeURIComponent('süt')}`),
      makeEnv(),
    );
    expect(sut.status).toBe(200);
    const milkBody = (await milk.json()) as { canonical: string; days: number };
    const sutBody = (await sut.json()) as { canonical: string; days: number };
    expect(sutBody.canonical).toBe('milk');
    expect(sutBody.days).toBe(milkBody.days);
  });

  it('lowercases path-param (Milk → milk)', async () => {
    const resp = await worker.fetch(makeReq('/shelf-life/lookup/Milk'), makeEnv());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { canonical: string };
    expect(body.canonical).toBe('milk');
  });

  it('decodes %20 — `toilet%20paper` → canonical `toilet paper`', async () => {
    const resp = await worker.fetch(
      makeReq('/shelf-life/lookup/toilet%20paper'),
      makeEnv(),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { canonical: string; category: string };
    expect(body.canonical).toBe('toilet paper');
    // Storage bucket — `toilet paper` lives under `cleaning` in SHELF_LIFE_DETAIL.
    expect(typeof body.category).toBe('string');
    expect(body.category.length).toBeGreaterThan(0);
  });

  it('404 for unknown item', async () => {
    const resp = await worker.fetch(
      makeReq('/shelf-life/lookup/asdfqwertynotrealfood'),
      makeEnv(),
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('empty item path returns 404 cleanly (not 500)', async () => {
    const a = await worker.fetch(makeReq('/shelf-life/lookup/'), makeEnv());
    expect(a.status).toBe(404);
    const aBody = (await a.json()) as { error: string };
    expect(aBody.error).toBe('not_found');

    // `/shelf-life/lookup` (no trailing slash) — same.
    const b = await worker.fetch(makeReq('/shelf-life/lookup'), makeEnv());
    expect(b.status).toBe(404);
  });

  it('sets Cache-Control + ETag on 200 lookup', async () => {
    const resp = await worker.fetch(makeReq('/shelf-life/lookup/milk'), makeEnv());
    expect(resp.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(resp.headers.get('etag')).toMatch(/^"[0-9a-f]{8}"$/);
  });

  it('malformed percent-encoding 404s instead of throwing 500', async () => {
    // A lone % is invalid percent-encoding; decodeURIComponent throws.
    // Our handler must catch and map to 404.
    const resp = await worker.fetch(
      // Construct via Request directly because URL would reject this.
      new Request('https://worker.dev/shelf-life/lookup/%E0%A4%A', {
        method: 'GET',
        headers: { 'x-user-id': 'test-user' },
      }),
      makeEnv(),
    );
    expect([400, 404]).toContain(resp.status);
  });
});

// ─── rate limit ──────────────────────────────────────────────────────────────

describe('GET /shelf-life/lookup rate limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin time to a stable window so the KV fixed-window counter is deterministic.
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 429 after exhausting the 10/min budget', async () => {
    // No RateLimiter binding → KV fallback (RATE_MAX = 10/min).
    const env = makeEnv();
    let lastStatus = 0;
    // First 10 calls should succeed (status 200 for the canonical item).
    for (let i = 0; i < 10; i++) {
      const r = await worker.fetch(makeReq('/shelf-life/lookup/milk'), env);
      lastStatus = r.status;
      expect(r.status).toBe(200);
    }
    // The 11th must be rate-limited.
    const limited = await worker.fetch(makeReq('/shelf-life/lookup/milk'), env);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
    expect(lastStatus).toBe(200); // sanity: previous call wasn't already 429
  });
});
