/**
 * Sleep module · domain types.
 *
 * The router lands four shapes of sleep events:
 *   - 'sleep'      — a logged night with optional bedtime/wake/quality
 *   - 'wind_down'  — a pre-sleep note the user wants remembered
 *   - 'dream'      — a free-text dream log
 *   - 'insomnia'   — semantically distinct from quality=1; couldn't sleep
 *
 * One event = one row in `sleep_events`. Kind-specific fields ride in a
 * JSON blob (`data`) so the table stays narrow + we don't end up with
 * a forest of nullable columns nobody queries.
 */
export type SleepKind = 'sleep' | 'wind_down' | 'dream' | 'insomnia';

/**
 * "How it felt" tag for a logged night — the named, human read of a night
 * that sits alongside (not instead of) the numeric 1–5 quality. The brief's
 * four words; nullable because the user may never tap one.
 */
export type SleepFeel = 'rested' | 'wired' | 'foggy' | 'wrecked';

/** Every feel tag, in the order the UI offers them (best → worst-ish). */
export const SLEEP_FEELS: readonly SleepFeel[] = ['rested', 'wired', 'foggy', 'wrecked'];

/**
 * Map a feel tag → an approximate 1–5 quality so the numeric-quality
 * detectors keep working when the user only tapped a word (and never set a
 * number). Intentionally coarse: 'rested' reads great, 'wrecked' reads poor,
 * the two middle tags land mid-low. Used only as a fallback — an explicit
 * numeric quality always wins.
 */
export function feelToQuality(feel: SleepFeel | null | undefined): 1 | 2 | 3 | 4 | 5 | null {
  switch (feel) {
    case 'rested':
      return 5;
    case 'wired':
      return 3;
    case 'foggy':
      return 2;
    case 'wrecked':
      return 1;
    default:
      return null;
  }
}

/** Narrow an arbitrary value to a SleepFeel (or null). Defensive read path. */
export function asSleepFeel(v: unknown): SleepFeel | null {
  return typeof v === 'string' && (SLEEP_FEELS as readonly string[]).includes(v)
    ? (v as SleepFeel)
    : null;
}

/** Parsed payload for kind='sleep' rows. */
export interface SleepLogData {
  /** HH:MM (24h) as supplied by the user — preserved for display. */
  bedtime: string | null;
  /** HH:MM (24h) as supplied by the user — preserved for display. */
  wake: string | null;
  /** 1 (worst) - 5 (best); null when not reported. */
  quality: 1 | 2 | 3 | 4 | 5 | null;
  /** Computed only when both bedtime + wake provided; otherwise null. */
  hoursSlept: number | null;
  /** "How it felt" tag (rested · wired · foggy · wrecked); null when unset. */
  feel: SleepFeel | null;
}

/** Parsed payload for kind='wind_down' rows. */
export interface WindDownData {
  note: string;
}

/** Parsed payload for kind='dream' rows. */
export interface DreamData {
  text: string;
}

/** Parsed payload for kind='insomnia' rows. */
export interface InsomniaData {
  durationAttemptedMin: number | null;
  wokeCount: number | null;
}

/** Discriminated union of fully-parsed sleep events. */
export type SleepEvent =
  | { id: string; kind: 'sleep'; occurredAt: number; data: SleepLogData }
  | { id: string; kind: 'wind_down'; occurredAt: number; data: WindDownData }
  | { id: string; kind: 'dream'; occurredAt: number; data: DreamData }
  | { id: string; kind: 'insomnia'; occurredAt: number; data: InsomniaData };

/**
 * Parse "HH:MM" (24h) into minutes-since-midnight. Returns null on any
 * malformed input — caller treats null as "unknown, skip computation".
 */
export function parseHHMM(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mins)) return null;
  if (h < 0 || h > 23 || mins < 0 || mins > 59) return null;
  return h * 60 + mins;
}

/**
 * Compute hours slept from bedtime + wake HH:MM. Wraps past midnight
 * automatically (bedtime 23:30 → wake 07:00 = 7.5h). Returns null when
 * either side fails to parse. Rounded to 1 decimal.
 */
export function hoursBetween(
  bedtime: string | null | undefined,
  wake: string | null | undefined,
): number | null {
  const bed = parseHHMM(bedtime);
  const up = parseHHMM(wake);
  if (bed == null || up == null) return null;
  let diff = up - bed;
  if (diff <= 0) diff += 24 * 60; // wrap past midnight
  return Math.round((diff / 60) * 10) / 10;
}
