/**
 * @ollie/logic · body math helpers
 *
 * Pure statistical utilities. No I/O. The numeric kernels and day-key
 * helpers are delegated to the canonical `../stats` and `../util` modules
 * (single source of truth). The body-specific functions below keep their
 * historical stricter input floors so detector behaviour is unchanged.
 */

import { pearson as pearsonCore, ranks, spearman as spearmanCore } from '../stats';
import { dayKey as dayKeyCore, nextDayKey as nextDayKeyCore } from '../util';

/** Format an epoch ms timestamp as YYYY-MM-DD. */
export function dayKey(ts: number): string {
  return dayKeyCore(ts);
}

/**
 * Pearson r on two equal-length arrays. Returns 0 for degenerate input.
 * The body module historically required at least 3 points — keep that
 * stricter floor here so detector behaviour does not change.
 */
export function pearson(xs: number[], ys: number[]): number {
  if (!Array.isArray(xs) || !Array.isArray(ys)) return 0;
  if (xs.length !== ys.length || xs.length < 3) return 0;
  return pearsonCore(xs, ys);
}

/** Rank array for Spearman (handles ties via average rank). */
export function rank(arr: number[]): number[] {
  return ranks(arr);
}

/** Spearman ρ. Returns 0 for degenerate input (body floor: ≥3 points). */
export function spearman(xs: number[], ys: number[]): number {
  if (!Array.isArray(xs) || !Array.isArray(ys)) return 0;
  if (xs.length !== ys.length || xs.length < 3) return 0;
  return spearmanCore(xs, ys);
}

/** Next calendar day key (YYYY-MM-DD → YYYY-MM-DD + 1 day). */
export function nextDayKey(k: string): string | null {
  return nextDayKeyCore(k);
}
