/**
 * @ollie/sync · shared debounce + retry helpers.
 *
 * Background: both sync clients (index.ts and finance.ts) hand-rolled the
 * same per-key debounce and the same single-timer drain scheduler. The
 * drain scheduler used FIXED delays (2s / 5s) and had NO attempt cap — a
 * server that kept failing would be retried forever.
 *
 * This module provides one debouncer and one backoff scheduler. The
 * scheduler now uses EXPONENTIAL backoff with a max-attempt cap, so a
 * persistently failing server eventually stops being retried instead of
 * looping indefinitely.
 *
 * Pure-ish: timers come from the host (setTimeout/clearTimeout); the clock
 * is not read directly so behaviour is testable with fake timers.
 */

// ─── per-key debouncer ─────────────────────────────────────────────────────────

export interface Debouncer<K> {
  /** (Re)schedule `fn` for `key`; an earlier pending call is cancelled. */
  schedule(key: K, fn: () => void): void;
  /** Cancel every pending timer (used on stop()). */
  cancelAll(): void;
}

/**
 * Per-key trailing debounce. A new `schedule(key, …)` resets the timer for
 * that key; `fn` runs `delayMs` after the last call for the key.
 */
export function createDebouncer<K>(delayMs: number): Debouncer<K> {
  const timers = new Map<K, ReturnType<typeof setTimeout>>();

  return {
    schedule(key, fn) {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.delete(key);
        fn();
      }, delayMs);
      timers.set(key, t);
    },
    cancelAll() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

// ─── exponential-backoff drain scheduler ───────────────────────────────────────

export interface BackoffSchedulerOptions {
  /** Base delay (ms) for the first retry. Default 2000. */
  baseDelayMs?: number;
  /** Cap on any single delay (ms). Default 60000. */
  maxDelayMs?: number;
  /**
   * Max number of *consecutive failed* attempts before the scheduler gives
   * up. Once reached, `scheduleRetry()` is a no-op until `reset()` is
   * called (e.g. by a successful drain or a fresh user-triggered push).
   * Default 8 — with base 2s that is ~8.5 min of total retry window.
   */
  maxAttempts?: number;
}

export interface BackoffScheduler {
  /**
   * Schedule a run. `delayMs` overrides the computed delay (used for the
   * immediate / online-trigger run, delay 0). Coalesces — a run already
   * pending is not double-scheduled.
   */
  schedule(delayMs?: number): void;
  /**
   * Schedule a RETRY after a failure. Uses exponential backoff
   * (base · 2^attempt, capped). Returns false and does nothing once the
   * max-attempt cap is hit, so a persistently failing server stops looping.
   */
  scheduleRetry(): boolean;
  /** Reset the failure counter — call after a successful drain. */
  reset(): void;
  /** Cancel any pending timer. */
  cancel(): void;
  /** Current consecutive-failure count (for tests / diagnostics). */
  attempts(): number;
  /** True once the max-attempt cap has been reached. */
  exhausted(): boolean;
}

/**
 * Single-timer drain scheduler with exponential backoff + a hard attempt
 * cap. `run` is the drain function; it is invoked at most once per
 * scheduled tick.
 */
export function createBackoffScheduler(
  run: () => void | Promise<void>,
  options: BackoffSchedulerOptions = {},
): BackoffScheduler {
  const baseDelayMs = options.baseDelayMs ?? 2_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 8;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  function fire(): void {
    timer = null;
    void Promise.resolve(run()).catch((err) => {
      // A throw from run() itself is treated as a failed attempt.
      // SECURITY (S4): log a safe summary, never the raw error object.
      console.error('[sync] scheduled drain threw:', safeErrSummary(err));
      scheduleRetry();
    });
  }

  function schedule(delayMs = 0): void {
    if (timer) return;
    timer = setTimeout(fire, delayMs);
  }

  function scheduleRetry(): boolean {
    if (attempt >= maxAttempts) {
      // Cap reached — stop. The queue is left intact; a later successful
      // drain (after reset()) or a fresh push restarts the cycle.
      console.warn(`[sync] retry cap (${maxAttempts}) reached — backing off until next reset`);
      return false;
    }
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    attempt++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, delay);
    return true;
  }

  return {
    schedule,
    scheduleRetry,
    reset() {
      attempt = 0;
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    attempts() {
      return attempt;
    },
    exhausted() {
      return attempt >= maxAttempts;
    },
  };
}

// ─── safe error summary ────────────────────────────────────────────────────────

/**
 * SECURITY (S4): collapse an unknown thrown value into a SAFE one-line
 * string fit for `console.*` / Sentry breadcrumbs.
 *
 * A raw error object (or a Supabase/fetch error) can carry the originating
 * Request — headers (`Authorization: Bearer <jwt>`, `apikey`) AND body
 * (encrypted payloads, server passwords). Never log the object itself, its
 * `cause`, or `JSON.stringify(err)` of an arbitrary object. Surface ONLY a
 * short message string and, when present, a numeric `status` / string `code`.
 */
export function safeErrSummary(err: unknown): string {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return err.slice(0, 200);
  if (typeof err === 'object') {
    const o = err as { message?: unknown; name?: unknown; status?: unknown; code?: unknown };
    const parts: string[] = [];
    if (typeof o.name === 'string' && o.name && o.name !== 'Error') parts.push(o.name);
    if (typeof o.message === 'string' && o.message) parts.push(o.message.slice(0, 200));
    else parts.push('error (no message)');
    if (typeof o.status === 'number') parts.push(`status=${o.status}`);
    if (typeof o.code === 'string' && o.code) parts.push(`code=${o.code}`);
    return parts.join(' · ');
  }
  return 'non-error thrown value';
}
