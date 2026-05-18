/**
 * @ollie/sync · retry helpers (item #13)
 *
 * Verifies the shared debouncer and the exponential-backoff drain
 * scheduler — in particular that the max-attempt cap actually stops a
 * persistently-failing server from being retried forever.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDebouncer, createBackoffScheduler, safeErrSummary } from '../src/retry';

// ─── S4 · no secret leakage in error logs ─────────────────────────────────────

describe('@ollie/sync · S4 · safeErrSummary', () => {
  it('drops secret-bearing fields, keeps message + status/code', () => {
    const leaky = {
      name: 'PostgrestError',
      message: 'row level security violation',
      status: 401,
      code: 'PGRST301',
      // a Supabase/fetch error can embed the originating Request:
      config: { headers: { Authorization: 'Bearer eyJSECRETJWT', apikey: 'SERVICE_ROLE_KEY' } },
      body: '{"encrypted_payload":"AES_CIPHERTEXT_SECRET"}',
    };
    const s = safeErrSummary(leaky);
    expect(s).toContain('row level security violation');
    expect(s).toContain('status=401');
    expect(s).toContain('code=PGRST301');
    expect(s).not.toContain('Bearer');
    expect(s).not.toContain('eyJSECRETJWT');
    expect(s).not.toContain('SERVICE_ROLE_KEY');
    expect(s).not.toContain('apikey');
    expect(s).not.toContain('encrypted_payload');
    expect(s).not.toContain('AES_CIPHERTEXT_SECRET');
  });

  it('never JSON.stringifies an arbitrary object (the old leak vector)', () => {
    const obj = { secretField: 'TOP_SECRET', message: 'fail' };
    const s = safeErrSummary(obj);
    expect(s).not.toContain('TOP_SECRET');
    expect(s).not.toContain('secretField');
  });

  it('handles string / null / number inputs safely', () => {
    expect(safeErrSummary('boom')).toBe('boom');
    expect(safeErrSummary(null)).toBe('unknown error');
    expect(safeErrSummary(7)).toBe('non-error thrown value');
  });

  it('the scheduler logs only a safe summary when run() rejects with a leaky error', async () => {
    vi.useRealTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // `run` rejects with an error object carrying a JWT — the S4 hazard.
      const scheduler = createBackoffScheduler(
        () =>
          Promise.reject({
            message: 'drain failed',
            status: 502,
            config: { headers: { Authorization: 'Bearer eyJLEAKED' } },
            body: '{"encrypted_payload":"CIPHERTEXT_SECRET"}',
          }),
        { maxAttempts: 0 },
      );
      scheduler.schedule(0);
      await new Promise((res) => setTimeout(res, 5));
      expect(errSpy).toHaveBeenCalled();
      // Every argument of every console.error call must be a safe string.
      for (const call of errSpy.mock.calls) {
        for (const arg of call) {
          expect(typeof arg).toBe('string');
          const s = String(arg);
          expect(s).not.toContain('Bearer');
          expect(s).not.toContain('eyJLEAKED');
          expect(s).not.toContain('encrypted_payload');
          expect(s).not.toContain('CIPHERTEXT_SECRET');
        }
      }
      // The safe summary still carries the diagnostic message.
      expect(errSpy.mock.calls.flat().map(String).join(' ')).toContain('drain failed');
      scheduler.cancel();
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('createDebouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the trailing call once after the delay', () => {
    const d = createDebouncer<string>(300);
    const fn = vi.fn();
    d.schedule('k', fn);
    d.schedule('k', fn);
    d.schedule('k', fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('debounces each key independently', () => {
    const d = createDebouncer<string>(300);
    const a = vi.fn();
    const b = vi.fn();
    d.schedule('a', a);
    d.schedule('b', b);
    vi.advanceTimersByTime(300);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('cancelAll() drops every pending timer', () => {
    const d = createDebouncer<string>(300);
    const fn = vi.fn();
    d.schedule('k', fn);
    d.cancelAll();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('createBackoffScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedule() runs the drain once', async () => {
    const run = vi.fn();
    const s = createBackoffScheduler(run);
    s.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff between retries', () => {
    const run = vi.fn();
    const s = createBackoffScheduler(run, { baseDelayMs: 1000, maxAttempts: 5 });

    // attempt 0 -> 1000ms
    s.scheduleRetry();
    vi.advanceTimersByTime(999);
    expect(run).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    // attempt 1 -> 2000ms
    s.scheduleRetry();
    vi.advanceTimersByTime(1999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);

    // attempt 2 -> 4000ms
    s.scheduleRetry();
    vi.advanceTimersByTime(4000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('STOPS retrying once the max-attempt cap is reached', () => {
    // Model the real failure loop: a `run` that always fails re-arms the
    // retry. Without a cap this loops forever; the cap must break it.
    const maxAttempts = 3;
    let runCalls = 0;
    const run = () => {
      runCalls++;
      // Every drain fails → ask for another retry, exactly as the sync
      // client's drainOnce() does on a persistently-failing server.
      s.scheduleRetry();
    };
    const s = createBackoffScheduler(run, { baseDelayMs: 100, maxAttempts });

    // Kick off the first retry, then let the clock run for 10 minutes —
    // far longer than any backoff window.
    expect(s.scheduleRetry()).toBe(true);
    vi.advanceTimersByTime(10 * 60 * 1000);

    // The loop is genuinely broken: `run` fired exactly `maxAttempts`
    // times and then stopped, instead of looping forever.
    expect(runCalls).toBe(maxAttempts);
    expect(s.exhausted()).toBe(true);
    expect(s.attempts()).toBe(maxAttempts);
    // Any further retry request is refused.
    expect(s.scheduleRetry()).toBe(false);
  });

  it('reset() clears the failure counter so retries resume', () => {
    const run = vi.fn();
    const s = createBackoffScheduler(run, { baseDelayMs: 100, maxAttempts: 2 });

    expect(s.scheduleRetry()).toBe(true);
    expect(s.scheduleRetry()).toBe(true);
    expect(s.scheduleRetry()).toBe(false); // capped

    s.reset(); // e.g. a successful drain
    expect(s.exhausted()).toBe(false);
    expect(s.scheduleRetry()).toBe(true);  // retries work again
  });

  it('caps the per-retry delay at maxDelayMs', () => {
    const run = vi.fn();
    const s = createBackoffScheduler(run, {
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      maxAttempts: 20,
    });
    // attempt 10 would be 1000 * 2^10 ≈ 1M ms without the cap.
    for (let i = 0; i < 10; i++) {
      s.scheduleRetry();
      vi.advanceTimersByTime(5000); // capped delay always fires within 5s
    }
    expect(run).toHaveBeenCalledTimes(10);
  });
});
