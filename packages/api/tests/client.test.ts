/**
 * @ollie/api · client tests (C6)
 */

import { describe, it, expect, vi } from 'vitest';
import { createOllieAPI } from '../src/client';

function makeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((url: any, init: any) => Promise.resolve(handler(String(url), init))) as typeof fetch;
}

function res(body: unknown, status = 200, ct = 'application/json'): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': ct } });
}

describe('client · basic', () => {
  it('GET parses JSON success', async () => {
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch(() => res({ hello: 'world' })),
    });
    const r = await api.supabase.rest.get<{ hello: string }>('encrypted_state');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.hello).toBe('world');
  });

  it('injects authorization header when authJwt set', async () => {
    let seenAuth = '';
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch((_u, init) => {
        const h = init?.headers as Record<string, string>;
        seenAuth = h.authorization ?? '';
        return res({});
      }),
    });
    await api.supabase.rest.get('encrypted_state', { authJwt: 'jwt-xyz' });
    expect(seenAuth).toBe('Bearer jwt-xyz');
  });

  it('upsert sends prefer + merge-duplicates header', async () => {
    let seenPrefer = '';
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch((_u, init) => {
        const h = init?.headers as Record<string, string>;
        seenPrefer = h.prefer ?? '';
        return res([]);
      }),
    });
    await api.supabase.rest.upsert('encrypted_state', [{ id: 'x' }]);
    expect(seenPrefer).toContain('resolution=merge-duplicates');
  });
});

describe('client · error envelopes', () => {
  it('http status 500 returns http error', async () => {
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch(() => res({ error: 'boom' }, 500)),
      defaultGetRetry: { max: 0, baseDelayMs: 0 },
    });
    const r = await api.supabase.rest.get('encrypted_state');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('http');
      expect(r.error.status).toBe(500);
    }
  });

  it('401 returns unauthorized', async () => {
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch(() => res({ error: 'jwt expired' }, 401)),
      defaultGetRetry: { max: 0, baseDelayMs: 0 },
    });
    const r = await api.supabase.rest.get('encrypted_state', { authJwt: 'expired' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unauthorized');
  });

  it('thrown fetch returns network error', async () => {
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch(() => { throw new Error('offline'); }),
      defaultGetRetry: { max: 0, baseDelayMs: 0 },
    });
    const r = await api.supabase.rest.get('encrypted_state');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('network');
  });

  it('timeout fires with the configured timeoutMs', async () => {
    vi.useFakeTimers();
    const fetchImpl = makeFetch(() => new Promise(() => {/* never */}));
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl,
      defaultGetRetry: { max: 0, baseDelayMs: 0 },
    });
    const p = api.supabase.rest.get('encrypted_state', { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    const r = await p;
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('timeout');
  });
});

describe('client · retry', () => {
  it('GET retries up to max on network error then succeeds', async () => {
    let calls = 0;
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch(() => {
        calls++;
        if (calls < 3) throw new Error('offline');
        return res({ ok: true });
      }),
      defaultGetRetry: { max: 3, baseDelayMs: 1 },
    });
    const r = await api.supabase.rest.get('encrypted_state');
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('POST does NOT retry by default', async () => {
    let calls = 0;
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch(() => {
        calls++;
        return res({ error: 'srv' }, 500);
      }),
    });
    const r = await api.supabase.rest.upsert('encrypted_state', []);
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('GET retries on 5xx, not on 4xx', async () => {
    let calls = 0;
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch(() => {
        calls++;
        return res({ error: 'bad' }, 422);
      }),
      defaultGetRetry: { max: 2, baseDelayMs: 1 },
    });
    const r = await api.supabase.rest.get('encrypted_state');
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
  });
});

describe('client · auth helpers', () => {
  it('signUp POSTs to /auth/v1/signup with email + password', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch((url, init) => {
        seenUrl = url;
        seenBody = init?.body ? JSON.parse(String(init.body)) : null;
        return res({ user: { id: 'u' }, session: null });
      }),
    });
    const r = await api.supabase.auth.signUp('s@example.com', 'random-server-pw');
    expect(r.ok).toBe(true);
    expect(seenUrl).toContain('/auth/v1/signup');
    expect(seenBody).toEqual({ email: 's@example.com', password: 'random-server-pw' });
  });

  it('signInWithPassword posts to grant_type=password', async () => {
    let seenUrl = '';
    const api = createOllieAPI({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      fetchImpl: makeFetch((url) => {
        seenUrl = url;
        return res({ user: { id: 'u' }, session: { access_token: 'a', refresh_token: 'b' } });
      }),
    });
    await api.supabase.auth.signInWithPassword('s@example.com', 'pw');
    expect(seenUrl).toContain('grant_type=password');
  });
});

describe('client · anthropic proxy', () => {
  it('routes when anthropicProxy configured', async () => {
    let seenUrl = '';
    const api = createOllieAPI({
      anthropicProxy: 'https://w.workers.dev/anthropic',
      fetchImpl: makeFetch((url) => { seenUrl = url; return res({ ok: true }); }),
    });
    const r = await api.anthropic.route({ messages: [] });
    expect(r.ok).toBe(true);
    expect(seenUrl).toBe('https://w.workers.dev/anthropic');
  });

  it('returns network error when proxy not configured', async () => {
    const api = createOllieAPI({ fetchImpl: makeFetch(() => res({})) });
    const r = await api.anthropic.route({});
    expect(r.ok).toBe(false);
  });
});
