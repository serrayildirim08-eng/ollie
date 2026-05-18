/**
 * @ollie/logic · finance math helpers
 *
 * Pure stat functions. No side-effects, no wall-clock reads, no I/O.
 */

// DAY_MS / day-key helpers come from the shared util module — single
// source of truth. Re-exported so finance callers keep their import path.
import { DAY_MS, dayKey, daysBetweenKeys } from '../util';
export { DAY_MS };

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

/** Scaled MAD (Rousseeuw & Croux 1993: σ ≈ 1.4826·MAD). 0 for empty input. */
export function fMad(a: number[], center?: number): number {
  if (!a || !a.length) return 0;
  return madCore(a, 1.4826, center);
}
