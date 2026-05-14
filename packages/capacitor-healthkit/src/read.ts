/**
 * @ollie/capacitor-healthkit · readers
 *
 * Bounded-window readers for the five metrics ollie consumes. Each
 * reader:
 *   1. checks availability + plugin load
 *   2. calls the right plugin method (querySamples preferred, with a
 *      queryAggregated fallback for `stepCount` since that's the only
 *      metric where the bucketed sum is sufficient and saves payload)
 *   3. normalizes via @ollie/capacitor-healthkit/normalize
 *   4. returns the typed sample array or `null` for "unavailable"
 *
 * Important — these functions DO NOT touch the @ollie/store. Persistence
 * is the orchestrator's job (sync.ts). Keeping readers pure makes the
 * test harness easy: feed in a fake plugin, assert the normalized output.
 *
 * Pre-Apple-approval: readers will return `null` on every native call
 * because `isHealthKitAvailable()` is false (no Xcode signing) or the
 * plugin native bridge isn't installed. Once the plugin lands and the
 * NSHealthShareUsageDescription is registered, these light up.
 */

import {
  asHealthPlugin,
  isHealthKitAvailable,
  loadHealthPlugin,
  type HealthPluginShape,
} from './runtime';
import { normalizeSamples } from './normalize';
import type {
  HealthKitHeartRateSample,
  HealthKitHydrationSample,
  HealthKitRestingHRSample,
  HealthKitSleepSample,
  HealthKitStepSample,
  RawHealthSample,
} from './types';

// ─── window helpers ───────────────────────────────────────────────────

function isoOrNow(ts?: number): string {
  return new Date(ts ?? Date.now()).toISOString();
}

function nDaysAgo(n: number, now?: number): number {
  return (now ?? Date.now()) - n * 24 * 60 * 60 * 1000;
}

/** YYYY-MM-DD for the user's local day boundary. */
function todayLocalKey(now?: number): string {
  const d = new Date(now ?? Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local midnight for "today" as unix ms. */
function startOfTodayLocal(now?: number): number {
  const d = new Date(now ?? Date.now());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ─── reader signatures ────────────────────────────────────────────────

export interface ReaderContext {
  /** Injected for tests. Defaults to Date.now(). */
  now?: number;
  /**
   * Injected plugin handle for tests. When set, runtime detection is
   * skipped — pass a HealthPluginShape mock to exercise the path
   * without a Capacitor runtime.
   */
  pluginOverride?: HealthPluginShape;
}

async function resolvePlugin(ctx: ReaderContext): Promise<HealthPluginShape | null> {
  if (ctx.pluginOverride) return ctx.pluginOverride;
  if (!isHealthKitAvailable()) return null;
  const handle = await loadHealthPlugin();
  if (!handle) return null;
  return asHealthPlugin(handle);
}

async function fetchSamples(
  plugin: HealthPluginShape,
  dataType: string,
  startIso: string,
  endIso: string,
  limit?: number,
): Promise<RawHealthSample[]> {
  if (plugin.querySamples) {
    const r = await plugin.querySamples({
      dataType,
      startDate: startIso,
      endDate: endIso,
      limit,
    });
    return r.samples ?? [];
  }
  // Fallback: aggregated query — only safe for additive metrics like
  // stepCount where a per-day sum is meaningful.
  const r = await plugin.queryAggregated({
    dataType,
    startDate: startIso,
    endDate: endIso,
    bucket: 'day',
    aggregation: 'sum',
  });
  return (r.samples ?? []).map((b) => ({
    startDate: b.startDate,
    endDate: b.endDate,
    value: b.value,
    unit: 'count',
  }));
}

// ─── public readers ──────────────────────────────────────────────────

/**
 * Steps for the last `days` complete days + today so far. Returns one
 * sample per HealthKit segment; the orchestrator sums to per-day totals.
 */
export async function readSteps(
  days = 2,
  ctx: ReaderContext = {},
): Promise<HealthKitStepSample[] | null> {
  const plugin = await resolvePlugin(ctx);
  if (!plugin) return null;
  const now = ctx.now ?? Date.now();
  const start = startOfTodayLocal(now) - (Math.max(1, days) - 1) * 24 * 60 * 60 * 1000;
  const rows = await fetchSamples(plugin, 'steps', new Date(start).toISOString(), isoOrNow(now));
  return normalizeSamples('stepCount', rows, now) as HealthKitStepSample[];
}

/**
 * Heart-rate samples for the trailing 24 hours by default.
 * High-fidelity samples — Apple Watch logs every few minutes during
 * the day. Use `count` to bound payload size.
 */
export async function readHeartRate(
  trailingHours = 24,
  ctx: ReaderContext = {},
): Promise<HealthKitHeartRateSample[] | null> {
  const plugin = await resolvePlugin(ctx);
  if (!plugin) return null;
  const now = ctx.now ?? Date.now();
  const start = now - Math.max(1, trailingHours) * 60 * 60 * 1000;
  const rows = await fetchSamples(plugin, 'heartRate', new Date(start).toISOString(), isoOrNow(now), 5_000);
  return normalizeSamples('heartRate', rows, now) as HealthKitHeartRateSample[];
}

/**
 * Sleep stage samples that overlap "last night" — defined as
 * (now-30h, now). 30h not 24h so we capture full sleep segments
 * regardless of timezone-flux or the user pulling at noon.
 */
export async function readSleepLastNight(
  ctx: ReaderContext = {},
): Promise<HealthKitSleepSample[] | null> {
  const plugin = await resolvePlugin(ctx);
  if (!plugin) return null;
  const now = ctx.now ?? Date.now();
  const start = nDaysAgo(1.25, now); // 30h
  const rows = await fetchSamples(plugin, 'sleep', new Date(start).toISOString(), isoOrNow(now));
  return normalizeSamples('sleepAnalysis', rows, now) as HealthKitSleepSample[];
}

/**
 * Most recent resting HR reading. iOS computes once per day; we pull a
 * 14-day window so we always get the latest non-empty value.
 */
export async function readRestingHeartRate(
  ctx: ReaderContext = {},
): Promise<HealthKitRestingHRSample[] | null> {
  const plugin = await resolvePlugin(ctx);
  if (!plugin) return null;
  const now = ctx.now ?? Date.now();
  const start = nDaysAgo(14, now);
  const rows = await fetchSamples(plugin, 'restingHeartRate', new Date(start).toISOString(), isoOrNow(now));
  return normalizeSamples('restingHeartRate', rows, now) as HealthKitRestingHRSample[];
}

/**
 * Hydration logged today. NOTE: many users won't have any HealthKit
 * hydration entries since most water-logging apps don't sync up. This
 * is best-effort; ollie's in-app water_log remains the primary source.
 */
export async function readHydrationToday(
  ctx: ReaderContext = {},
): Promise<HealthKitHydrationSample[] | null> {
  const plugin = await resolvePlugin(ctx);
  if (!plugin) return null;
  const now = ctx.now ?? Date.now();
  const start = startOfTodayLocal(now);
  const rows = await fetchSamples(plugin, 'hydration', new Date(start).toISOString(), isoOrNow(now));
  return normalizeSamples('hydration', rows, now) as HealthKitHydrationSample[];
}

// Exported for test convenience.
export { todayLocalKey, startOfTodayLocal };
