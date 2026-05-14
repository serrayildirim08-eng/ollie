/**
 * @ollie/capacitor-healthkit · sync pipeline
 *
 * Periodic pull from HealthKit on Capacitor native runtime. Runs every
 * 6 hours by default; the orchestrator caller chooses the interval.
 *
 * Persistence rules — read in concert with the package README + the
 * privacy audit in PRODUCTION_CHECKLIST.md:
 *
 *   1. HealthKit samples NEVER leave the device. We write to two
 *      LOCAL store namespaces only:
 *          healthkit.samples_steps_byDay   → Record<YYYY-MM-DD, number>
 *          healthkit.samples_heartRate     → HealthKitHeartRateSample[]
 *          healthkit.samples_sleep_latest  → HealthKitSleepSample[]
 *          healthkit.samples_restingHR_latest → HealthKitRestingHRSample
 *          healthkit.samples_hydration_today  → HealthKitHydrationSample[]
 *          healthkit.last_sync_at            → number (unix ms)
 *      These keys are NOT in the encrypt-and-sync namespace list used
 *      by @ollie/sync, so they stay local-only by construction.
 *
 *   2. Idempotency: re-running the sync on the same dataset produces
 *      identical store state. Sample ids (HKHealthStore UUID or
 *      deterministic hash) are the dedup key.
 *
 *   3. We do NOT merge into `body.water_log` automatically. The
 *      in-app water glass UI is the canonical log; HealthKit hydration
 *      is a parallel observation we surface separately. (Merging
 *      would create double-counting + confuse the user's mental model.)
 *
 *   4. Sleep samples are MIRRORED into `sleep.records` only when the
 *      user has NO sleep record for that night_of date — HealthKit
 *      is a fallback, not a primary source. The user's brain-dump-
 *      derived sleep record always wins.
 */

import type { Store } from '@ollie/store';
import {
  readHeartRate,
  readHydrationToday,
  readRestingHeartRate,
  readSleepLastNight,
  readSteps,
  type ReaderContext,
} from './read';
import type {
  HealthKitHeartRateSample,
  HealthKitHydrationSample,
  HealthKitRestingHRSample,
  HealthKitSleepSample,
  HealthKitStepSample,
} from './types';
import type { HealthPluginShape } from './runtime';

const NS = 'healthkit';

/** 6h default — the HealthKit equivalent of Plaid's cursor sync window. */
export const HEALTHKIT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface SyncOptions {
  /** Injected clock for tests. */
  now?: () => number;
  /** Injected plugin mock for tests; bypasses runtime detection. */
  pluginOverride?: HealthPluginShape;
  /**
   * When true, mirror sleep samples into `sleep.records` if there's no
   * existing record for that night_of. Default true.
   */
  mirrorSleepIntoSleepNamespace?: boolean;
}

export interface SyncResult {
  ok: boolean;
  /** When false, HealthKit was not available (web/no-plugin/no-permission). */
  ranNative: boolean;
  /** Sample counts per kind, post-normalize. */
  counts: {
    steps: number;
    heartRate: number;
    sleep: number;
    restingHR: number;
    hydration: number;
  };
  /** Last successful sync ms. Equal to `now` on success. */
  lastSyncAt: number;
  /** Non-fatal errors collected during the pass (kept for telemetry). */
  warnings: string[];
}

/**
 * Run one HealthKit pull cycle. Idempotent: ids dedupe both within a
 * call and across calls (re-running over the same data yields the same
 * store state).
 */
export async function syncHealthKit(
  store: Store,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const getNow = opts.now ?? (() => Date.now());
  const now = getNow();
  const mirrorSleep = opts.mirrorSleepIntoSleepNamespace !== false;

  const readerCtx: ReaderContext = {
    now,
    pluginOverride: opts.pluginOverride,
  };

  const warnings: string[] = [];

  // Issue all reads in parallel; HealthKit queries are independent.
  const [stepsRaw, hrRaw, sleepRaw, restingRaw, hydrationRaw] = await Promise.all([
    safe(() => readSteps(2, readerCtx), 'steps', warnings),
    safe(() => readHeartRate(24, readerCtx), 'heartRate', warnings),
    safe(() => readSleepLastNight(readerCtx), 'sleep', warnings),
    safe(() => readRestingHeartRate(readerCtx), 'restingHR', warnings),
    safe(() => readHydrationToday(readerCtx), 'hydration', warnings),
  ]);

  // If every reader returned null we're not in a native runtime — bail
  // without overwriting the store. Calling this on web should not
  // clobber a previously-synced state.
  const ranNative =
    stepsRaw !== null ||
    hrRaw !== null ||
    sleepRaw !== null ||
    restingRaw !== null ||
    hydrationRaw !== null;

  if (!ranNative) {
    return {
      ok: true,
      ranNative: false,
      counts: { steps: 0, heartRate: 0, sleep: 0, restingHR: 0, hydration: 0 },
      lastSyncAt: store.get<number>(NS, 'last_sync_at', 0) ?? 0,
      warnings,
    };
  }

  // ── steps: bucket by local YYYY-MM-DD, sum.
  if (stepsRaw) {
    const stepsByDay = bucketStepsByDay(stepsRaw);
    const prev = store.get<Record<string, number>>(NS, 'samples_steps_byDay', {}) ?? {};
    // Overwrite keys we just observed; leave older keys alone.
    const merged: Record<string, number> = { ...prev, ...stepsByDay };
    store.set(NS, 'samples_steps_byDay', merged);
  }

  // ── heart rate: replace the rolling 24h window.
  if (hrRaw) {
    store.set(NS, 'samples_heartRate', upsertById(
      store.get<HealthKitHeartRateSample[]>(NS, 'samples_heartRate', []) ?? [],
      hrRaw,
    ).slice(-5_000));
  }

  // ── sleep: store + optionally mirror to sleep.records.
  if (sleepRaw) {
    const merged = upsertById(
      store.get<HealthKitSleepSample[]>(NS, 'samples_sleep_latest', []) ?? [],
      sleepRaw,
    );
    store.set(NS, 'samples_sleep_latest', merged);
    if (mirrorSleep) mirrorSleepRecords(store, sleepRaw);
  }

  // ── resting HR: keep latest non-empty.
  if (restingRaw) {
    const latest = pickLatest(restingRaw);
    if (latest) store.set(NS, 'samples_restingHR_latest', latest);
  }

  // ── hydration: today only (UI surfaces alongside in-app water_log).
  if (hydrationRaw) {
    const merged = upsertById(
      store.get<HealthKitHydrationSample[]>(NS, 'samples_hydration_today', []) ?? [],
      hydrationRaw,
    );
    store.set(NS, 'samples_hydration_today', merged);
  }

  store.set(NS, 'last_sync_at', now);

  return {
    ok: true,
    ranNative: true,
    counts: {
      steps: stepsRaw?.length ?? 0,
      heartRate: hrRaw?.length ?? 0,
      sleep: sleepRaw?.length ?? 0,
      restingHR: restingRaw?.length ?? 0,
      hydration: hydrationRaw?.length ?? 0,
    },
    lastSyncAt: now,
    warnings,
  };
}

// ─── helpers (exported for tests) ─────────────────────────────────────

async function safe<T>(
  fn: () => Promise<T | null>,
  label: string,
  warnings: string[],
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    warnings.push(`[healthkit/sync] ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function bucketStepsByDay(samples: ReadonlyArray<HealthKitStepSample>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of samples) {
    const key = isoDateKey(s.start_ts);
    out[key] = (out[key] ?? 0) + s.steps;
  }
  return out;
}

/** Stable id-keyed upsert. Last write wins on a collision. */
export function upsertById<T extends { id: string }>(
  prev: ReadonlyArray<T>,
  next: ReadonlyArray<T>,
): T[] {
  const map = new Map<string, T>();
  for (const p of prev) map.set(p.id, p);
  for (const n of next) map.set(n.id, n);
  return Array.from(map.values()).sort((a, b) => {
    const at = (a as unknown as { start_ts?: number }).start_ts ?? 0;
    const bt = (b as unknown as { start_ts?: number }).start_ts ?? 0;
    return at - bt;
  });
}

export function pickLatest<T extends { start_ts: number }>(samples: ReadonlyArray<T>): T | null {
  if (samples.length === 0) return null;
  let best = samples[0]!;
  for (const s of samples) {
    if (s.start_ts > best.start_ts) best = s;
  }
  return best;
}

function isoDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── sleep mirror ────────────────────────────────────────────────────

interface MinimalSleepRecord {
  id?: string;
  night_of: string;
  bedtime?: string | null;
  wake_time?: string | null;
  tst_min?: number | null;
  notes?: string | null;
  tokens?: string[];
  is_skipped?: boolean;
  is_partial?: boolean;
  is_disputed?: boolean;
  source?: string;
  created_at?: number;
}

/**
 * Aggregate HealthKit sleep stage samples into a single sleep.records
 * row for the night. Only inserts when there's no existing record for
 * that night_of — user's brain-dump records always win.
 */
export function mirrorSleepRecords(
  store: Store,
  samples: ReadonlyArray<HealthKitSleepSample>,
): void {
  if (samples.length === 0) return;

  // Group by night_of. Heuristic: a sleep segment belongs to the
  // "night of" its start date, BUT if the start is after 18:00 local,
  // we attribute to the same calendar day; if before 18:00, attribute
  // to the PREVIOUS day. This matches the typical user expectation
  // ("how did you sleep last night" = the segment ending this morning).
  const grouped = new Map<string, HealthKitSleepSample[]>();
  for (const s of samples) {
    const key = nightOfKeyFor(s.start_ts);
    const arr = grouped.get(key) ?? [];
    arr.push(s);
    grouped.set(key, arr);
  }

  const existing = store.get<MinimalSleepRecord[]>('sleep', 'records', []) ?? [];
  const existingNights = new Set(existing.map((r: MinimalSleepRecord) => r.night_of));

  const additions: MinimalSleepRecord[] = [];
  for (const [night, segs] of grouped) {
    if (existingNights.has(night)) continue;
    const rec = sleepSegmentsToRecord(night, segs);
    if (rec) additions.push(rec);
  }

  if (additions.length === 0) return;
  store.set('sleep', 'records', [...existing, ...additions]);
}

/**
 * Pure aggregator: stage samples → SleepRecord-shaped row.
 * Exported for testing.
 */
export function sleepSegmentsToRecord(
  nightOf: string,
  segments: ReadonlyArray<HealthKitSleepSample>,
): MinimalSleepRecord | null {
  if (segments.length === 0) return null;

  // Find bedtime + wake_time from in-bed / asleep windows.
  const sleeping = segments.filter((s) =>
    s.stage === 'asleep' ||
    s.stage === 'remSleep' ||
    s.stage === 'deepSleep' ||
    s.stage === 'lightSleep',
  );
  if (sleeping.length === 0) return null;

  let earliest = sleeping[0]!.start_ts;
  let latest = sleeping[0]!.end_ts;
  let totalMin = 0;
  for (const s of sleeping) {
    if (s.start_ts < earliest) earliest = s.start_ts;
    if (s.end_ts > latest) latest = s.end_ts;
    totalMin += s.duration_min;
  }

  return {
    id: `hk-${nightOf}`,
    night_of: nightOf,
    bedtime: hhmm(earliest),
    wake_time: hhmm(latest),
    tst_min: totalMin,
    notes: null,
    tokens: ['healthkit'],
    is_skipped: false,
    is_partial: false,
    is_disputed: false,
    source: 'healthkit',
    created_at: Date.now(),
  };
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function nightOfKeyFor(ts: number): string {
  const d = new Date(ts);
  // If before 18:00, attribute to previous day.
  if (d.getHours() < 18) {
    d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── periodic scheduler (caller-driven) ──────────────────────────────

export interface SchedulerHandle {
  stop(): void;
  /** Run the next pass immediately, ahead of the interval. */
  runNow(): Promise<SyncResult>;
}

/**
 * Plumb the sync into a setInterval. Returns a handle so the boot
 * layer can dispose on teardown. Defensive: catches exceptions and
 * skips the missed beat rather than tearing down the loop.
 */
export function scheduleHealthKitSync(
  store: Store,
  opts: SyncOptions & { intervalMs?: number } = {},
): SchedulerHandle {
  const interval = opts.intervalMs ?? HEALTHKIT_SYNC_INTERVAL_MS;
  let stopped = false;

  async function tick(): Promise<SyncResult> {
    return syncHealthKit(store, opts);
  }

  // Fire once immediately so the first session sees data fast, then
  // settle into the interval.
  const firstFire = tick().catch((err) => {
    console.error('[healthkit/sync] initial pass failed', err);
    return null;
  });

  const handle = setInterval(() => {
    if (stopped) return;
    tick().catch((err) => {
      console.error('[healthkit/sync] interval pass failed', err);
    });
  }, interval);

  return {
    stop(): void {
      stopped = true;
      clearInterval(handle);
    },
    async runNow(): Promise<SyncResult> {
      const r = await firstFire;
      if (r) return r;
      return tick();
    },
  };
}
