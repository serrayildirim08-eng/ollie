/**
 * @ollie/logic · habits helpers
 *
 * Shared pure utility functions used across habit detectors.
 */

import type { Habit, HabitCompletion } from './types';

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function dayKeyUTC(ts: number): string {
  const d = new Date(ts);
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

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
