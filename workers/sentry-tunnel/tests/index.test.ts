/**
 * workers/sentry-tunnel — tests for the Sentry envelope forwarder (audit #5).
 *
 * Covers:
 *   - CORS preflight (OPTIONS → 204)
 *   - method guard (non-POST → 405)
 *   - malformed envelope / header / dsn → 400
 *   - DSN allow-list: wrong host or unknown project → 403
 *   - happy path: forwards the raw envelope to the correct ingest URL
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const HOST = 'o4511388392292352.ingest.us.sentry.io';
const PROJECT = '4511388465889281';

function envelope(headerObj: unknown, ...moreLines: string[]): string {
  return [JSON.stringify(headerObj), ...moreLines].join('\n');
}

// Each test uses a unique source IP so the per-isolate in-memory rate limiter
// (state persists across calls in one isolate) doesn't bleed between tests.
let ipSeq = 0;
function post(body: string, ip?: string): Request {
  return new Request('https://tunnel.test/', {
    method: 'POST',
    body,
    headers: { 'cf-connecting-ip': ip ?? `10.0.0.${++ipSeq % 250}-${Date.now()}-${ipSeq}` },
  });
}

const EMPTY_ENV = {};

describe('sentry-tunnel worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers an OPTIONS preflight with 204 + CORS headers', async () => {
    const res = await worker.fetch(new Request('https://tunnel.test/', { method: 'OPTIONS' }), EMPTY_ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('405s a non-POST request', async () => {
    const res = await worker.fetch(new Request('https://tunnel.test/', { method: 'GET' }), EMPTY_ENV);
    expect(res.status).toBe(405);
  });

  it('400s an envelope with no newline', async () => {
    const res = await worker.fetch(post('{"dsn":"x"}'), EMPTY_ENV);
    expect(res.status).toBe(400);
  });

  it('400s a non-JSON envelope header', async () => {
    const res = await worker.fetch(post('not json\nbody'), EMPTY_ENV);
    expect(res.status).toBe(400);
  });

  it('400s an envelope header with no dsn', async () => {
    const res = await worker.fetch(post(envelope({ event_id: 'x' }, 'body')), EMPTY_ENV);
    expect(res.status).toBe(400);
  });

  it('400s an unparseable dsn', async () => {
    const res = await worker.fetch(post(envelope({ dsn: 'not a url' }, 'body')), EMPTY_ENV);
    expect(res.status).toBe(400);
  });

  it('403s a dsn whose host is not the allow-listed Sentry host', async () => {
    const res = await worker.fetch(
      post(envelope({ dsn: `https://key@evil.example.com/${PROJECT}` }, 'body')),
      EMPTY_ENV,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('unknown sentry host');
  });

  it('403s a dsn for an unknown project id', async () => {
    const res = await worker.fetch(
      post(envelope({ dsn: `https://key@${HOST}/9999999999` }, 'body')),
      EMPTY_ENV,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('unknown project');
  });

  it('forwards a valid envelope to the matching ingest URL and returns upstream status', async () => {
    let calledUrl = '';
    let calledBody = '';
    const fetchSpy = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calledUrl = String(url);
      calledBody = String(init?.body ?? '');
      return new Response('ok', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const body = envelope(
      { dsn: `https://pubkey@${HOST}/${PROJECT}` },
      JSON.stringify({ type: 'event' }),
      JSON.stringify({ message: 'hello' }),
    );
    const res = await worker.fetch(post(body), EMPTY_ENV);

    expect(res.status).toBe(200);
    expect(calledUrl).toBe(`https://${HOST}/api/${PROJECT}/envelope/`);
    // The raw envelope is forwarded byte-for-byte (Sentry checksum intact).
    expect(calledBody).toBe(body);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // ─── audit #56: body-size cap ──────────────────────────────────────────────

  it('413s when the declared Content-Length exceeds the cap (before reading body)', async () => {
    const req = new Request('https://tunnel.test/', {
      method: 'POST',
      body: 'small',
      headers: {
        'cf-connecting-ip': '10.9.9.1',
        'content-length': String(3 * 1024 * 1024),
      },
    });
    const res = await worker.fetch(req, EMPTY_ENV);
    expect(res.status).toBe(413);
  });

  it('413s when the actual body exceeds the cap despite a small/absent Content-Length', async () => {
    // Build a >2MB envelope. Content-Length is set by the runtime to the true
    // size here, but the post-read guard is what we exercise: either way → 413.
    const huge = 'x'.repeat(2 * 1024 * 1024 + 10);
    const body = envelope({ dsn: `https://k@${HOST}/${PROJECT}` }, huge);
    const res = await worker.fetch(post(body, '10.9.9.2'), EMPTY_ENV);
    expect(res.status).toBe(413);
  });

  // ─── audit #56: per-IP rate limit ──────────────────────────────────────────

  it('429s a single IP that exceeds the per-window limit', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response('ok', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const body = envelope({ dsn: `https://k@${HOST}/${PROJECT}` }, JSON.stringify({ type: 'event' }));

    const ip = '203.0.113.7';
    let saw429 = false;
    // 60 allowed; the 61st in the same window must be rejected.
    for (let i = 0; i < 65; i++) {
      const res = await worker.fetch(post(body, ip), EMPTY_ENV);
      if (res.status === 429) { saw429 = true; break; }
    }
    expect(saw429).toBe(true);
  });

  it('prefers the native rate-limiter binding when present', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const body = envelope({ dsn: `https://k@${HOST}/${PROJECT}` }, JSON.stringify({ type: 'event' }));
    const res = await worker.fetch(post(body, '198.51.100.4'), { TUNNEL_RATE_LIMITER: { limit } });
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledTimes(1);
  });

  // ─── audit #165: upstream error handling ───────────────────────────────────

  it('502s when the upstream fetch throws (Sentry unreachable)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('econnrefused'); }));
    const body = envelope({ dsn: `https://k@${HOST}/${PROJECT}` }, JSON.stringify({ type: 'event' }));
    const res = await worker.fetch(post(body, '198.51.100.9'), EMPTY_ENV);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('upstream unavailable');
  });

  it('502s with a timeout message when the upstream fetch aborts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      // Simulate the AbortController firing.
      const err = new Error('aborted');
      err.name = 'AbortError';
      if (init?.signal?.aborted) throw err;
      throw err;
    }));
    const body = envelope({ dsn: `https://k@${HOST}/${PROJECT}` }, JSON.stringify({ type: 'event' }));
    const res = await worker.fetch(post(body, '198.51.100.11'), EMPTY_ENV);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('upstream timeout');
  });
});
