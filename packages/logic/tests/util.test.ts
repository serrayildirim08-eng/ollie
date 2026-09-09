/**
 * @ollie/logic · util — shared-helper coverage
 *
 * This is the guard for the H1 / deferred-#4 consolidation: `packages/logic/
 * src/util` is the single home for day/time constants, calendar day-keys,
 * date-key arithmetic and the capped Levenshtein edit distance. Every other
 * module imports from here; these tests pin the exact contract.
 *
 * ⚠️ Timezone: `dayKey` (local tz) and `dayKeyUTC` (UTC) are NOT
 * interchangeable. A cross-midnight case below proves they diverge — that
 * divergence is exactly why the consolidation kept both variants.
 *
 * Pure functions — no clock reads, so every assertion is deterministic
 * regardless of the host timezone (expectations are derived from the same
 * `Date` API the implementation uses, never hard-coded TZ-dependent strings).
 */

import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  dayKey,
  dayKeyUTC,
  nextDayKey,
  daysBetweenKeys,
  startOfLocalDay,
  addLocalDays,
  eachLocalDayKey,
  levenshtein,
  withinEditDistance,
  resolveNow,
  windowFilter,
  confidenceForN,
} from '../src/util';

// ─── time constants ──────────────────────────────────────────────────────

describe('util · time constants', () => {
  it('DAY_MS is exactly 24 hours of milliseconds', () => {
    expect(DAY_MS).toBe(86_400_000);
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('HOUR_MS is exactly one hour of milliseconds', () => {
    expect(HOUR_MS).toBe(3_600_000);
    expect(HOUR_MS).toBe(60 * 60 * 1000);
  });

  it('MINUTE_MS is exactly one minute of milliseconds', () => {
    expect(MINUTE_MS).toBe(60_000);
    expect(MINUTE_MS).toBe(60 * 1000);
  });

  it('constants compose consistently', () => {
    expect(DAY_MS).toBe(HOUR_MS * 24);
    expect(HOUR_MS).toBe(MINUTE_MS * 60);
  });
});

// ─── dayKey — local time ─────────────────────────────────────────────────

describe('util · dayKey (LOCAL tz)', () => {
  it('formats a timestamp as zero-padded YYYY-MM-DD in local time', () => {
    // Build the instant from local-time components so the expectation holds
    // in any host timezone.
    const ts = new Date(2026, 0, 5, 13, 30, 0, 0).getTime(); // 2026-01-05 local
    expect(dayKey(ts)).toBe('2026-01-05');
  });

  it('zero-pads single-digit month and day', () => {
    const ts = new Date(2026, 2, 9, 0, 0, 0, 0).getTime(); // March 9
    expect(dayKey(ts)).toBe('2026-03-09');
    expect(dayKey(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the local Date getters for an arbitrary instant', () => {
    const ts = 1_771_000_000_000; // arbitrary epoch ms
    const d = new Date(ts);
    const expected =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    expect(dayKey(ts)).toBe(expected);
  });

  it('keeps a noon-local instant on the same calendar day in every tz', () => {
    // Noon local is far from any midnight boundary, so the key is stable.
    const ts = new Date(2026, 5, 15, 12, 0, 0, 0).getTime();
    expect(dayKey(ts)).toBe('2026-06-15');
  });

  it('rolls to the next day exactly at local midnight', () => {
    const beforeMidnight = new Date(2026, 0, 5, 23, 59, 59, 999).getTime();
    const atMidnight = new Date(2026, 0, 6, 0, 0, 0, 0).getTime();
    expect(dayKey(beforeMidnight)).toBe('2026-01-05');
    expect(dayKey(atMidnight)).toBe('2026-01-06');
  });

  it('handles the epoch and year boundaries', () => {
    const newYear = new Date(2027, 0, 1, 0, 0, 0, 0).getTime();
    expect(dayKey(newYear)).toBe('2027-01-01');
    const newYearsEve = new Date(2026, 11, 31, 23, 0, 0, 0).getTime();
    expect(dayKey(newYearsEve)).toBe('2026-12-31');
  });
});

// ─── dayKeyUTC — UTC ─────────────────────────────────────────────────────

describe('util · dayKeyUTC (UTC)', () => {
  it('formats a timestamp as zero-padded YYYY-MM-DD in UTC', () => {
    const ts = Date.UTC(2026, 0, 5, 13, 30, 0, 0); // 2026-01-05 13:30 UTC
    expect(dayKeyUTC(ts)).toBe('2026-01-05');
  });

  it('zero-pads single-digit month and day', () => {
    const ts = Date.UTC(2026, 2, 9, 0, 0, 0, 0);
    expect(dayKeyUTC(ts)).toBe('2026-03-09');
    expect(dayKeyUTC(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the UTC Date getters for an arbitrary instant', () => {
    const ts = 1_771_000_000_000;
    const d = new Date(ts);
    const expected =
      d.getUTCFullYear() +
      '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getUTCDate()).padStart(2, '0');
    expect(dayKeyUTC(ts)).toBe(expected);
  });

  it('rolls to the next day exactly at UTC midnight', () => {
    const beforeMidnight = Date.UTC(2026, 0, 5, 23, 59, 59, 999);
    const atMidnight = Date.UTC(2026, 0, 6, 0, 0, 0, 0);
    expect(dayKeyUTC(beforeMidnight)).toBe('2026-01-05');
    expect(dayKeyUTC(atMidnight)).toBe('2026-01-06');
  });
});

// ─── dayKey vs dayKeyUTC — THE TIMEZONE TRAP ─────────────────────────────

describe('util · dayKey vs dayKeyUTC — cross-midnight divergence', () => {
  it('agree for a UTC-noon instant (far from every midnight)', () => {
    // 12:00 UTC is 09:00–15:00 across all real tz offsets — same calendar
    // day locally and in UTC everywhere.
    const ts = Date.UTC(2026, 5, 15, 12, 0, 0, 0);
    expect(dayKey(ts)).toBe(dayKeyUTC(ts));
  });

  it('PROOF: the two variants disagree across a midnight boundary', () => {
    // Construct an instant that is local-midnight exactly. One full UTC day
    // earlier OR later straddles a different UTC calendar day whenever the
    // host is not on UTC. We assert the *property* so the test is valid in
    // every timezone, then exercise the concrete divergence below.
    const offsetMin = new Date().getTimezoneOffset();

    if (offsetMin === 0) {
      // Host is UTC — the two variants are identical by construction.
      // Still assert they never disagree, which is the correct behavior here.
      const ts = Date.UTC(2026, 0, 5, 23, 30, 0, 0);
      expect(dayKey(ts)).toBe(dayKeyUTC(ts));
      return;
    }

    // Pick a local wall-clock instant that straddles the UTC date line for the
    // host's offset direction. The divergence is asymmetric:
    //   - EAST of UTC (offsetMin < 0): local *midnight* is still the PREVIOUS
    //     UTC calendar day (e.g. Istanbul +3 → 21:00 UTC the day before).
    //   - WEST of UTC (offsetMin > 0): local midnight is the SAME UTC day, so
    //     we instead take 23:30 LOCAL, which is already the NEXT UTC day
    //     (e.g. America/LA −8 → 07:30 UTC tomorrow).
    if (offsetMin < 0) {
      // East of UTC: local midnight on 2026-01-06.
      const localMidnight = new Date(2026, 0, 6, 0, 0, 0, 0).getTime();
      expect(dayKey(localMidnight)).toBe('2026-01-06');
      expect(dayKeyUTC(localMidnight)).toBe('2026-01-05');
      expect(dayKeyUTC(localMidnight)).not.toBe(dayKey(localMidnight));
    } else {
      // West of UTC: 23:30 LOCAL on 2026-01-05.
      const lateLocal = new Date(2026, 0, 5, 23, 30, 0, 0).getTime();
      expect(dayKey(lateLocal)).toBe('2026-01-05');
      expect(dayKeyUTC(lateLocal)).toBe('2026-01-06');
      expect(dayKeyUTC(lateLocal)).not.toBe(dayKey(lateLocal));
    }
  });

  it('a fixed UTC instant near midnight is read on the matching day by each variant', () => {
    // 2026-03-10 23:00 UTC — a concrete instant. Each variant must report
    // the calendar day of its own reference frame.
    const ts = Date.UTC(2026, 2, 10, 23, 0, 0, 0);
    const d = new Date(ts);

    const expectedLocal =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    expect(dayKey(ts)).toBe(expectedLocal);
    expect(dayKeyUTC(ts)).toBe('2026-03-10');
  });
});

// ─── nextDayKey ──────────────────────────────────────────────────────────

describe('util · nextDayKey', () => {
  it('advances a key by one calendar day', () => {
    expect(nextDayKey('2026-01-05')).toBe('2026-01-06');
  });

  it('crosses a month boundary', () => {
    expect(nextDayKey('2026-01-31')).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
  });

  it('handles the leap-day boundary (2028 is a leap year)', () => {
    expect(nextDayKey('2028-02-28')).toBe('2028-02-29');
    expect(nextDayKey('2028-02-29')).toBe('2028-03-01');
  });

  it('handles a non-leap February boundary', () => {
    expect(nextDayKey('2026-02-28')).toBe('2026-03-01');
  });

  it('returns null for an unparseable key', () => {
    expect(nextDayKey('not-a-date')).toBeNull();
    expect(nextDayKey('')).toBeNull();
  });

  it('is anchored at noon — stable across DST transitions', () => {
    // Spring-forward and fall-back dates: noon-anchoring means a +24h hop
    // never lands short or long of the next calendar day.
    expect(nextDayKey('2026-03-08')).toBe('2026-03-09'); // US spring forward
    expect(nextDayKey('2026-11-01')).toBe('2026-11-02'); // US fall back
  });
});

// ─── daysBetweenKeys ─────────────────────────────────────────────────────

describe('util · daysBetweenKeys', () => {
  it('counts whole days between two keys (b - a)', () => {
    expect(daysBetweenKeys('2026-01-05', '2026-01-12')).toBe(7);
  });

  it('returns 0 for the same key', () => {
    expect(daysBetweenKeys('2026-01-05', '2026-01-05')).toBe(0);
  });

  it('returns a negative count when b precedes a', () => {
    expect(daysBetweenKeys('2026-01-12', '2026-01-05')).toBe(-7);
  });

  it('counts across a month boundary', () => {
    expect(daysBetweenKeys('2026-01-30', '2026-02-02')).toBe(3);
  });

  it('counts across a year boundary', () => {
    expect(daysBetweenKeys('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('counts across a leap day', () => {
    expect(daysBetweenKeys('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('is the inverse-ish of nextDayKey for a one-day step', () => {
    const a = '2026-06-15';
    const b = nextDayKey(a)!;
    expect(daysBetweenKeys(a, b)).toBe(1);
  });
});

// ─── DST-safe calendar-day stepping (finding #140) ───────────────────────────

describe('util · startOfLocalDay / addLocalDays / eachLocalDayKey', () => {
  it('startOfLocalDay returns local midnight of the day containing ts', () => {
    const noon = new Date(2026, 2, 8, 12, 34, 56, 789).getTime();
    const sod = startOfLocalDay(noon);
    const d = new Date(sod);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(dayKey(sod)).toBe(dayKey(noon));
  });

  it('addLocalDays preserves local wall-clock time-of-day', () => {
    const t = new Date(2026, 0, 10, 9, 30, 0, 0).getTime();
    const plus3 = addLocalDays(t, 3);
    const d = new Date(plus3);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
    expect(dayKey(plus3)).toBe('2026-01-13');
  });

  it('addLocalDays(-1) is the previous LOCAL calendar day', () => {
    const t = new Date(2026, 0, 1, 0, 30, 0, 0).getTime();
    expect(dayKey(addLocalDays(t, -1))).toBe('2025-12-31');
  });

  it('eachLocalDayKey yields one key per local day, inclusive, no skip/dup', () => {
    const from = new Date(2026, 0, 1, 5, 0, 0, 0).getTime();
    const to = new Date(2026, 0, 5, 22, 0, 0, 0).getTime();
    const keys = [...eachLocalDayKey(from, to)];
    expect(keys).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
    ]);
    // distinct + consecutive
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('eachLocalDayKey yields nothing when to < from', () => {
    const from = new Date(2026, 0, 5, 0, 0, 0, 0).getTime();
    const to = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
    expect([...eachLocalDayKey(from, to)]).toEqual([]);
  });

  it('DST: fixed 24h stepping skips/dups a day but the helpers do not', () => {
    // Spring-forward in US zones is 2026-03-08 (a 23h local day). Walk a window
    // straddling it. The helper must emit EXACTLY one key per local calendar
    // day with NONE missing and NONE repeated, regardless of host TZ.
    const from = new Date(2026, 2, 6, 1, 0, 0, 0).getTime(); // Mar 6
    const to = new Date(2026, 2, 11, 1, 0, 0, 0).getTime(); // Mar 11
    const keys = [...eachLocalDayKey(from, to)];
    expect(keys).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08', // DST transition day — present exactly once
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ]);

    // Contrast with the OLD buggy pattern (`t += DAY_MS` + dayKey) so the
    // regression is documented when the host actually observes a DST shift in
    // this window (e.g. America/Los_Angeles). On UTC there is no shift and the
    // naive walk happens to be correct — so only assert the bug where it bites.
    const naive: string[] = [];
    for (let t = startOfLocalDay(from) + 12 * HOUR_MS; t <= startOfLocalDay(to) + 12 * HOUR_MS; t += DAY_MS) {
      naive.push(dayKey(t));
    }
    const springForwardOffsetShift =
      new Date(2026, 2, 6).getTimezoneOffset() !==
      new Date(2026, 2, 11).getTimezoneOffset();
    if (springForwardOffsetShift) {
      // The naive 24h walk drifts an hour and double-counts a day on the
      // 23h-long DST day — proving the helper fixes a real bug here.
      expect(naive).not.toEqual(keys);
    }
  });
});

// ─── levenshtein ─────────────────────────────────────────────────────────

describe('util · levenshtein (capped DP edit distance)', () => {
  it('is 0 for identical strings', () => {
    expect(levenshtein('matcha', 'matcha')).toBe(0);
    expect(levenshtein('', '')).toBe(0);
  });

  it('equals the length when one side is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abcd', '')).toBe(4);
  });

  it('counts a single substitution', () => {
    expect(levenshtein('cat', 'cot')).toBe(1);
  });

  it('counts a single insertion', () => {
    expect(levenshtein('cat', 'cart')).toBe(1);
  });

  it('counts a single deletion', () => {
    expect(levenshtein('cart', 'cat')).toBe(1);
  });

  it('computes the classic kitten/sitting distance of 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('is symmetric', () => {
    expect(levenshtein('starbucks', 'starbcuks')).toBe(
      levenshtein('starbcuks', 'starbucks'),
    );
  });

  it('counts a transposition as two edits (no Damerau adjacency)', () => {
    // Levenshtein, not Damerau-Levenshtein: a swap is delete + insert.
    expect(levenshtein('ab', 'ba')).toBe(2);
  });

  it('caps the result: returns cap + 1 once a whole DP row exceeds cap', () => {
    // 'abcdef' vs 'uvwxyz' is distance 6; with cap 2 it must early-exit.
    expect(levenshtein('abcdef', 'uvwxyz', 2)).toBe(3);
  });

  it('cap does not interfere when the true distance is within budget', () => {
    expect(levenshtein('cat', 'cot', 2)).toBe(1);
    expect(levenshtein('kitten', 'sitting', 5)).toBe(3);
  });

  it('length-difference exceeding the cap short-circuits', () => {
    // |m - n| = 5 > cap 1, so it bails immediately with cap + 1.
    expect(levenshtein('a', 'abcdef', 1)).toBe(2);
  });

  it('cap exactly equal to the true distance still returns the true distance', () => {
    expect(levenshtein('kitten', 'sitting', 3)).toBe(3);
  });

  it('is unicode-codepoint aware via charCodeAt comparison', () => {
    expect(levenshtein('café', 'cafe')).toBe(1);
  });
});

// ─── withinEditDistance ──────────────────────────────────────────────────

describe('util · withinEditDistance', () => {
  it('is true for identical strings at any k', () => {
    expect(withinEditDistance('matcha', 'matcha', 1)).toBe(true);
    expect(withinEditDistance('matcha', 'matcha', 0)).toBe(true);
  });

  it('is true within the default k = 1 budget', () => {
    expect(withinEditDistance('cat', 'cot')).toBe(true);
    expect(withinEditDistance('cat', 'cart')).toBe(true);
  });

  it('is false when the distance exceeds k', () => {
    expect(withinEditDistance('cat', 'dog', 1)).toBe(false);
    expect(withinEditDistance('kitten', 'sitting', 2)).toBe(false);
  });

  it('respects a larger explicit k', () => {
    expect(withinEditDistance('kitten', 'sitting', 3)).toBe(true);
  });

  it('k = 0 means exact match only', () => {
    expect(withinEditDistance('cat', 'cot', 0)).toBe(false);
    expect(withinEditDistance('cat', 'cat', 0)).toBe(true);
  });
});

// ─── resolveNow ──────────────────────────────────────────────────────────

describe('util · resolveNow', () => {
  it('returns an explicit finite numeric now unchanged', () => {
    expect(resolveNow(1_771_000_000_000)).toBe(1_771_000_000_000);
    expect(resolveNow(0)).toBe(0);
  });

  it('falls back to the wall clock for null / undefined', () => {
    const before = Date.now();
    const a = resolveNow(null);
    const b = resolveNow(undefined);
    const after = Date.now();
    expect(a).toBeGreaterThanOrEqual(before);
    expect(a).toBeLessThanOrEqual(after);
    expect(b).toBeGreaterThanOrEqual(before);
    expect(b).toBeLessThanOrEqual(after);
  });

  it('falls back to the wall clock for non-finite numbers', () => {
    const before = Date.now();
    const a = resolveNow(NaN);
    const after = Date.now();
    expect(a).toBeGreaterThanOrEqual(before);
    expect(a).toBeLessThanOrEqual(after);
    expect(Number.isFinite(resolveNow(Infinity))).toBe(true);
  });
});

// ─── windowFilter ────────────────────────────────────────────────────────

describe('util · windowFilter', () => {
  const now = Date.UTC(2026, 0, 30, 12, 0, 0, 0);
  const tsOf = (x: { ts: number }) => x.ts;

  it('keeps items inside the closed [now - windowDays·DAY_MS, now] window', () => {
    const items = [
      { ts: now },                  // exactly now — kept (closed upper bound)
      { ts: now - 3 * DAY_MS },     // inside
      { ts: now - 7 * DAY_MS },     // exactly the lower bound — kept
    ];
    expect(windowFilter(items, now, 7, tsOf)).toHaveLength(3);
  });

  it('drops items older than the window', () => {
    const items = [{ ts: now - 8 * DAY_MS }];
    expect(windowFilter(items, now, 7, tsOf)).toHaveLength(0);
  });

  it('drops items in the future (after now)', () => {
    const items = [{ ts: now + 1 }];
    expect(windowFilter(items, now, 7, tsOf)).toHaveLength(0);
  });

  it('drops items with a non-finite timestamp', () => {
    const items = [{ ts: NaN }, { ts: Infinity }, { ts: now }];
    expect(windowFilter(items, now, 7, tsOf)).toEqual([{ ts: now }]);
  });

  it('returns an empty array for empty input', () => {
    expect(windowFilter([], now, 7, tsOf)).toEqual([]);
  });

  it('preserves input order of the kept items', () => {
    const items = [
      { ts: now - 1 * DAY_MS, id: 'a' },
      { ts: now - 6 * DAY_MS, id: 'b' },
      { ts: now - 2 * DAY_MS, id: 'c' },
    ];
    const kept = windowFilter(items, now, 7, (x) => x.ts).map((x) => x.id);
    expect(kept).toEqual(['a', 'b', 'c']);
  });
});

// ─── confidenceForN ──────────────────────────────────────────────────────

describe('util · confidenceForN', () => {
  it('uses the default ladder: n >= 14 → high', () => {
    expect(confidenceForN(14)).toBe('high');
    expect(confidenceForN(100)).toBe('high');
  });

  it('uses the default ladder: 7 <= n < 14 → medium', () => {
    expect(confidenceForN(7)).toBe('medium');
    expect(confidenceForN(13)).toBe('medium');
  });

  it('uses the default ladder: n < 7 → low', () => {
    expect(confidenceForN(6)).toBe('low');
    expect(confidenceForN(0)).toBe('low');
  });

  it('respects custom thresholds', () => {
    expect(confidenceForN(20, 30, 10)).toBe('medium');
    expect(confidenceForN(30, 30, 10)).toBe('high');
    expect(confidenceForN(9, 30, 10)).toBe('low');
  });

  it('treats the thresholds as inclusive floors', () => {
    expect(confidenceForN(10, 20, 10)).toBe('medium');
    expect(confidenceForN(20, 20, 10)).toBe('high');
  });
});
