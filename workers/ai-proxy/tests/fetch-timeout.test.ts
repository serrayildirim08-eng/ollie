/**
 * S2 · fix 3 — per-call upstream timeout.
 *
 * Proves a stalled upstream is aborted into a typed UpstreamTimeoutError
 * (not a 30s hang), and that a fast response passes through untouched.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, UpstreamTimeoutError } from '../src/fetch-timeout';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

describe('fetchWithTimeout', () => {
  it('aborts a stalled upstream and throws a typed UpstreamTimeoutError', async () => {
    // Simulate a hang: never resolve, but reject when the timeout signal aborts.
    fetchSpy.mockImplementation(
      (_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        }) as Promise<Response>,
    );

    const started = Date.now();
    await expect(
      fetchWithTimeout('https://upstream.test/x', { method: 'POST' }, 30, 'voyage'),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
    // It returned because of the timeout, not because it ran to completion.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('UpstreamTimeoutError carries a 504 status for status-branching callers', async () => {
    fetchSpy.mockImplementation(
      (_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }) as Promise<Response>,
    );

    try {
      await fetchWithTimeout('https://upstream.test/x', {}, 20, 'groq');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      expect((err as UpstreamTimeoutError).status).toBe(504);
    }
  });

  it('passes a fast response through unchanged', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const res = await fetchWithTimeout('https://upstream.test/x', {}, 5_000, 'gemini');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
