/**
 * @ollie/research-stream · C7 foundation tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createResearchStream } from '../src/index';
import type { OllieAPI } from '@ollie/api';

function makeFakeApi(handler: (method: string, url: string, body: unknown) => { ok: boolean; status?: number; data?: unknown; code?: string }): OllieAPI {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: vi.fn(async (method: string, url: string, opts: any) => {
      const r = handler(method, url, opts?.body);
      if (r.ok) return { ok: true, status: r.status ?? 200, data: r.data ?? {} };
      return { ok: false, error: { code: r.code ?? 'http', status: r.status ?? 500, message: 'x' } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anthropic: { proxyUrl: null, route: vi.fn() as any },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { url: null, anonKey: null, rest: { get: vi.fn() as any, upsert: vi.fn() as any, delete: vi.fn() as any }, auth: { signUp: vi.fn() as any, signInWithPassword: vi.fn() as any, refresh: vi.fn() as any, signOut: vi.fn() as any } },
  };
}

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore(createMemoryAdapter());
});

describe('research-stream · consent gate', () => {
  it('default consent is OFF', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    expect(r.hasConsent()).toBe(false);
  });

  it('track() is no-op when consent off', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    r.track('finance.transaction_logged', { amount_band: 'med' });
    expect(r._inspect().queueDepth).toBe(0);
  });

  it('grantConsent() generates a stable device_id', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    r.grantConsent();
    expect(r.hasConsent()).toBe(true);
    expect(r._inspect().deviceId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('withdrawConsent() flips consent off, clears queue + device_id', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    r.grantConsent();
    r.track('x', { y: 1 });
    expect(r._inspect().queueDepth).toBeGreaterThan(0);

    r.withdrawConsent();
    expect(r.hasConsent()).toBe(false);
    expect(r._inspect().queueDepth).toBe(0);
    expect(r._inspect().deviceId).toBeNull();
  });

  it('Görev 1: hasConsent() reads the canonical @ollie/consent necessary flag', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    // No canonical row, no legacy key → master gate is OFF.
    expect(r.hasConsent()).toBe(false);
    // Write the canonical consent.state row directly with necessary on.
    store.set('consent', 'state', {
      necessary: true,
      marketing: false,
      research_optin: false,
      set_at: Date.now(),
      v: 1,
    });
    expect(r.hasConsent()).toBe(true);
  });

  it('Görev 1: withdrawConsent() does NOT flip the canonical necessary flag', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    r.grantConsent(); // writes canonical necessary=true
    r.withdrawConsent();
    // research-stream stops contributing (hasConsent false via local
    // opt-out flag) but the master `necessary` row is untouched — the app
    // still boots; account deletion is the only `necessary` revocation path.
    const canonical = store.get<{ necessary?: boolean } | null>('consent', 'state', null);
    expect(canonical?.necessary).toBe(true);
    expect(r.hasConsent()).toBe(false);
  });
});

describe('research-stream · capture', () => {
  it('queues events with the device_id', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    r.grantConsent();
    r.track('finance.transaction_logged', { amount_band: 'med' });
    const evs = r.exportContributions();
    expect(evs).toHaveLength(1);
    expect(evs[0].device_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(evs[0].type).toBe('finance.transaction_logged');
    expect(evs[0].payload.amount_band).toBe('med');
  });

  it('rounds ts to nearest minute (reduces fingerprinting)', () => {
    const fixedNow = 1_700_000_037_123; // arbitrary ms with seconds
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events', now: () => fixedNow });
    r.grantConsent();
    r.track('x');
    const ev = r.exportContributions()[0];
    expect(ev.ts % 60_000).toBe(0);
  });

  it('does NOT include any PII fields (caller responsibility — but tested by shape)', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    r.grantConsent();
    r.track('cycle.period_logged', {});
    const ev = r.exportContributions()[0];
    expect(ev).not.toHaveProperty('email');
    expect(ev).not.toHaveProperty('user_id');
    expect(Object.keys(ev)).toEqual(expect.arrayContaining(['device_id', 'type', 'ts', 'payload']));
  });
});

describe('research-stream · flush', () => {
  it('POSTs queued events to endpoint then clears them', async () => {
    let received: unknown = null;
    const api = makeFakeApi((m, _u, body) => {
      received = body;
      return { ok: true };
    });
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events', isOnline: () => true });
    r.grantConsent();
    r.track('a', { v: 1 });
    r.track('b', { v: 2 });

    await r.flush();
    expect(received).toEqual({ events: expect.any(Array) });
    expect((received as { events: unknown[] }).events).toHaveLength(2);
    expect(r._inspect().queueDepth).toBe(0);
  });

  it('keeps queue intact when offline', async () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events', isOnline: () => false });
    r.grantConsent();
    r.track('a', {});

    await r.flush();
    expect(r._inspect().queueDepth).toBe(1);
  });

  it('flush is no-op when consent withdrawn', async () => {
    let posted = 0;
    const api = makeFakeApi(() => { posted++; return { ok: true }; });
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events', isOnline: () => true });
    r.grantConsent();
    r.track('a', {});
    r.withdrawConsent();

    await r.flush();
    expect(posted).toBe(0);
  });
});

describe('research-stream · GDPR endpoints', () => {
  it('exportContributions returns the local queue', () => {
    const api = makeFakeApi(() => ({ ok: true }));
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events' });
    r.grantConsent();
    r.track('x', { v: 1 });
    expect(r.exportContributions()).toHaveLength(1);
  });

  it('deleteContributions clears local queue + hits DELETE endpoint', async () => {
    let deletedFor: string | null = null;
    const api = makeFakeApi((m, url) => {
      if (m === 'DELETE') {
        deletedFor = url;
        return { ok: true };
      }
      return { ok: true };
    });
    const r = createResearchStream({ store, api, endpointUrl: 'https://research/api/events', isOnline: () => true });
    r.grantConsent();
    const id = r._inspect().deviceId;
    r.track('x', {});

    await r.deleteContributions();
    expect(r._inspect().queueDepth).toBe(0);
    expect(deletedFor).toBe(`https://research/api/events/by-device/${id}`);
  });
});
