/**
 * Tests for the brain-dump enrichment queue drain.
 *   - KV list → 3 fake entries
 *   - Anthropic mocked
 *   - Supabase REST inserts mocked
 *   - KV delete verified on success
 *   - retry counter + DLQ verified on failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainEnrichQueue, type QueuedDump } from '../src/drain';

function makeKv(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    data,
    kv: {
      put: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
      get: vi.fn(async (key: string) => data.get(key) ?? null),
      delete: vi.fn(async (key: string) => { data.delete(key); }),
      list: vi.fn(async ({ prefix, limit }: { prefix: string; limit?: number }) => {
        // Mirror Cloudflare KV: list returns ALL keys under the prefix up to
        // `limit`, in lexicographic order. Honoring `limit` lets us pin audit
        // #42 — a retry counter sharing the prefix would consume the budget.
        const sorted = [...data.keys()].filter(k => k.startsWith(prefix)).sort();
        const capped = typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
        return { keys: capped.map(name => ({ name })) };
      }),
    } as unknown as KVNamespace,
  };
}

function fakeDump(id: string, over: Partial<QueuedDump['payload']> = {}): QueuedDump {
  return {
    id,
    payload: {
      user_hash: 'h-' + id,
      device_id: 'd-' + id,
      event_ts: '2026-05-14T23:47:00Z',
      locale: 'en-US',
      country: 'INTL',
      modality: 'text',
      scrubbed_text: 'cancel Spotify already',
      char_count: 22,
      routing_module: 'finance',
      app_version: '0.0.1',
      ...over,
    },
    queued_at: '2026-05-14T23:47:01Z',
  };
}

function fakeAnthropicResponse(): Response {
  return new Response(JSON.stringify({
    content: [{ text: JSON.stringify({
      sectors: ['cpg'],
      brands: ['spotify'],
      topic: 'subscription_cancel_intent',
      sentiment: 'frustrated',
      intent: 'cancel',
      urgency: 'low',
      demographic_hints: null,
    }) }],
    usage: { input_tokens: 300, output_tokens: 80 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const ENV_BASE = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE: 'service-role-fake',
  // Minimal Fetcher stub — only `.fetch` is exercised by drainEnrichQueue.
  AI_PROXY: {
    fetch: async (_input: unknown, _init?: unknown) => fakeAnthropicResponse(),
  } as unknown as Fetcher,
};

describe('drainEnrichQueue · happy path', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('drains 3 entries: Anthropic + raw_dumps + enriched_signals + KV delete', async () => {
    const dumps = [fakeDump('a'), fakeDump('b'), fakeDump('c')];
    const { kv, data } = makeKv({
      'q:enrich:1715000000000:a': JSON.stringify(dumps[0]),
      'q:enrich:1715000000001:b': JSON.stringify(dumps[1]),
      'q:enrich:1715000000002:c': JSON.stringify(dumps[2]),
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/rest/v1/raw_dumps')) return new Response(null, { status: 201 });
      if (url.includes('/rest/v1/enriched_signals')) return new Response(null, { status: 201 });
      throw new Error('unexpected url ' + url);
    });

    const stats = await drainEnrichQueue({ CACHE_KV: kv, ...ENV_BASE });
    expect(stats.scanned).toBe(3);
    expect(stats.succeeded).toBe(3);
    expect(stats.failed).toBe(0);
    expect(stats.dlq).toBe(0);

    // KV: all live keys deleted
    expect([...data.keys()].filter(k => k.startsWith('q:enrich:'))).toHaveLength(0);

    // 3 raw + 3 signals (3 anthropic now via AI_PROXY service binding)
    expect(fetchSpy).toHaveBeenCalledTimes(6);

    fetchSpy.mockRestore();
  });

  it('caps at 50 entries per run', async () => {
    const seed: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      seed[`q:enrich:1715000000${String(i).padStart(3, '0')}:id${i}`] = JSON.stringify(fakeDump('id' + i));
    }
    const { kv } = makeKv(seed);

    let listCalledWith: { prefix: string; limit?: number } | undefined;
    (kv.list as unknown as { mockImplementation: (fn: (opts: { prefix: string; limit?: number }) => unknown) => void })
      .mockImplementation(async ({ prefix, limit }: { prefix: string; limit?: number }) => {
        listCalledWith = { prefix, limit };
        return {
          keys: Object.keys(seed).filter(k => k.startsWith(prefix)).slice(0, limit ?? 1000).map(name => ({ name })),
        };
      });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(null, { status: 201 });
    });

    const stats = await drainEnrichQueue({ CACHE_KV: kv, ...ENV_BASE });
    expect(listCalledWith?.limit).toBe(50);
    expect(stats.scanned).toBeLessThanOrEqual(50);
    fetchSpy.mockRestore();
  });
});

describe('drainEnrichQueue · failure modes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('leaves the KV entry intact on Anthropic 500 + bumps retry counter', async () => {
    const dump = fakeDump('x');
    const { kv, data } = makeKv({
      'q:enrich:1715000000000:x': JSON.stringify(dump),
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );

    const stats = await drainEnrichQueue({ CACHE_KV: kv, ...ENV_BASE });
    expect(stats.failed).toBe(1);
    expect(stats.succeeded).toBe(0);
    expect(data.get('q:enrich:1715000000000:x')).toBeDefined();
    // Retry counter lives under a DISJOINT prefix (audit #42) so it can't be
    // returned by the BATCH_CAP-limited list({ prefix: 'q:enrich:' }) scan.
    expect(data.get('qretry:enrich:x')).toBe('1');

    fetchSpy.mockRestore();
  });

  it('moves to DLQ after 12 retries', async () => {
    const dump = fakeDump('y');
    const seed: Record<string, string> = {
      'q:enrich:1715000000000:y': JSON.stringify(dump),
      'qretry:enrich:y': '11', // next attempt will be the 12th (disjoint prefix, audit #42)
    };
    const { kv, data } = makeKv(seed);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );

    const stats = await drainEnrichQueue({ CACHE_KV: kv, ...ENV_BASE });
    expect(stats.dlq).toBe(1);
    expect(data.get('q:enrich:1715000000000:y')).toBeUndefined();
    expect(data.get('dlq:enrich:y')).toBeDefined();
    expect(data.get('qretry:enrich:y')).toBeUndefined();

    fetchSpy.mockRestore();
  });

  it('retry counters do NOT consume the BATCH_CAP budget (audit #42)', async () => {
    // Seed 50 real payloads, each with a sibling retry counter. With the OLD
    // overlapping prefix (`q:enrich:retry:*`) the counters would sort BEFORE
    // the numeric payload keys and eat the 50-key list budget, so few/no real
    // dumps would be scanned. With the disjoint `qretry:enrich:*` prefix the
    // counters are invisible to the scan, so all 50 payloads process.
    const seed: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      const id = String(i).padStart(3, '0');
      seed[`q:enrich:1715000000${id}:${id}`] = JSON.stringify(fakeDump(id));
      seed[`qretry:enrich:${id}`] = '1';
    }
    const { kv } = makeKv(seed);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/rest/v1/')) return new Response(null, { status: 201 });
        return fakeAnthropicResponse();
      });

    const stats = await drainEnrichQueue({ CACHE_KV: kv, ...ENV_BASE });
    expect(stats.scanned).toBe(50);
    expect(stats.succeeded).toBe(50);

    fetchSpy.mockRestore();
  });

  it('moves corrupt JSON to DLQ', async () => {
    const { kv, data } = makeKv({
      'q:enrich:1715000000000:bad': '{not json',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const stats = await drainEnrichQueue({ CACHE_KV: kv, ...ENV_BASE });
    expect(stats.dlq).toBe(1);
    expect(data.get('q:enrich:1715000000000:bad')).toBeUndefined();
    expect([...data.keys()].some(k => k.startsWith('dlq:enrich:corrupt:'))).toBe(true);
    fetchSpy.mockRestore();
  });

  it('leaves KV intact if raw_dumps INSERT fails (no orphan enriched row)', async () => {
    const { kv, data } = makeKv({
      'q:enrich:1715000000000:z': JSON.stringify(fakeDump('z')),
    });
    let enrichedInserts = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/v1/messages')) return fakeAnthropicResponse();
      if (url.includes('/rest/v1/raw_dumps')) return new Response('fk error', { status: 400 });
      if (url.includes('/rest/v1/enriched_signals')) { enrichedInserts++; return new Response(null, { status: 201 }); }
      throw new Error('unexpected ' + url);
    });

    const stats = await drainEnrichQueue({ CACHE_KV: kv, ...ENV_BASE });
    expect(stats.failed).toBe(1);
    expect(enrichedInserts).toBe(0);
    expect(data.get('q:enrich:1715000000000:z')).toBeDefined();

    fetchSpy.mockRestore();
  });
});
