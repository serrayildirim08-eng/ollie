/**
 * Tests for /ingest-event:
 *   - table whitelist
 *   - row validation
 *   - US-cycle module_events drop
 *   - Supabase REST mocked, headers asserted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleIngestEvent } from '../src/telemetry';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE: 'service-role-fake',
};

function makeReq(body: unknown): Request {
  return new Request('https://worker.dev/ingest-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleIngestEvent · validation', () => {
  it('rejects missing table with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ row: {} }), ENV);
    expect(resp.status).toBe(400);
  });

  it('rejects unknown table with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ table: 'users', row: {} }), ENV);
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toBe('invalid_table');
  });

  it('rejects non-object row with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ table: 'retention_events', row: 'oops' }), ENV);
    expect(resp.status).toBe(400);
  });

  it('rejects array row with 400', async () => {
    const resp = await handleIngestEvent(makeReq({ table: 'retention_events', row: [] }), ENV);
    expect(resp.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const req = new Request('https://worker.dev/ingest-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const resp = await handleIngestEvent(req, ENV);
    expect(resp.status).toBe(400);
  });
});

describe('handleIngestEvent · US-cycle drop', () => {
  it('silently drops module_events for US + cycle', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const resp = await handleIngestEvent(
      makeReq({ table: 'module_events', row: { country: 'US', module: 'cycle', user_hash: 'x' } }),
      ENV,
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

  it('POSTs to the correct REST URL with service-role headers', async () => {
    const row = { user_hash: 'h', event_type: 'installed', event_at: '2026-05-14T00:00:00Z' };
    const resp = await handleIngestEvent(
      makeReq({ table: 'retention_events', row }),
      ENV,
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
    expect(init.body).toBe(JSON.stringify(row));
  });

  it('returns 502 + surfaces Supabase error body on non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('column "foo" does not exist', { status: 400 }));
    const resp = await handleIngestEvent(
      makeReq({ table: 'session_events', row: { foo: 'bar' } }),
      ENV,
    );
    expect(resp.status).toBe(502);
    const body = await resp.json() as { ok: boolean; error: string; status: number };
    expect(body.ok).toBe(false);
    expect(body.status).toBe(400);
    expect(body.error).toContain('column "foo"');
  });

  it('returns 500 when Supabase env is missing', async () => {
    const resp = await handleIngestEvent(
      makeReq({ table: 'crisis_events', row: { event_at: 'x' } }),
      { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE: '' },
    );
    expect(resp.status).toBe(500);
  });
});
