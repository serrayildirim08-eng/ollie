/**
 * @ollie/logic · util — small shared helpers.
 *
 * Single source of truth for, and only for:
 *   - day/time constants: `DAY_MS`, `HOUR_MS`, `MINUTE_MS`
 *   - calendar day-key formatting: `dayKey` (LOCAL tz) and `dayKeyUTC` (UTC),
 *     plus the key-arithmetic helpers `nextDayKey` / `daysBetweenKeys`
 *   - capped Levenshtein edit distance: `levenshtein` / `withinEditDistance`
 *   - detector scaffolding: `resolveNow` / `windowFilter` / `confidenceForN`
 *
 * NOT consolidated here (deliberately): Jaro–Winkler merchant similarity
 * (`finance/jaro.ts`) is a distinct similarity algorithm, not an edit-distance
 * variant — it stays in the finance module. Year-month keys (`YYYY-MM`) and
 * calendar-month arithmetic in `finance/*` are also out of scope.
 *
 * ⚠️ Timezone: `dayKey` and `dayKeyUTC` are NOT interchangeable. They produce
 * different strings for the same timestamp near midnight. Each call site has a
 * fixed semantics — pick the variant that matches; never swap one for the other.
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
 * Format an epoch-ms timestamp as a **local-time** `YYYY-MM-DD` key. The
 * year/month/day are read in the host's local timezone, so the same `ts`
 * can yield a different key here than `dayKeyUTC` near midnight.
 *
 * Use this for anything anchored to the user's wall-clock calendar day
 * (habit completions, focus blocks, trips, symptom logs, …).
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
 * Format an epoch-ms timestamp as a **UTC** `YYYY-MM-DD` key. The
 * year/month/day are read in UTC, so this is stable across timezones but
 * can differ from `dayKey` near midnight.
 *
 * Use this only where the original call site read `getUTC*` — swapping it
 * for the local variant silently shifts date math across midnight.
 */
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

// ─── DST-safe calendar-day stepping ──────────────────────────────────────────────
//
// Stepping a timestamp by a fixed 24h (`t += DAY_MS`) while bucketing by a
// LOCAL `dayKey` is wrong across DST transitions: a spring-forward day is 23h
// long and a fall-back day is 25h long, so the 24h step lands on the wrong
// local calendar day — skipping one day or visiting one twice. These helpers
// advance by true LOCAL calendar days instead, so every step maps to exactly
// one local day regardless of DST. Use them for any loop/offset that buckets
// results by `dayKey`.

/**
 * Local **midnight** (00:00:00.000 wall-clock) of the calendar day that
 * contains `ts`, as epoch ms. Built via local `Date` construction, so it is
 * the real start of the local day even on DST-transition days.
 */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Advance `ts` by `n` whole **local calendar days**, preserving the local
 * time-of-day across DST. `new Date(y, m, d + n, …)` normalises overflow and
 * re-resolves the offset, so the result is the same wall-clock time `n` days
 * later — not `ts + n·DAY_MS`, which drifts an hour across DST.
 */
export function addLocalDays(ts: number, n: number): number {
  const d = new Date(ts);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + n,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  ).getTime();
}

/**
 * Iterate the LOCAL calendar-day keys (`YYYY-MM-DD`) from the day containing
 * `from` through the day containing `to`, inclusive — exactly one key per
 * local day, DST-safe. Replaces `for (let t = from; t <= to; t += DAY_MS)`
 * loops that bucket by `dayKey(t)`.
 *
 * Yields nothing when `to < from`.
 */
export function* eachLocalDayKey(
  from: number,
  to: number,
): Generator<string, void, unknown> {
  if (!(to >= from)) return;
  // Anchor at local noon so each += day lands squarely inside the next local
  // day even across a 23h/25h DST transition, then read its dayKey.
  let cursor = startOfLocalDay(from) + 12 * HOUR_MS;
  const end = startOfLocalDay(to) + 12 * HOUR_MS;
  // Guard against pathological non-finite inputs.
  let guard = 0;
  while (cursor <= end && guard++ < 100_000) {
    yield dayKey(cursor);
    cursor = addLocalDays(cursor, 1);
  }
}

// ─── string distance ────────────────────────────────────────────────────────────

/**
 * Full Levenshtein edit distance with an early-exit cap — the single
 * canonical edit-distance implementation for the package. Once a whole row
 * of the DP matrix exceeds `cap`, the function bails and returns
 * `cap + 1` — enough for "definitely too far" checks without paying for
 * the rest of the matrix. With the default `cap = Infinity` it computes the
 * exact distance.
 *
 * Callers (`journal/search` fuzzy-1, `grocery/parse` cap-2, `consumption`
 * brand match-1) all delegate here via thin wrappers — no other
 * edit-distance code exists.
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
