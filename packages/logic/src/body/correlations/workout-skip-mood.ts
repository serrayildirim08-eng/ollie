/**
 * @ollie/logic · body · workout-skip → mood correlator
 *
 * Spearman ρ between (workout_skipped_yesterday: 0|1, mood_today_proxy).
 * Mood proxy: OVERWHELMED_LEXICON match ratio / sentence count.
 * Sample size ≥ 10. Threshold |ρ| > 0.25.
 *
 * No I/O. No DOM.
 */

import { spearman } from '../math';
import { median as medianOf } from '../../stats';
import { OVERWHELMED_LEXICON } from '../../sleep/constants';
import type { Habit, HabitCompletion, DumpEntry } from '../../habits/types';

import { DAY_MS, dayKey, resolveNow } from '../../util';
const DEFAULT_LOOKBACK_DAYS = 30;

const WORKOUT_NAME_RE =
  /\b(workout|gym|run|jog|lift(ing)?|crossfit|yoga|pilates|cardio|spin|swim|hike|cycle\s+class|bike\s+ride|exercise)\b/i;

export interface WorkoutSkipMoodResult {
  correlation: number;
  sampleSize: number;
  copy: string;
  ts: number;
}

export interface CorrelateWorkoutSkipMoodOpts {
  lookbackDays?: number;
  minSampleSize?: number;
  thresholdRho?: number;
  now?: number;
}

/** YYYY-MM-DD key in LOCAL tz — delegates to the shared util. */
const localDateKey = dayKey;

function buildLexiconMatcher(): (text: string) => number {
  const phrases = OVERWHELMED_LEXICON.map((p) => p.toLowerCase());
  return (text: string): number => {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const p of phrases) {
      if (lower.includes(p)) hits++;
    }
    return hits;
  };
}

function sentenceCount(text: string): number {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
  return Math.max(1, parts.length);
}

function pickWorkoutHabits(habits: readonly Habit[]): Habit[] {
  return habits.filter((h) => {
    if (!h) return false;
    const cat = (h.category ?? '').toLowerCase();
    const name = ((h.name ?? h.label) ?? '').toLowerCase();
    if (cat === 'health' && WORKOUT_NAME_RE.test(name)) return true;
    if (WORKOUT_NAME_RE.test(name)) return true;
    return false;
  });
}

function workoutCompletionDays(habits: readonly Habit[]): Set<string> {
  const out = new Set<string>();
  for (const h of habits) {
    if (!Array.isArray(h.completions)) continue;
    for (const c of h.completions) {
      const ts = (c as HabitCompletion)?.ts;
      if (typeof ts !== 'number' || !isFinite(ts)) continue;
      out.add(localDateKey(ts));
    }
  }
  return out;
}

function dumpsByDay(dumps: readonly DumpEntry[]): Map<string, DumpEntry[]> {
  const out = new Map<string, DumpEntry[]>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    const k = localDateKey(d.ts);
    const arr = out.get(k);
    if (arr) arr.push(d);
    else out.set(k, [d]);
  }
  return out;
}

function dayBeforeKey(key: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const prev = new Date(y, mo, d - 1, 12, 0, 0, 0);
  return localDateKey(prev.getTime());
}

function noonEpochFromDateKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const t = new Date(y, mo, d, 12, 0, 0, 0).getTime();
  return isFinite(t) ? t : null;
}

function inferWorkoutCadenceDays(
  completionDays: Set<string>,
): number | null {
  const keys = Array.from(completionDays).sort();
  if (keys.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < keys.length; i++) {
    const prev = noonEpochFromDateKey(keys[i - 1]);
    const cur = noonEpochFromDateKey(keys[i]);
    if (prev == null || cur == null) continue;
    gaps.push(Math.round((cur - prev) / DAY_MS));
  }
  if (gaps.length === 0) return null;
  // FIX (#2): even-length median bug. Previously sorted[floor(n/2)] — the
  // upper-middle element — instead of averaging the two middle elements.
  const median = medianOf(gaps);
  if (median <= 0 || median > 7) return null;
  return median;
}

export function correlateWorkoutSkipAndMood(
  habits: readonly Habit[] | undefined | null,
  dumps: readonly DumpEntry[] | undefined | null,
  opts?: CorrelateWorkoutSkipMoodOpts,
): WorkoutSkipMoodResult {
  const now = resolveNow(opts?.now);
  const lookback = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const minN = opts?.minSampleSize ?? 10;
  const thresholdRho = opts?.thresholdRho ?? 0.25;

  if (!Array.isArray(habits) || habits.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }
  if (!Array.isArray(dumps) || dumps.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const workoutHabits = pickWorkoutHabits(habits);
  if (workoutHabits.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const completedDays = workoutCompletionDays(workoutHabits);
  const cadence = inferWorkoutCadenceDays(completedDays);
  if (cadence == null) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const matchPhrases = buildLexiconMatcher();
  const dumpsBy = dumpsByDay(dumps);
  const fromTs = now - lookback * DAY_MS;

  const xs: number[] = [];
  const ys: number[] = [];

  for (let t = fromTs; t <= now; t += DAY_MS) {
    const noon = new Date(t);
    noon.setHours(12, 0, 0, 0);
    const dKey = localDateKey(noon.getTime());
    const dayDumps = dumpsBy.get(dKey);
    if (!dayDumps || dayDumps.length === 0) continue;

    const prevKey = dayBeforeKey(dKey);
    if (prevKey == null) continue;

    const prevNoon = noonEpochFromDateKey(prevKey);
    if (prevNoon == null) continue;
    let inWindow = false;
    for (let off = -cadence; off <= cadence; off++) {
      const probe = prevNoon + off * DAY_MS;
      if (completedDays.has(localDateKey(probe))) { inWindow = true; break; }
    }
    if (!inWindow) continue;

    const skipFlag = completedDays.has(prevKey) ? 0 : 1;

    const joined = dayDumps.map((d) => (d.rawText ?? d.text ?? '')).join('\n');
    const sentences = sentenceCount(joined);
    if (sentences === 0) continue;
    const moodProxy = matchPhrases(joined) / sentences;

    xs.push(skipFlag);
    ys.push(moodProxy);
  }

  const n = xs.length;
  if (n < minN) {
    return { correlation: 0, sampleSize: n, copy: '', ts: now };
  }

  const sumX = xs.reduce((s, x) => s + x, 0);
  if (sumX === 0 || sumX === n) {
    return { correlation: 0, sampleSize: n, copy: '', ts: now };
  }

  const rho = spearman(xs, ys);
  if (Math.abs(rho) < thresholdRho) {
    return { correlation: rho, sampleSize: n, copy: '', ts: now };
  }

  let copy: string;
  if (rho > 0) {
    copy = `days after skipped workouts read heavier in dumps · ${n} days of data`;
  } else {
    copy = `days after skipped workouts read lighter for you · ${n} days of data`;
  }

  return { correlation: rho, sampleSize: n, copy, ts: now };
}
