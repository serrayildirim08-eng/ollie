/**
 * @ollie/logic · body · sleep-debt → habits correlator
 *
 * Pearson r between (rolling 7d sleep_debt_hours, daily habit_completion_pct).
 * Sample size ≥ 14 days. Threshold |r| > 0.30.
 *
 * Reuses pearson() from ../math. No I/O. No DOM.
 */

import { pearson } from '../math';
import type { Habit, HabitCompletion, SleepRecord } from '../../habits/types';

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 21;
const DEFAULT_TARGET_HOURS = 7.5;

export interface SleepDebtHabitsResult {
  correlation: number;
  sampleSize: number;
  copy: string;
  ts: number;
}

export interface CorrelateSleepDebtHabitsOpts {
  lookbackDays?: number;
  minSampleSize?: number;
  thresholdRho?: number;
  targetHours?: number;
  now?: number;
}

function localDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
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

function sleepHoursForRecord(r: SleepRecord): number | null {
  if (!r) return null;
  if (r.is_skipped === true) return null;
  if (typeof r.hours === 'number' && isFinite(r.hours)) return r.hours;
  if (typeof r.tst_min === 'number' && isFinite(r.tst_min)) return r.tst_min / 60;
  return null;
}

function sleepHoursByDay(records: readonly SleepRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) {
    const hrs = sleepHoursForRecord(r);
    if (hrs == null) continue;
    let key = r.night_of;
    if (!key && typeof r.ts === 'number') key = localDateKey(r.ts);
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    out.set(key, hrs);
  }
  return out;
}

function rollingDebtHours(
  sleepByDay: Map<string, number>,
  dayKey: string,
  target: number,
): number {
  const noon = noonEpochFromDateKey(dayKey);
  if (noon == null) return 0;
  let debt = 0;
  for (let i = 0; i < 7; i++) {
    const probeKey = localDateKey(noon - i * DAY_MS);
    const hrs = sleepByDay.get(probeKey);
    if (hrs == null) continue;
    const gap = target - hrs;
    if (gap > 0) debt += gap;
  }
  return debt;
}

function completionsByDay(habits: readonly Habit[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of habits) {
    if (!Array.isArray(h?.completions)) continue;
    for (const c of h.completions) {
      const ts = (c as HabitCompletion)?.ts;
      if (typeof ts !== 'number' || !isFinite(ts)) continue;
      const k = localDateKey(ts);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

function activeHabitsOn(habits: readonly Habit[], dayNoonEpoch: number): number {
  let count = 0;
  for (const h of habits) {
    if (!h) continue;
    const created = h.created_at;
    if (typeof created !== 'number') { count++; continue; }
    if (created <= dayNoonEpoch) count++;
  }
  return count;
}

export function correlateSleepDebtAndHabits(
  sleepRecords: readonly SleepRecord[] | undefined | null,
  habits: readonly Habit[] | undefined | null,
  opts?: CorrelateSleepDebtHabitsOpts,
): SleepDebtHabitsResult {
  const now = opts?.now ?? Date.now();
  const lookback = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const minN = opts?.minSampleSize ?? 14;
  const thresholdRho = opts?.thresholdRho ?? 0.30;
  const target = opts?.targetHours ?? DEFAULT_TARGET_HOURS;

  if (!Array.isArray(sleepRecords) || sleepRecords.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }
  if (!Array.isArray(habits) || habits.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const sleepBy = sleepHoursByDay(sleepRecords);
  const compBy = completionsByDay(habits);
  const fromTs = now - lookback * DAY_MS;

  const xs: number[] = [];
  const ys: number[] = [];

  for (let t = fromTs; t <= now; t += DAY_MS) {
    const noon = new Date(t);
    noon.setHours(12, 0, 0, 0);
    const noonMs = noon.getTime();
    const dayKey = localDateKey(noonMs);

    const active = activeHabitsOn(habits, noonMs);
    if (active < 3) continue;

    const completed = compBy.get(dayKey) ?? 0;
    const pct = Math.min(1, completed / active);

    const debt = rollingDebtHours(sleepBy, dayKey, target);

    xs.push(debt);
    ys.push(pct);
  }

  const n = xs.length;
  if (n < minN) {
    return { correlation: 0, sampleSize: n, copy: '', ts: now };
  }

  const r = pearson(xs, ys);
  if (Math.abs(r) < thresholdRho) {
    return { correlation: r, sampleSize: n, copy: '', ts: now };
  }

  let copy = '';
  if (r < 0) {
    const weeks = Math.max(1, Math.round(n / 7));
    copy = `habit completion drops as sleep debt climbs · ${weeks} week${weeks === 1 ? '' : 's'} of data`;
  } else {
    copy = `habit completion holds steady as sleep debt climbs for you · ${n} days of data`;
  }

  return { correlation: r, sampleSize: n, copy, ts: now };
}
