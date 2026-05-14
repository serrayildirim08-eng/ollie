/**
 * @ollie/orchestrator · body-correlations
 *
 * Daily registry pass that runs every body correlator in
 * `@ollie/logic/body/correlations` and emits `pattern:detected` events
 * for any result that crossed its threshold + sample-size gate.
 *
 * Audit context: audits/AUDIT_body_v2.md infra D — math layer existed
 * (Spearman + Pearson) but never fired across cross-module data. P3
 * shipped caffeine-sleep as the exemplar; this orchestrator wires the
 * rest of the registry.
 *
 * Triggers:
 *   - Daily client-side via `scheduleBodyCorrelationPass(opts)` —
 *     primary path. Mirrors P7 weekly-review approach.
 *   - Server cron at 03:00 UTC via workers/cron/src/index.ts —
 *     piggybacks on existing DAILY_SCHEDULE; handler is a stub today
 *     (server-side decryption deferred).
 *
 * Cooldowns:
 *   Each correlator has its own 24h cooldown to avoid event spam. The
 *   cooldown key is `body._correlationLastEmittedAt:<name>`. Re-emission
 *   is allowed when 24h have elapsed AND the correlation magnitude has
 *   shifted beyond a small noise band (we don't re-spam on flat data).
 *
 * No I/O outside store reads + event emit. No APNs from this layer —
 * that's the notifications/* pod's territory (P2 follow-up). We emit
 * `pattern:detected` only.
 */

import type { Store } from '@ollie/store';
import * as events from '@ollie/events';
import {
  runAllCorrelations,
  takeUserDataSnapshot,
  type CorrelationName,
  type CorrelationRunResult,
  type SnapshotStoreLike,
} from '@ollie/logic/body';

const DAY_MS = 86_400_000;
const COOLDOWN_MS = 24 * 3600 * 1000;
/** A correlation change below this magnitude is considered "no shift". */
const NOISE_BAND = 0.05;

export interface RunBodyCorrelationPassOpts {
  store: Store;
  /** Optional clock override (tests). Default Date.now. */
  now?: () => number;
}

interface CooldownEntry {
  ts: number;
  correlation: number;
}

function cooldownKey(name: CorrelationName): string {
  return `_correlationLastEmittedAt:${name}`;
}

function readCooldown(store: Store, name: CorrelationName): CooldownEntry | null {
  return (
    store.get<CooldownEntry | null>('body', cooldownKey(name), null) ?? null
  );
}

function writeCooldown(
  store: Store,
  name: CorrelationName,
  ts: number,
  correlation: number,
): void {
  store.set('body', cooldownKey(name), { ts, correlation });
}

/**
 * Decide whether to emit. Returns true when:
 *   - never emitted before, OR
 *   - 24h elapsed since last emit AND correlation magnitude shifted by
 *     >= NOISE_BAND.
 */
function shouldEmit(
  prev: CooldownEntry | null,
  result: CorrelationRunResult,
  now: number,
): boolean {
  if (!prev) return true;
  if (now - prev.ts < COOLDOWN_MS) return false;
  if (result.correlation == null) return false;
  const shift = Math.abs(result.correlation - prev.correlation);
  return shift >= NOISE_BAND;
}

/**
 * Run one correlation pass:
 *   1. snapshot the store
 *   2. runAllCorrelations(snapshot)
 *   3. for each detected + non-PENDING result, emit pattern:detected
 *      respecting cooldown
 *
 * Returns the raw results (caller may persist them for the UI to render).
 */
export function runBodyCorrelationPass(
  opts: RunBodyCorrelationPassOpts,
): CorrelationRunResult[] {
  const { store } = opts;
  const getNow = opts.now ?? (() => Date.now());
  const now = getNow();

  const snapshot = takeUserDataSnapshot(store as unknown as SnapshotStoreLike, now);
  const results = runAllCorrelations(snapshot);

  // Persist for UI (mirrors sleep.caffeineSleep convention).
  try {
    store.set('body', 'correlations', results);
    store.set('body', 'correlationsLastComputedAt', now);
  } catch { /* non-fatal */ }

  for (const result of results) {
    if (!result.detected || !result.copy || !result.implemented) continue;
    const prev = readCooldown(store, result.name);
    if (!shouldEmit(prev, result, now)) continue;

    try {
      events.emit('pattern:detected', {
        correlation_name: result.name,
        correlation: result.correlation ?? 0,
        sample_size: result.sampleSize,
        copy: result.copy,
        ts: now,
      });
      writeCooldown(store, result.name, now, result.correlation ?? 0);
    } catch (err) {
      console.warn(
        '[orchestrator/body-correlations] emit failed for',
        result.name,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return results;
}

// ─── client-side daily scheduler ─────────────────────────────────────────

/**
 * Compute next 03:00 LOCAL fire (mirrors weekly-review's nextSunday19
 * pattern). Local 03:00 → daily intelligence layer is when the user is
 * most likely offline + the math runs without competing with foreground
 * work.
 */
export function nextLocal03(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(3, 0, 0, 0);
  if (d.getTime() <= nowMs) {
    // Already past 03:00 today → tomorrow.
    return d.getTime() + DAY_MS;
  }
  return d.getTime();
}

export interface ScheduleBodyCorrelationPassOpts {
  store: Store;
  now?: () => number;
  /** Skip the initial pass on schedule(). Default false. */
  skipFirstRun?: boolean;
}

/**
 * Schedule a daily client-side correlation pass. Returns a teardown fn.
 *
 * Behavior:
 *   - On `schedule()`, runs immediately once (unless skipFirstRun=true)
 *     so cold-start users get a result, then arms the 03:00-local timer.
 *   - After each fire, re-arms for the next 03:00.
 *   - teardown() clears the pending timer.
 *
 * The first-run is debounced via the 24h cooldown inside
 * runBodyCorrelationPass — re-running it 10 minutes after launch
 * doesn't re-emit, it just refreshes the persisted snapshot.
 */
export function scheduleBodyCorrelationPass(
  opts: ScheduleBodyCorrelationPassOpts,
): () => void {
  const getNow = opts.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;

  function arm(): void {
    const now = getNow();
    const fireAt = nextLocal03(now);
    const delay = Math.max(0, fireAt - now);
    timer = setTimeout(() => {
      timer = null;
      try {
        runBodyCorrelationPass({ store: opts.store, now: getNow });
      } catch (err) {
        console.warn('[orchestrator/body-correlations] scheduled pass failed:', err);
      }
      arm();
    }, delay);
  }

  if (!opts.skipFirstRun) {
    try {
      runBodyCorrelationPass({ store: opts.store, now: getNow });
    } catch (err) {
      console.warn('[orchestrator/body-correlations] first-run pass failed:', err);
    }
  }

  arm();

  return () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
}
