/**
 * @ollie/logic · sleep helpers
 *
 * Shared pure utility functions used across sleep sub-modules.
 * No I/O. No DOM. No wall-clock reads.
 *
 * The numeric kernels (_mean / _median / _stdev) delegate to the canonical
 * `../stats` module — single source of truth. The `number | null` API shape
 * is preserved so callers don't change.
 */

import { mean as meanCore, median as medianCore, sampleSd as sampleSdCore } from '../stats';
import { dayKey } from '../util';

/** Parse a time-of-day string ("22:30", "10pm", "2am") → minutes since midnight, or null. */
export function parseTimeOfDay(str: string | undefined | null): number | null {
  if (typeof str !== 'string') return null;
  const t = str.trim().toLowerCase();
  const m = t.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3] as 'am' | 'pm' | undefined;
  if (!isFinite(h) || !isFinite(mm) || mm >= 60) return null;
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap && h > 24) return null;
  if (h >= 24 || h < 0) return null;
  return h * 60 + mm;
}

/** Convert minutes-past-midnight to a relative value for bedtime math.
 *  Times >= 12:00 (noon) stay as-is; times < noon are treated as "next day" and shifted by -1440. */
export function bedtimeRelativeMinutes(mpm: number | null): number | null {
  if (mpm == null) return null;
  return mpm >= 720 ? mpm - 1440 : mpm;
}

/** Compute minutes in bed given bedtime and wake-time (both in minutes past midnight).
 *  Handles crossing midnight. Returns null if result > 24h. */
export function minutesInBed(btMin: number | null, wkMin: number | null): number | null {
  if (btMin == null || wkMin == null) return null;
  let d = wkMin - btMin;
  if (d <= 0) d += 1440;
  return d > 1440 ? null : d;
}

/** Format minutes-past-midnight as "HH:MM". */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * Format a ms timestamp as a local-time ISO date `YYYY-MM-DD`.
 * Delegates to the shared `../util` day-key helper (single source of truth).
 */
export function isoDate(ms: number): string {
  return dayKey(ms);
}

/** Median of a numeric array. Returns null on empty input. */
/** Median of a numeric array. Returns null on empty input. Even-length safe. */
export function _median(a: number[]): number | null {
  if (!Array.isArray(a) || a.length === 0) return null;
  return medianCore(a);
}

/** Mean of a numeric array. Returns null on empty input. */
export function _mean(a: number[] | null | undefined): number | null {
  if (!a || !a.length) return null;
  return meanCore(a);
}

/** Sample standard deviation. Returns 0 for fewer than 2 values. */
export function _stdev(a: number[] | null | undefined): number {
  if (!a || a.length < 2) return 0;
  return sampleSdCore(a);
}

/** Compute bedtime epoch (ms) for a given night_of date + bedtime string.
 *  Bedtimes < 12:00 are treated as next-calendar-day (after midnight). */
export function bedtimeEpochFor(nightOf: string, bedtimeStr: string): number | null {
  if (typeof nightOf !== 'string' || typeof bedtimeStr !== 'string') return null;
  const btMin = parseTimeOfDay(bedtimeStr);
  if (btMin == null) return null;
  const base = new Date(nightOf + 'T00:00:00');
  if (isNaN(base.getTime())) return null;
  const dayOffset = btMin < 720 ? 1 : 0;
  const t = new Date(base.getTime());
  t.setDate(t.getDate() + dayOffset);
  t.setHours(Math.floor(btMin / 60), btMin % 60, 0, 0);
  return t.getTime();
}
