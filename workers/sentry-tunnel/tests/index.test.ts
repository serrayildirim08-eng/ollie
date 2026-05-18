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

function post(body: string): Request {
  return new Request('https://tunnel.test/', { method: 'POST', body });
}

describe('sentry-tunnel worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers an OPTIONS preflight with 204 + CORS headers', async () => {
    const res = await worker.fetch(new Request('https://tunnel.test/', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('405s a non-POST request', async () => {
    const res = await worker.fetch(new Request('https://tunnel.test/', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('400s an envelope with no newline', async () => {
    const res = await worker.fetch(post('{"dsn":"x"}'));
    expect(res.status).toBe(400);
  });

  it('400s a non-JSON envelope header', async () => {
    const res = await worker.fetch(post('not json\nbody'));
    expect(res.status).toBe(400);
  });

  it('400s an envelope header with no dsn', async () => {
    const res = await worker.fetch(post(envelope({ event_id: 'x' }, 'body')));
    expect(res.status).toBe(400);
  });

  it('400s an unparseable dsn', async () => {
    const res = await worker.fetch(post(envelope({ dsn: 'not a url' }, 'body')));
    expect(res.status).toBe(400);
  });

  it('403s a dsn whose host is not the allow-listed Sentry host', async () => {
    const res = await worker.fetch(
      post(envelope({ dsn: `https://key@evil.example.com/${PROJECT}` }, 'body')),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('unknown sentry host');
  });

  it('403s a dsn for an unknown project id', async () => {
    const res = await worker.fetch(
      post(envelope({ dsn: `https://key@${HOST}/9999999999` }, 'body')),
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
    const res = await worker.fetch(post(body));

    expect(res.status).toBe(200);
    expect(calledUrl).toBe(`https://${HOST}/api/${PROJECT}/envelope/`);
    // The raw envelope is forwarded byte-for-byte (Sentry checksum intact).
    expect(calledBody).toBe(body);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
