/**
 * Tests for the fire-and-forget enrich-dump bridge.
 *
 * We test the POST shape + the guard conditions. The React hook
 * (useApplyBrainDump) consumes this module; testing the bridge directly
 * keeps the hook tests light.
 */

import { describe, it, expect, vi } from 'vitest';
import { postEnrichDump } from './enrich-bridge';

const FIXED_NOW = Date.UTC(2026, 4, 14, 12, 0, 0);

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('postEnrichDump · happy path', () => {
  it('POSTs to <workerUrl>/enrich-dump with the correct shape', () => {
    const fetchImpl: FetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'x', queued: true }), { status: 200 }),
    );
    postEnrichDump(
      {
        user_hash: 'h1',
        device_id: 'iPhone-test',
        app_version: '0.0.1-build.999',
        raw_text: 'cancel Spotify already',
        modality: 'text',
        routing_module: 'finance',
        country: 'TR',
        locale: 'tr-TR',
      },
      { fetchImpl, workerUrl: 'https://worker.dev', now: () => FIXED_NOW },
    );
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn<FetchFn>>;
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://worker.dev/enrich-dump');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      user_hash: 'h1',
      device_id: 'iPhone-test',
      app_version: '0.0.1-build.999',
      raw_text: 'cancel Spotify already',
      modality: 'text',
      routing_module: 'finance',
      country: 'TR',
      locale: 'tr-TR',
      event_ts: new Date(FIXED_NOW).toISOString(),
    });
  });

  it('strips trailing slash on workerUrl', () => {
    const fetchImpl: FetchFn = vi.fn(async () => new Response('{}'));
    postEnrichDump(
      { user_hash: 'h', device_id: 'd', app_version: '0.0.1', raw_text: 'x', modality: 'text', routing_module: null, country: 'INTL', locale: 'en' },
      { fetchImpl, workerUrl: 'https://worker.dev/' },
    );
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn<FetchFn>>;
    expect(spy.mock.calls[0][0]).toBe('https://worker.dev/enrich-dump');
  });
});

describe('postEnrichDump · guards', () => {
  it('no-op when workerUrl is undefined', () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    postEnrichDump(
      { user_hash: 'h', device_id: 'd', app_version: '0.0.1', raw_text: 'x', modality: 'text', routing_module: null, country: 'INTL', locale: 'en' },
      { fetchImpl, workerUrl: undefined },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no-op when user_hash is empty', () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    postEnrichDump(
      { user_hash: '', device_id: 'd', app_version: '0.0.1', raw_text: 'x', modality: 'text', routing_module: null, country: 'INTL', locale: 'en' },
      { fetchImpl, workerUrl: 'https://worker.dev' },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no-op when raw_text is empty', () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    postEnrichDump(
      { user_hash: 'h', device_id: 'd', app_version: '0.0.1', raw_text: '', modality: 'text', routing_module: null, country: 'INTL', locale: 'en' },
      { fetchImpl, workerUrl: 'https://worker.dev' },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('swallows fetch rejection silently', () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('network down')));
    // Should not throw.
    expect(() => {
      postEnrichDump(
        { user_hash: 'h', device_id: 'd', app_version: '0.0.1', raw_text: 'x', modality: 'text', routing_module: null, country: 'INTL', locale: 'en' },
        { fetchImpl, workerUrl: 'https://worker.dev' },
      );
    }).not.toThrow();
  });
});
