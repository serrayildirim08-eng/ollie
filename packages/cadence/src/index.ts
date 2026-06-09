/**
 * @ollie/cadence — generic adaptive cadence detection.
 *
 * Pure, no I/O. Given a stream of timestamped events for one "thing" (a
 * pantry canonical, a movement activity, a habit name, a recurring
 * spend, a pet feeding, a med dose), `computeCadence` returns a robust
 * median interval, a confidence tier, and the next expected timestamp.
 *
 * Design notes
 * ────────────
 * - Confidence tiers mirror the grocery replenishment worker so the
 *   surface vocabulary stays consistent across cloud + local cadence:
 *     'low-data'  → sample_size < 2 (or wildly irregular)
 *     'observed'  → 2 ≤ sample_size < 5 with moderate regularity
 *     'stable'    → sample_size ≥ 5 AND cv ≤ STABLE_CV_THRESHOLD
 *   ("static" is grocery-cloud-only; locally we don't have a shelf-life
 *   table so we don't fabricate one.)
 *
 * - The median interval is computed over consecutive-event gaps (Δt
 *   between sorted ts values). Median is used over mean because ADHD
 *   patterns are bursty — a single 30-day gap shouldn't shift the
 *   estimate. Coefficient of variation of the gaps drives the tier:
 *   regular gaps → 'stable'; jittery gaps → demote.
 *
 * - `nextExpectedTs` = lastTs + medianIntervalMs. Callers decide what
 *   "overdue" means (we expose the threshold helper but don't enforce).
 *
 * No DB. No clock reads inside `computeCadence` (callers pass events
 * with explicit ts). Matches the @ollie/logic functional-core idiom.
 */

// ─── types ───────────────────────────────────────────────────────────────

export type CadenceConfidence = 'low-data' | 'observed' | 'stable';

export interface TimestampedEvent {
  /** ms-since-epoch — the only field we read. */
  ts: number;
  /** Free-form label (e.g. canonical, activity, habit name). Carried
   *  through so callers can pipe-and-filter, but unused in compute. */
  label: string;
}

export interface CadenceEstimate {
  /** Median Δt between consecutive events (ms). 0 when sampleSize < 2. */
  medianIntervalMs: number;
  /** Number of events seen. */
  sampleSize: number;
  /** Tiered confidence — see module doc. */
  confidence: CadenceConfidence;
  /**
   * lastTs + medianIntervalMs, or null when sampleSize < 2.
   * Callers compare this to now() to surface "due soon" / "overdue".
   */
  nextExpectedTs: number | null;
  /** Timestamp of the most recent event, or null when sampleSize === 0. */
  lastTs: number | null;
}

// ─── compute ─────────────────────────────────────────────────────────────

/**
 * Coefficient-of-variation threshold above which 'stable' is demoted to
 * 'observed'. 0.6 is a calibration choice: weekly-ish patterns with ±2d
 * drift still read as stable; patterns that swing 7d→1d→14d don't.
 */
const STABLE_CV_THRESHOLD = 0.6;

/** Minimum sample size to claim 'stable' even with low CV. */
const STABLE_MIN_SAMPLES = 5;

/** Minimum sample size to claim 'observed'. */
const OBSERVED_MIN_SAMPLES = 2;

/**
 * Robust cadence estimate over a stream of timestamped events.
 *
 * Pure function — no clock reads, no I/O. Order of input doesn't matter
 * (we sort defensively). Non-finite / negative timestamps are dropped
 * silently so callers don't have to pre-validate.
 */
export function computeCadence(events: TimestampedEvent[]): CadenceEstimate {
  const tss = sanitiseTimestamps(events);

  if (tss.length === 0) {
    return {
      medianIntervalMs: 0,
      sampleSize: 0,
      confidence: 'low-data',
      nextExpectedTs: null,
      lastTs: null,
    };
  }

  const lastTs = tss[tss.length - 1]!;

  if (tss.length < OBSERVED_MIN_SAMPLES) {
    return {
      medianIntervalMs: 0,
      sampleSize: tss.length,
      confidence: 'low-data',
      nextExpectedTs: null,
      lastTs,
    };
  }

  const gaps: number[] = [];
  for (let i = 1; i < tss.length; i++) {
    const gap = tss[i]! - tss[i - 1]!;
    // Same-instant duplicates (gap === 0) carry no cadence signal —
    // skip them so a double-tap doesn't pull the median toward zero.
    if (gap > 0) gaps.push(gap);
  }

  if (gaps.length === 0) {
    // Every event landed at the same instant — treat as a single sample.
    return {
      medianIntervalMs: 0,
      sampleSize: tss.length,
      confidence: 'low-data',
      nextExpectedTs: null,
      lastTs,
    };
  }

  const medianIntervalMs = median(gaps);
  const cv = coefficientOfVariation(gaps);

  let confidence: CadenceConfidence;
  if (
    tss.length >= STABLE_MIN_SAMPLES &&
    cv <= STABLE_CV_THRESHOLD
  ) {
    confidence = 'stable';
  } else if (cv > STABLE_CV_THRESHOLD * 2) {
    // Wildly irregular — demote to 'low-data' even with enough samples.
    // Threshold doubles because at moderate cv we still want 'observed'.
    confidence = 'low-data';
  } else {
    confidence = 'observed';
  }

  return {
    medianIntervalMs,
    sampleSize: tss.length,
    confidence,
    nextExpectedTs: lastTs + medianIntervalMs,
    lastTs,
  };
}

// ─── overdue helper ──────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Is this event due soon / overdue?" — convenience used by Boxes to
 * decide whether to render a prediction line.
 *
 * `thresholdMs` is the slack we allow before calling it overdue —
 * defaults to one day so weekly cadence doesn't ping the instant the
 * median interval rolls over.
 *
 * Returns `null` when there's no estimate to compare against
 * (low-data with no nextExpectedTs) so callers can render nothing.
 */
export function isOverdue(
  estimate: CadenceEstimate,
  now: number,
  thresholdMs: number = DAY_MS,
): boolean | null {
  if (estimate.nextExpectedTs == null) return null;
  return now > estimate.nextExpectedTs + thresholdMs;
}

/** Days since `lastTs`, or null when no events. Rounded to one decimal. */
export function daysSinceLast(
  estimate: CadenceEstimate,
  now: number,
): number | null {
  if (estimate.lastTs == null) return null;
  const dt = Math.max(0, now - estimate.lastTs);
  return Math.round((dt / DAY_MS) * 10) / 10;
}

/** Median interval expressed in days, rounded to one decimal. */
export function medianIntervalDays(estimate: CadenceEstimate): number {
  return Math.round((estimate.medianIntervalMs / DAY_MS) * 10) / 10;
}

// ─── private helpers ─────────────────────────────────────────────────────

function sanitiseTimestamps(events: TimestampedEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (!e) continue;
    const t = e.ts;
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
      out.push(t);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

function median(values: number[]): number {
  // values are gap deltas, always positive by construction.
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  let sqSum = 0;
  for (const v of values) {
    const d = v - m;
    sqSum += d * d;
  }
  const variance = sqSum / values.length;
  const stdDev = Math.sqrt(variance);
  return stdDev / m;
}

// ─── recurring detection re-exports ──────────────────────────────────────
//
// Lives in a sibling module so the core compute stays small. Re-exported
// from the package root so callers import from '@ollie/cadence' regardless.

export {
  detectRecurring,
  classifyCycle,
  type RecurringCycle,
  type RecurringEvent,
  type RecurringPattern,
} from './recurring';
