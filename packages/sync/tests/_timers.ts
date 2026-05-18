/**
 * @ollie/sync · test-only fake-timer settling helpers.
 *
 * Why this exists
 * ───────────────
 * The sync outbound chain crosses a NATIVE-promise boundary that fake
 * timers do not control:
 *
 *   store.set → subscriber → debounce timer (fake)
 *     → diffAndEnqueue() / pushModule()
 *         → await encryptData()         ← crypto.subtle.* — a NATIVE promise
 *     → .then(() => scheduleDrain())     ← schedules the drain timer (fake)
 *     → drain timer fires → drainOnce()
 *         → await api.…upsert()          ← async mock
 *
 * `vi.runAllTimersAsync()` is a single pass: it drains the *current* fake
 * timer queue, flushing microtasks between ticks. But the drain timer is
 * only created AFTER `encryptData()`'s native promise resolves. WebCrypto
 * resolutions settle on the *real* event loop — not the fake timer queue —
 * so if that resolution lands after the pass has emptied the fake queue, the
 * freshly-scheduled drain timer never runs, the upsert is never issued, and
 * the assertion sees 0.
 *
 * In isolation crypto resolves fast enough that the race is hidden; under a
 * loaded `pnpm -r test` run it is not. That is the documented flake on
 * finance.test.ts:152 (and a latent one on sync.test.ts).
 *
 * The trap: an in-flight `crypto.subtle.*` promise is INVISIBLE — there is
 * no `getPendingNativePromiseCount()`. So any helper that just "runs timers,
 * waits a bit, then exits" is itself a race — a slow-enough WebCrypto op
 * always beats a fixed wait. The ONLY deterministic stop condition is the
 * observable OUTCOME the test is about to assert on.
 *
 * `settleUntil(predicate)` therefore loops — interleaving
 * `runAllTimersAsync()` with yields to the REAL event loop — until the
 * predicate (e.g. "an upsert was captured") is satisfied, or a hard bound is
 * hit. Because it loops on the *actual result*, no amount of crypto slowness
 * can make it return early: it either observes the outcome or the test fails
 * with a clear bounded error. This is the same poll-the-outcome pattern
 * already used in sync.test.ts, generalised and documented.
 *
 * IMPORTANT: import this module at the top of the test file — before any
 * `beforeEach`/`vi.useFakeTimers()` runs — so the real-timer reference below
 * is captured genuine, not faked.
 */

import { vi } from 'vitest';

/**
 * The REAL macrotask scheduler, captured at module-eval time (before any
 * test installs fake timers). We snapshot the function VALUE and bind it —
 * not a `globalThis.setImmediate` lookup — so a later `vi.useFakeTimers()`,
 * which reassigns the global, cannot reach this reference.
 *
 * `setImmediate` exists in Node; fall back to `setTimeout` elsewhere.
 */
const realMacrotask: (cb: () => void) => void = (() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.setImmediate === 'function') {
    const si = g.setImmediate.bind(g) as (cb: () => void) => unknown;
    return (cb: () => void) => { si(cb); };
  }
  const st = g.setTimeout.bind(g) as (cb: () => void, ms: number) => unknown;
  return (cb: () => void) => { st(cb, 0); };
})();

/** Yield to the real event loop for one genuine macrotask. */
function realTick(): Promise<void> {
  return new Promise<void>((resolve) => { realMacrotask(resolve); });
}

/**
 * Drive the debounce → encrypt → drain → upsert chain until `predicate`
 * holds.
 *
 * Each pass: run every pending fake timer (`runAllTimersAsync`), then yield
 * to the REAL event loop so any in-flight `crypto.subtle.*` promise can
 * resolve and arm its follow-up timer. Re-checks `predicate` after every
 * pass and returns as soon as it is true.
 *
 * Deterministic: the stop condition is the observable outcome, not a timer.
 * A slow WebCrypto op only means a few more passes — it cannot cause an
 * early (wrong) return.
 *
 * @param predicate the outcome to wait for (e.g. `() => upserts.length > 0`).
 * @param maxPasses hard bound; if reached, throws so the test fails loudly
 *                  instead of hanging (default 500 — a real chain settles in
 *                  a handful of passes; the bound only fires on a genuine
 *                  bug where the outcome never happens).
 */
export async function settleUntil(
  predicate: () => boolean,
  maxPasses = 500,
): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass++) {
    if (predicate()) return;
    if (vi.getTimerCount() > 0) {
      await vi.runAllTimersAsync();
    }
    // Yield to the REAL event loop so a native crypto.subtle promise can
    // resolve and run its `.then(scheduleDrain)` continuation.
    await realTick();
  }
  if (predicate()) return;
  throw new Error(
    `settleUntil: predicate not satisfied after ${maxPasses} passes — ` +
    `the awaited sync outcome never occurred (genuine bug, not a flake).`,
  );
}

/**
 * Settle the chain when the test asserts the ABSENCE of an outcome (e.g.
 * "no upsert should happen"). There is no positive event to wait for, so we
 * cannot poll an outcome — instead run enough interleaved timer + real-loop
 * passes that any pending WebCrypto continuation has surfaced. `passes`
 * default is generous; for a negative assertion a false "settled" only
 * risks a missed failure, never a flaky pass of a real bug, because the
 * subsequent positive checks in the same test still exercise the chain.
 */
export async function settleQuiet(passes = 30): Promise<void> {
  for (let i = 0; i < passes; i++) {
    if (vi.getTimerCount() > 0) {
      await vi.runAllTimersAsync();
    }
    await realTick();
  }
}
