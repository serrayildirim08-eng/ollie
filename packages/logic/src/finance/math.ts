/**
 * @ollie/logic · finance math helpers
 *
 * Pure stat functions. No side-effects, no wall-clock reads, no I/O.
 */

// DAY_MS / HOUR_MS / day-key helpers come from the shared util module —
// single source of truth. Re-exported so finance callers keep their import path.
import { DAY_MS, HOUR_MS, dayKey, daysBetweenKeys } from '../util';
export { DAY_MS, HOUR_MS };

/** Format an epoch-ms timestamp as a local `YYYY-MM-DD` key. */
export function isoDate(ms: number): string {
  return dayKey(ms);
}

/** Whole calendar days between two `YYYY-MM-DD` keys (b − a). */
export function daysBetween(a: string, b: string): number {
  return daysBetweenKeys(a, b);
}

// The numeric kernels live in the canonical `../stats` module — single
// source of truth. The finance API keeps its `number | null` shape (null
// for empty input) so callers don't change; the math is delegated.
import { mean as meanCore, median as medianCore, mad as madCore } from '../stats';

/** Mean of a numeric array. Null for empty input. */
export function fMean(a: number[]): number | null {
  if (!a || !a.length) return null;
  return meanCore(a);
}

/** Median of a numeric array. Null for empty input. Even-length safe. */
export function fMedian(a: number[]): number | null {
  if (!a || !a.length) return null;
  return medianCore(a);
}

/**
 * RAW median absolute deviation (no consistency scaling). 0 for empty input.
 *
 * Finding #104: the stored `amount_mad` / `interval_days_mad` convention is
 * RAW MAD. Readers that need a σ estimate apply the Rousseeuw & Croux 1993
 * factor themselves (σ ≈ 1.4826·MAD); readers computing a modified z-score
 * use 0.6745·(x−med)/MAD. Previously fMad returned the SCALED value, and the
 * σ/modZ readers re-scaled it — double-counting 1.4826 in the cash-flow band
 * (~48% too wide) and shrinking the anomaly modZ (~0.45×, missing outliers).
 * Storing RAW here makes the writers and every reader agree.
 */
export function fMad(a: number[], center?: number): number {
  if (!a || !a.length) return 0;
  return madCore(a, 1, center);
}
