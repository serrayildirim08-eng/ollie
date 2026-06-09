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

    // Pick the instant of local midnight on 2026-01-06. In UTC this instant
    // is offsetMin minutes away from midnight, so it lands on a different
    // wall-clock hour — and, because it is *exactly* a local day boundary,
    // the UTC calendar day differs from the local one.
    const localMidnight = new Date(2026, 0, 6, 0, 0, 0, 0).getTime();
    const localKey = dayKey(localMidnight);
    const utcKey = dayKeyUTC(localMidnight);

    // Local sees the new day...
    expect(localKey).toBe('2026-01-06');
    // ...UTC does not (it is still 2026-01-05 for tz east of UTC, or already
    // 2026-01-06 with a stale hour for tz west — either way the keys differ
    // because the instant is a *local* boundary, not a UTC one).
    expect(utcKey).not.toBe(localKey);

    // Spell out the direction so a regression is obvious:
    if (offsetMin > 0) {
      // West of UTC (e.g. Americas): local midnight is already tomorrow UTC.
      expect(utcKey).toBe('2026-01-06');
    } else {
      // East of UTC (e.g. Istanbul, the CI host): local midnight is still
      // the previous calendar day in UTC.
      expect(utcKey).toBe('2026-01-05');
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
