/**
 * Tests for /ingest-event:
 *   - table whitelist
 *   - row validation
 *   - US-cycle module_events drop
 *   - Supabase REST mocked, headers asserted
 *   - IDOR: client-supplied identity is overwritten with the server-derived
 *     user_hash from the verified Clerk userId (audit #4)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleIngestEvent, deriveUserHash } from '../src/telemetry';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE: 'service-role-fake',
  USER_HASH_SALT: 'test-salt',
};

const UID = 'user_authenticated_123';

function makeReq(body: unknown): Request {
  return new Request('https://worker.dev/ingest-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleIngestEvent · validation', () => {
  it('rejects missing table with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ row: {} }), ENV, UID);
    expect(resp.status).toBe(400);
  });

  it('rejects unknown table with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ table: 'users', row: {} }), ENV, UID);
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toBe('invalid_table');
  });

  it('rejects non-object row with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ table: 'retention_events', row: 'oops' }), ENV, UID);
    expect(resp.status).toBe(400);
  });

  it('rejects array row with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ table: 'retention_events', row: [] }), ENV, UID);
    expect(resp.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const req = new Request('https://worker.dev/ingest-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const resp = await handleIngestEvent(req, ENV, UID);
    expect(resp.status).toBe(400);
  });
});

describe('handleIngestEvent · US-cycle drop', () => {
  it('silently drops module_events for US + cycle', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const resp = await handleIngestEvent(
      makeReq({ table: 'module_events', row: { country: 'US', module: 'cycle', user_hash: 'x' } }),
      ENV,
      UID,
    );
    expect(resp.status).toBe(200);
    const body = await resp.json() as { ok: boolean; dropped: string };
    expect(body.ok).toBe(true);
    expect(body.dropped).toBe('us_cycle');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does NOT drop module_events for US + non-cycle', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const resp = await handleIngestEvent(
      makeReq({ table: 'module_events', row: { country: 'US', module: 'finance', user_hash: 'x' } }),
      ENV,
      UID,
    );
    expect(resp.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('does NOT drop retention_events for US + cycle (only module_events is gated here)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    await handleIngestEvent(
      makeReq({ table: 'retention_events', row: { country: 'US', module: 'cycle' } }),
      ENV,
      UID,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

describe('handleIngestEvent · Supabase forward', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('POSTs to the correct REST URL with service-role headers; non-identity fields preserved', async () => {
    const row = { user_hash: 'h', event_type: 'installed', event_at: '2026-05-14T00:00:00Z' };
    const resp = await handleIngestEvent(
      makeReq({ table: 'retention_events', row }),
      ENV,
      UID,
    );
    expect(resp.status).toBe(200);
    const body = await resp.json() as { ok: boolean; inserted: number };
    expect(body.ok).toBe(true);
    expect(body.inserted).toBe(1);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    const url = String(callArgs[0]);
    const init = callArgs[1] as RequestInit;
    expect(url).toBe('https://example.supabase.co/rest/v1/retention_events');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('service-role-fake');
    expect(headers.authorization).toBe('Bearer service-role-fake');
    expect(headers.prefer).toBe('return=minimal');
    // Non-identity fields are forwarded untouched.
    const posted = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(posted.event_type).toBe('installed');
    expect(posted.event_at).toBe('2026-05-14T00:00:00Z');
  });

  // ── audit #4 — IDOR ────────────────────────────────────────────────────────
  it('overwrites client user_hash with the server-derived hash from the JWT user', async () => {
    const expected = await deriveUserHash(UID, ENV.USER_HASH_SALT);
    await handleIngestEvent(
      makeReq({ table: 'retention_events', row: { user_hash: 'victim-hash', event_type: 'x' } }),
      ENV,
      UID,
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const posted = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(posted.user_hash).toBe(expected);
    expect(posted.user_hash).not.toBe('victim-hash');
  });

  it('overwrites a spoofed user_id field too', async () => {
    const expected = await deriveUserHash(UID, ENV.USER_HASH_SALT);
    await handleIngestEvent(
      makeReq({ table: 'session_events', row: { user_id: 'someone-else', kind: 'open' } }),
      ENV,
      UID,
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const posted = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(posted.user_id).toBe(expected);
    expect(posted.user_id).not.toBe('someone-else');
  });

  it('derives the same hash for the same user, a different hash for a different user', async () => {
    const a = await deriveUserHash('user_a', ENV.USER_HASH_SALT);
    const a2 = await deriveUserHash('user_a', ENV.USER_HASH_SALT);
    const b = await deriveUserHash('user_b', ENV.USER_HASH_SALT);
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns 502 with a GENERIC error code — does NOT leak the PostgREST body', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValue(new Response('column "foo" does not exist', { status: 400 }));
    const resp = await handleIngestEvent(
      makeReq({ table: 'session_events', row: { foo: 'bar' } }),
      ENV,
      UID,
    );
    expect(resp.status).toBe(502);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.error).toBe('ingest_failed');
    expect(typeof body.request_id).toBe('string');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('column "foo"');
    expect(serialized).not.toContain('does not exist');
    const logLine = errSpy.mock.calls.flat().map(String).join(' ');
    expect(logLine).toContain('column "foo" does not exist');
    expect(logLine).toContain(String(body.request_id));
    errSpy.mockRestore();
  });

  it('returns 500 when Supabase env is missing', async () => {
    const resp = await handleIngestEvent(
      makeReq({ table: 'crisis_events', row: { event_at: 'x' } }),
      { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE: '' },
      UID,
    );
    expect(resp.status).toBe(500);
  });
});
