/**
 * @ollie/logic · habits helpers
 *
 * Shared pure utility functions used across habit detectors.
 */

import type { Habit, HabitCompletion } from './types';

// Day-key helpers are owned by the shared `../util` module — single source
// of truth. Re-exported here so the habits barrel API path is unchanged.
// `dayKey` = local tz, `dayKeyUTC` = UTC; they are NOT interchangeable.
export { dayKey, dayKeyUTC } from '../util';
import { dayKey } from '../util';

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function completionsInWindow(
  habit: Habit,
  fromTs: number,
  toTs: number,
): number {
  const c = habit.completions ?? [];
  let n = 0;
  for (const e of c) {
    if (e && typeof e.ts === 'number' && e.ts >= fromTs && e.ts <= toTs) n++;
  }
  return n;
}

/** Build a dayKey→count map from embedded habit.completions arrays. */
export function dayCompletionMapFromHabits(
  habits: Habit[],
  fromTs: number,
  toTs: number,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of habits) {
    const c = h.completions ?? [];
    for (const e of c) {
      if (!e || typeof e.ts !== 'number' || e.ts < fromTs || e.ts > toTs) continue;
      const k = dayKey(e.ts);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

/** Build a dayKey→count map from a flat completions array (preferred shape). */
export function dayCompletionMapFromFlat(
  completions: HabitCompletion[],
  fromTs: number,
  toTs: number,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of completions) {
    if (!c || typeof c.ts !== 'number' || c.ts < fromTs || c.ts > toTs) continue;
    const k = dayKey(c.ts);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * #142: count how many habits were ACTIVE on a given local day, i.e. already
 * created on/before that day. A habit with no `created_at` is treated as
 * always-active (we have no creation evidence, so we don't exclude it).
 *
 * `dayKey` is a local-tz key; we compare against the day's local noon
 * timestamp (DST-stable, matches the rest of the habits module).
 */
export function activeHabitCount(habits: Habit[], dayKeyStr: string): number {
  const dayNoon = Date.parse(dayKeyStr + 'T12:00:00');
  let n = 0;
  for (const h of habits) {
    const created = typeof h.created_at === 'number' ? h.created_at : null;
    if (created == null || created <= dayNoon) n++;
  }
  return n;
}

/** Returns the appropriate dayCompletion map given history shape. */
export function buildDayCompletionMap(
  habits: Habit[],
  flatCompletions: HabitCompletion[] | null,
  fromTs: number,
  toTs: number,
): Map<string, number> {
  if (flatCompletions) {
    return dayCompletionMapFromFlat(flatCompletions, fromTs, toTs);
  }
  return dayCompletionMapFromHabits(habits, fromTs, toTs);
}
