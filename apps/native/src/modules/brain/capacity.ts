/**
 * apps/native · modules/brain/capacity.ts  —  capacity-read wiring
 *
 * Deliverable 4 of the silent-observer brain. Reads the signals the user
 * ALREADY produces from the @ollie/store (most recent sleep, recent mood,
 * today's capture volume), runs the PURE scorer (@ollie/logic/brain ·
 * computeCapacity), and writes the result to `shared.capacity` =
 * { level, computedAt }.
 *
 * NO new screen, NO nagging — this is a quiet read the brain uses to soften /
 * defer optional offers on a low-capacity day. A 'low' read means "go easy",
 * never "you're failing".
 *
 * Inputs are read from store keys the existing bridges already populate
 * (sleep.records via sleep/bridge, mood.logs via mood/bridge, dump.items via
 * dump/bridge), so recomputing AFTER `runAllSyncs` sees fresh data. Best-
 * effort: never throws into the boot / dump path.
 */

import { computeCapacity } from '@ollie/logic/brain';
import type { CapacityInputs } from '@ollie/logic/brain';
import type { Store } from '@ollie/store';

/** sleep.records entry — subset of the bridge's MirroredSleepRecord we use. */
interface SleepRecordLite {
  night_of?: string;
  tst_min?: number | null;
  quality?: number | null;
  created_at?: number;
}

/** mood.logs entry — subset of the mood bridge's MoodLogEntry we use. */
interface MoodLogLite {
  kind?: string;
  ts?: number;
  valence?: number;
  level?: number;
  [field: string]: unknown;
}

/** dump.items entry — has a ts; we only count today's. */
interface DumpItemLite {
  ts?: number;
  mood?: string | null;
}

/**
 * Last night's sleep → hours + quality. Records are oldest-first. Only counted
 * when logged TODAY (created since local midnight) — last night's sleep is
 * logged in the morning, so a stale record from a prior day must NOT keep
 * dragging capacity down on a fresh day. No fresh record → unknown (0 weight).
 */
function readSleep(store: Store, now: number): { hours: number | null; quality: number | null } {
  const records = store.get<SleepRecordLite[]>('sleep', 'records', []) ?? [];
  if (!Array.isArray(records) || records.length === 0) return { hours: null, quality: null };
  const last = records[records.length - 1];
  // Stale (logged before today) → treat as unknown so yesterday doesn't bleed in.
  if (typeof last?.created_at === 'number' && last.created_at < startOfDayMs(now)) {
    return { hours: null, quality: null };
  }
  const hours = typeof last?.tst_min === 'number' ? last.tst_min / 60 : null;
  const quality = typeof last?.quality === 'number' ? last.quality : null;
  return { hours, quality };
}

/**
 * TODAY'S mood read. Capacity is a read of how she is RIGHT NOW, so we only
 * count mood logged since the start of today — yesterday's "I'm so drained"
 * must NOT bleed into a fresh day (it's a new day; that was yesterday). Falls
 * back to today's dump mood tag. Returns a coarse low/neutral/high.
 */
function readMood(store: Store, now: number): 'low' | 'neutral' | 'high' | null {
  const logs = store.get<MoodLogLite[]>('mood', 'logs', []) ?? [];
  const recentCutoff = startOfDayMs(now);
  // mood.logs is newest-first; find the newest mood/energy entry in window.
  for (const log of Array.isArray(logs) ? logs : []) {
    if (typeof log?.ts !== 'number' || log.ts < recentCutoff) continue;
    if (typeof log.valence === 'number') {
      return log.valence < 0 ? 'low' : log.valence > 0 ? 'high' : 'neutral';
    }
    if (typeof log.level === 'number') {
      // energy level 1–5 → low (<=2) / high (>=4) / neutral
      return log.level <= 2 ? 'low' : log.level >= 4 ? 'high' : 'neutral';
    }
  }

  // Fallback: today's dump mood tag (dump.items carries 'low'|'neutral'|'high').
  const items = store.get<DumpItemLite[]>('dump', 'items', []) ?? [];
  const dayStart = startOfDayMs(now);
  for (const it of Array.isArray(items) ? items : []) {
    if (typeof it?.ts !== 'number' || it.ts < dayStart) continue;
    if (it.mood === 'low' || it.mood === 'neutral' || it.mood === 'high') return it.mood;
  }
  return null;
}

/** Count today's captures (dumps) — the load signal. */
function readTodayLoad(store: Store, now: number): number {
  const items = store.get<DumpItemLite[]>('dump', 'items', []) ?? [];
  if (!Array.isArray(items)) return 0;
  const dayStart = startOfDayMs(now);
  return items.filter((it) => typeof it?.ts === 'number' && it.ts >= dayStart).length;
}

/** Local-midnight ms for the day containing `now`. */
function startOfDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Recompute the daily capacity read from the current store signals and write
 * it to `shared.capacity`. Never throws — safe to fire on boot + after dumps.
 * Returns the level written, or null if it couldn't run.
 */
export function recomputeCapacity(store: Store, now: number = Date.now()): 'low' | 'medium' | 'high' | null {
  try {
    const { hours, quality } = readSleep(store, now);
    const inputs: CapacityInputs = {
      lastSleepHours: hours,
      sleepQuality: quality,
      recentMood: readMood(store, now),
      todayLoad: readTodayLoad(store, now),
    };
    const read = computeCapacity(inputs, now);
    store.set('shared', 'capacity', read);
    return read.level;
  } catch (err) {
    console.error('[brain] recomputeCapacity failed (non-fatal):', err);
    return null;
  }
}
