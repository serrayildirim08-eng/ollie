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
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
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

// ─── APNs subscriber for pattern:detected ────────────────────────────────

/**
 * Returns the ISO 8601 week key (YYYY-Www) for a given timestamp.
 * Used as the dedup + aggregation discriminator — one push per
 * correlator per week.
 */
function isoWeekKey(ts: number): string {
  const d = new Date(ts);
  // ISO week: Monday = day 1; shift so Monday is 0
  const day = (d.getUTCDay() + 6) % 7;
  // Nearest Thursday (ISO rule: week belongs to the year of its Thursday)
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - day + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface PatternDetectedSubscriberOpts {
  /**
   * APNs push scheduler — injected by the app boot layer.
   * Wraps scheduleServerJob() from @ollie/notifications/server-schedule.
   * No-op when omitted (desktop, web, tests without APNs).
   */
  scheduleNotification: (spec: NotificationSpec, fireAt: number) => void;
  /** Optional clock override (tests). Default Date.now. */
  now?: () => number;
  /** Locale resolver for notification copy. Defaults to 'en'. */
  getLocale?: () => 'en' | 'es' | 'tr';
}

/**
 * Subscribe to `pattern:detected` and forward to APNs.
 *
 * Dedup rules:
 *   - Per correlator per ISO week: dedupe_key = `pattern:{name}:{weekKey}`
 *   - Aggregation: all pattern:detected events in the same recompute pass
 *     share aggregation_group = `pattern:detected:{weekKey}` so the
 *     dispatcher coalesces them into one digest push.
 *
 * Sparse-data guard: copy === '' → silent skip.
 *
 * Returns an unsubscribe function (mirrors finance/sleep teardown pattern).
 *
 * i18n: title key body.patterns.noticed_something; body = pattern copy from correlator.
 * ES key: body.patterns.noticed_something "algo notado" — wired in strings.es.json.
 * Per-correlation ES copy keys: body.patterns.caffeine_sleep, luteal_spending, etc.
 */
export function initPatternDetectedSubscriber(
  opts: PatternDetectedSubscriberOpts,
): Unsubscribe {
  const { scheduleNotification } = opts;
  const getNow = opts.now ?? (() => Date.now());
  const getLocale = opts.getLocale ?? (() => 'en' as const);

  return events.on('pattern:detected', (raw: unknown) => {
    try {
      const p = (raw ?? {}) as {
        correlation_name?: string;
        correlation?: number;
        sample_size?: number;
        copy?: string;
        ts?: number;
      };

      // Sparse-data guard — P6 emits copy:'' when sample insufficient
      if (typeof p.copy !== 'string' || p.copy.trim().length === 0) return;
      if (!p.correlation_name) return;

      const now = typeof p.ts === 'number' ? p.ts : getNow();
      const weekKey = isoWeekKey(now);

      const title = getLocale() === 'es' ? 'algo notado' : 'noticed something';
      scheduleNotification(
        {
          title,
          body: p.copy,
          category: 'PATTERN_ALERT',
          dedupe_key: `pattern:${p.correlation_name}:${weekKey}`,
          aggregation_group: `pattern:detected:${weekKey}`,
          action_url: '/body',
        },
        now,
      );
    } catch { /* non-fatal */ }
  });
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
