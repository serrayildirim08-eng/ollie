/**
 * Tests for /enrich-dump:
 *   - PII scrub correctness on canned strings
 *   - US-cycle restriction returns queued:false
 *   - happy path enqueues to KV
 *
 * NOTE: test fixtures use deliberately synthetic data
 * (e.g. "Alex Park" / "+1 415 555 0100"). No real PII committed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrubPII } from '../src/pii';
import { handleEnrichDump, deriveUserHash, type EnrichDumpRequest } from '../src/telemetry';

const UID = 'user_enrich_authenticated';
const SALT = 'test-salt';
const ENRICH_ENV = (kv: KVNamespace) => ({ CACHE_KV: kv, USER_HASH_SALT: SALT });

// ─── stub KV ──────────────────────────────────────────────────────────────────

function makeKv() {
  const data = new Map<string, string>();
  const kv = {
    put: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    delete: vi.fn(async (key: string) => { data.delete(key); }),
    list: vi.fn(async () => ({ keys: [...data.keys()].map(name => ({ name })) })),
  };
  return { kv: kv as unknown as KVNamespace, data };
}

function makeReq(body: unknown): Request {
  return new Request('https://worker.dev/enrich-dump', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function basePayload(over: Partial<EnrichDumpRequest> = {}): EnrichDumpRequest {
  return {
    user_hash: 'a3f9deadbeef',
    device_id: 'iPhone-test-1',
    event_ts: '2026-05-14T23:47:00Z',
    locale: 'en-US',
    country: 'INTL',
    modality: 'text',
    raw_text: 'hello world',
    routing_module: 'dump',
    app_version: '0.0.1-build.234',
    ...over,
  };
}

describe('PII scrub · names', () => {
  it('replaces "First Last" with [NAME] in running text', () => {
    const r = scrubPII('reminded by Alex Park about the dentist');
    expect(r.scrubbed).toBe('reminded by [NAME] about the dentist');
    expect(r.hits.name).toBe(1);
  });

  it('does NOT scrub "New York" (stop-listed)', () => {
    const r = scrubPII('flying to New York tomorrow');
    expect(r.scrubbed).toContain('New York');
    expect(r.hits.name).toBe(0);
  });

  it('does NOT scrub sentence-initial capitals (no preceding running text)', () => {
    const r = scrubPII('Good Morning yall');
    expect(r.scrubbed).toBe('Good Morning yall');
  });
});

describe('PII scrub · phones', () => {
  it('scrubs US-formatted phone', () => {
    const r = scrubPII('call me at (415) 555-0100 later');
    expect(r.scrubbed).toContain('[PHONE]');
    expect(r.scrubbed).not.toContain('555-0100');
    expect(r.hits.phone).toBe(1);
  });

  it('scrubs E.164 phone', () => {
    const r = scrubPII('text +14155550100 thanks');
    expect(r.scrubbed).toContain('[PHONE]');
    expect(r.hits.phone).toBe(1);
  });

  it('does not eat short numbers like prices', () => {
    const r = scrubPII('paid $1234 today');
    expect(r.scrubbed).toBe('paid $1234 today');
    expect(r.hits.phone).toBe(0);
  });
});

describe('PII scrub · emails + URLs', () => {
  it('scrubs email', () => {
    const r = scrubPII('email me at test.user+ollie@example.com when done');
    expect(r.scrubbed).toContain('[EMAIL]');
    expect(r.scrubbed).not.toContain('@example.com');
    expect(r.hits.email).toBe(1);
  });

  it('strips URL path but keeps domain', () => {
    const r = scrubPII('saw https://reddit.com/r/adhdwomen/secret-thread');
    expect(r.scrubbed).toContain('https://reddit.com');
    expect(r.scrubbed).not.toContain('secret-thread');
    expect(r.hits.url).toBe(1);
  });
});

describe('PII scrub · address + GPS', () => {
  it('scrubs street address', () => {
    const r = scrubPII('meet at 123 Market Street tonight');
    expect(r.scrubbed).toContain('[ADDRESS]');
    expect(r.scrubbed).not.toContain('Market Street');
    expect(r.hits.address).toBe(1);
  });

  it('scrubs decimal GPS coords', () => {
    const r = scrubPII('dropped pin at 37.7749, -122.4194');
    expect(r.scrubbed).toContain('[GPS]');
    expect(r.scrubbed).not.toContain('37.7749');
    expect(r.hits.gps).toBe(1);
  });
});

describe('PII scrub · combined hostile input', () => {
  it('scrubs name + phone + email + address + URL + GPS together', () => {
    const input =
      'tell Alex Park to call (415) 555-0100 or test@example.com, ' +
      'meet at 500 Mission Street, see https://maps.io/path?q=1, ' +
      'pin 37.7749,-122.4194';
    const r = scrubPII(input);
    expect(r.scrubbed).toContain('[NAME]');
    expect(r.scrubbed).toContain('[PHONE]');
    expect(r.scrubbed).toContain('[EMAIL]');
    expect(r.scrubbed).toContain('[ADDRESS]');
    expect(r.scrubbed).toContain('https://maps.io');
    expect(r.scrubbed).not.toContain('q=1');
    expect(r.scrubbed).toContain('[GPS]');
    // sanity: no raw PII leaks through
    expect(r.scrubbed).not.toContain('Alex Park');
    expect(r.scrubbed).not.toContain('test@example.com');
  });

  it('preserves brand names', () => {
    const r = scrubPII('cancel Spotify and Netflix already');
    expect(r.scrubbed).toContain('Spotify');
    expect(r.scrubbed).toContain('Netflix');
  });
});

// ─── /enrich-dump handler ─────────────────────────────────────────────────────

describe('handleEnrichDump · US-cycle restriction', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns queued:false when country=US AND routing_module=cycle', async () => {
    const { kv } = makeKv();
    const resp = await handleEnrichDump(
      makeReq(basePayload({ country: 'US', routing_module: 'cycle', raw_text: 'cramps today' })),
      ENRICH_ENV(kv),
      UID,
    );
    expect(resp.status).toBe(200);
    const body = await resp.json() as { queued: boolean; reason?: string; id: string | null };
    expect(body.queued).toBe(false);
    expect(body.reason).toBe('us_cycle_restricted');
    expect(body.id).toBeNull();
  });

  it('US user dumping into NON-cycle module is queued normally', async () => {
    const { kv, data } = makeKv();
    const resp = await handleEnrichDump(
      makeReq(basePayload({ country: 'US', routing_module: 'finance' })),
      ENRICH_ENV(kv),
      UID,
    );
    expect(resp.status).toBe(200);
    const body = await resp.json() as { queued: boolean; id: string | null };
    expect(body.queued).toBe(true);
    expect(body.id).toBeTruthy();
    expect(data.size).toBe(1);
  });

  it('TR user with cycle is queued (restriction is US-only)', async () => {
    const { kv, data } = makeKv();
    const resp = await handleEnrichDump(
      makeReq(basePayload({ country: 'TR', routing_module: 'cycle' })),
      ENRICH_ENV(kv),
      UID,
    );
    const body = await resp.json() as { queued: boolean };
    expect(body.queued).toBe(true);
    expect(data.size).toBe(1);
  });
});

describe('handleEnrichDump · happy path', () => {
  it('queues a scrubbed payload with the correct KV key shape', async () => {
    const { kv, data } = makeKv();
    const resp = await handleEnrichDump(
      makeReq(basePayload({ raw_text: 'remind Alex Park to call me at +14155550100' })),
      ENRICH_ENV(kv),
      UID,
    );
    expect(resp.status).toBe(200);

    const keys = [...data.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^q:enrich:\d+:[0-9a-f-]{36}$/);

    const stored = JSON.parse(data.get(keys[0])!) as { payload: { scrubbed_text: string; char_count: number } };
    expect(stored.payload.scrubbed_text).toContain('[NAME]');
    expect(stored.payload.scrubbed_text).toContain('[PHONE]');
    expect(stored.payload.scrubbed_text).not.toContain('Alex Park');
    expect(stored.payload.char_count).toBe(stored.payload.scrubbed_text.length);
  });

  it('rejects invalid modality with 400', async () => {
    const { kv } = makeKv();
    const resp = await handleEnrichDump(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ ...basePayload(), modality: 'pigeon' } as any),
      ENRICH_ENV(kv),
      UID,
    );
    expect(resp.status).toBe(400);
  });

  // ── audit #84 — raw_text length cap ──────────────────────────────────────────
  it('rejects raw_text over the char cap with 413 (audit #84)', async () => {
    const { kv } = makeKv();
    const resp = await handleEnrichDump(
      makeReq(basePayload({ raw_text: 'x'.repeat(10_001) })),
      ENRICH_ENV(kv),
      UID,
    );
    expect(resp.status).toBe(413);
    expect((await resp.json() as { error: string }).error).toBe('raw_text_too_large');
  });

  it('rejects an oversized body on Content-Length with 413 (audit #38)', async () => {
    const { kv } = makeKv();
    const req = new Request('https://worker.dev/enrich-dump', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(128 * 1024) },
      body: JSON.stringify(basePayload()),
    });
    const resp = await handleEnrichDump(req, ENRICH_ENV(kv), UID);
    expect(resp.status).toBe(413);
  });

  // ── audit #4 — IDOR ────────────────────────────────────────────────────────
  it('ignores client user_hash and queues the server-derived hash instead', async () => {
    const { kv, data } = makeKv();
    const expected = await deriveUserHash(UID, SALT);
    const resp = await handleEnrichDump(
      makeReq(basePayload({ user_hash: 'spoofed-victim-hash' })),
      ENRICH_ENV(kv),
      UID,
    );
    expect(resp.status).toBe(200);
    const stored = JSON.parse(data.get([...data.keys()][0])!) as { payload: { user_hash: string } };
    expect(stored.payload.user_hash).toBe(expected);
    expect(stored.payload.user_hash).not.toBe('spoofed-victim-hash');
  });

  it('queues even when client omits user_hash (it is server-derived, not required)', async () => {
    const { kv, data } = makeKv();
    const expected = await deriveUserHash(UID, SALT);
    const resp = await handleEnrichDump(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ ...basePayload(), user_hash: undefined } as any),
      ENRICH_ENV(kv),
      UID,
    );
    expect(resp.status).toBe(200);
    const stored = JSON.parse(data.get([...data.keys()][0])!) as { payload: { user_hash: string } };
    expect(stored.payload.user_hash).toBe(expected);
  });
});
