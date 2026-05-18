/**
 * @ollie/logic · util — small shared helpers.
 *
 * Background: `DAY_MS` was defined 18× across the package, calendar
 * day-key formatting was reimplemented ~16×, and three slightly different
 * Levenshtein variants existed. This module is the single home for those.
 *
 * Pure: no I/O, no DOM, no clock reads.
 */

// ─── time constants ────────────────────────────────────────────────────────────

/** Milliseconds in one day. */
export const DAY_MS = 86_400_000;

/** Milliseconds in one hour. */
export const HOUR_MS = 3_600_000;

/** Milliseconds in one minute. */
export const MINUTE_MS = 60_000;

// ─── calendar day keys ──────────────────────────────────────────────────────────

/**
 * Format an epoch-ms timestamp as a local `YYYY-MM-DD` key. This mirrors
 * the formatting the modules already used (local calendar date, not UTC).
 */
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

/**
 * Next calendar day key. Anchors at noon to dodge DST edges, then adds
 * 24h. Returns null for an unparseable input key.
 */
export function nextDayKey(key: string): string | null {
  const t = Date.parse(key + 'T12:00:00');
  if (!Number.isFinite(t)) return null;
  return dayKey(t + DAY_MS);
}

/**
 * Whole calendar days between two `YYYY-MM-DD` keys (b − a). Anchors at
 * noon so DST transitions don't shift the count.
 */
export function daysBetweenKeys(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / DAY_MS,
  );
}

// ─── string distance ────────────────────────────────────────────────────────────

/**
 * Full Levenshtein edit distance with an early-exit cap. Once a whole row
 * of the DP matrix exceeds `cap`, the function bails and returns
 * `cap + 1` — enough for "definitely too far" checks without paying for
 * the rest of the matrix.
 */
export function levenshtein(a: string, b: string, cap = Infinity): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > cap) return cap + 1;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/** True when `a` and `b` are within `k` edits of each other. */
export function withinEditDistance(a: string, b: string, k = 1): boolean {
  return levenshtein(a, b, k) <= k;
}

// ─── detector scaffolding ──────────────────────────────────────────────────────
//
// Roughly 80 detector functions across @ollie/logic repeat the same small
// scaffolding. These helpers carry the most-repeated pieces. They are pure
// and behaviour-preserving — adopting one is a drop-in for the inline form.

/**
 * Resolve the effective `now` for a detector. A detector either receives an
 * explicit numeric `now` (always passed in tests for determinism) or falls
 * back to the wall clock. Replaces the verbatim
 * `typeof opts?.now === 'number' ? opts.now : Date.now()` ladder.
 */
export function resolveNow(now: number | null | undefined): number {
  return typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
}

/**
 * Keep only the timestamped items inside the closed window
 * `[now - windowDays·DAY_MS, now]`. `tsOf` extracts the epoch-ms timestamp
 * from each item. Items with a non-finite timestamp are dropped.
 */
export function windowFilter<T>(
  items: readonly T[],
  now: number,
  windowDays: number,
  tsOf: (item: T) => number,
): T[] {
  const from = now - windowDays * DAY_MS;
  return items.filter((it) => {
    const ts = tsOf(it);
    return Number.isFinite(ts) && ts >= from && ts <= now;
  });
}

/**
 * Map a sample size to a coarse confidence tier. Defaults mirror the most
 * common ladder in the detectors (`n ≥ 14 → high`, `n ≥ 7 → medium`).
 * Pass explicit thresholds for detectors that use a different floor.
 */
export function confidenceForN(
  n: number,
  highAt = 14,
  mediumAt = 7,
): 'high' | 'medium' | 'low' {
  if (n >= highAt) return 'high';
  if (n >= mediumAt) return 'medium';
  return 'low';
}
