import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  json,
  notFound,
  methodNotAllowed,
  Router,
  upstreamError,
  newRequestId,
} from '../src/index';

describe('worker-http · json', () => {
  it('builds a JSON response with the right content-type', async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('honours a custom status code', () => {
    expect(json({ error: 'bad' }, 400).status).toBe(400);
  });

  it('merges extra headers', () => {
    const res = json({ ok: true }, 200, { 'x-ollie-cache': 'hit' });
    expect(res.headers.get('x-ollie-cache')).toBe('hit');
    expect(res.headers.get('content-type')).toBe('application/json');
  });
});

describe('worker-http · error helpers', () => {
  it('notFound is a 404 not_found body', async () => {
    const res = notFound();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('methodNotAllowed is a 405 method_not_allowed body', async () => {
    const res = methodNotAllowed();
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });
});

// ─── S8 · upstream error bodies must not leak to the caller ───────────────────

describe('worker-http · S8 · upstreamError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a GENERIC body — error code + request_id, NO upstream detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A realistic PostgREST error body — discloses table + constraint names.
    const postgrestBody = JSON.stringify({
      code: '23505',
      details: 'Key (code)=(olli-abcd-efgh) already exists.',
      message: 'duplicate key value violates unique constraint "invites_code_key"',
    });
    const res = upstreamError('supabase_error', 502, postgrestBody);
    expect(res.status).toBe(502);

    const body = (await res.json()) as Record<string, unknown>;
    // Caller sees ONLY the generic code + a correlation id.
    expect(body.error).toBe('supabase_error');
    expect(typeof body.request_id).toBe('string');
    expect((body.request_id as string).length).toBeGreaterThan(0);
    // None of the PostgREST schema detail leaks to the caller.
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('invites_code_key');
    expect(JSON.stringify(body)).not.toContain('23505');
    expect(JSON.stringify(body)).not.toContain('already exists');
  });

  it('logs the FULL upstream detail server-side, tagged with the same request_id', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const detail = 'constraint "research_corpus_pkey" violated';
    const res = upstreamError('corpus_insert_failed', 502, detail, { endpoint: 'label' });
    const body = (await res.json()) as { request_id: string };

    // The detail IS in the server log...
    expect(errSpy).toHaveBeenCalled();
    const logLine = errSpy.mock.calls.flat().map(String).join(' ');
    expect(logLine).toContain('research_corpus_pkey');
    expect(logLine).toContain('corpus_insert_failed');
    // ...tagged with the SAME request_id the caller received (correlation).
    expect(logLine).toContain(body.request_id);
  });

  it('defaults to status 502 and accepts an override', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(upstreamError('x').status).toBe(502);
    expect(upstreamError('x', 503).status).toBe(503);
  });

  it('handles a non-string detail without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = upstreamError('x', 502, { nested: { secret: 'value' } });
    const body = (await res.json()) as Record<string, unknown>;
    // Object detail still never reaches the caller.
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('newRequestId produces unique, non-empty ids', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('worker-http · Router re-export', () => {
  it('routes a request by method + path', async () => {
    const router = Router();
    router
      .get('/health', () => json({ ok: true }))
      .all('*', () => notFound());

    const ok = await router.fetch(new Request('https://x/health'));
    expect(ok.status).toBe(200);

    const miss = await router.fetch(new Request('https://x/nope'));
    expect(miss.status).toBe(404);
  });
});
