/**
 * @ollie/orchestrator · body-weekly tests
 *
 * Covers:
 *   - computeWeeklyReview: normal week, sparse week, skipped-day detection
 *   - isoWeekKey dedup: same week returns same key
 *   - nextSunday19: correct next-Sunday-19:00 computation
 *   - emitWeeklyReview: emits event + dedup per week
 *   - APNs subscriber: scheduleNotification called on emit
 *   - Banned-phrase compliance: copy never scolding
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import {
  computeWeeklyReview,
  emitWeeklyReview,
  isoWeekKey,
  nextSunday19,
  SPARSE_THRESHOLD,
} from '../src/body-weekly';
import type { WeeklyReviewInput } from '../src/body-weekly';
import type { NotificationSpec } from '@ollie/notifications';

// Fixed wall-clock: Sunday 2026-05-10T19:00:00 local (a Sunday at exactly 19:00)
// Use local noon on Sunday May 10 so startOfWeek lands on Sunday May 10 00:00 local.
const SUNDAY_19 = new Date('2026-05-10T19:00:00').getTime();
// Canonical week start for SUNDAY_19: Sunday May 10 00:00 local
const WEEK_START = new Date('2026-05-10T00:00:00').getTime();
const DAY_MS = 86_400_000;

// ─── helpers ────────────────────────────────────────────────────────────────

function makeHabits(count: number, completionsPerHabit: number, weekStart: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `h${i}`,
    name: `habit ${i}`,
    cueTime: 'morning',
    completions: Array.from({ length: completionsPerHabit }, (_, d) => ({
      ts: weekStart + d * DAY_MS + 9 * 3600_000, // 09:00 each day
    })),
  }));
}

function makeSleepRecords(avgHours: number, nights: number, weekStart: number) {
  return Array.from({ length: nights }, (_, d) => ({
    night_of: new Date(weekStart + d * DAY_MS).toISOString().slice(0, 10),
    tst_min: avgHours * 60,
    is_skipped: false,
  }));
}

// ─── computeWeeklyReview ────────────────────────────────────────────────────

describe('computeWeeklyReview', () => {
  it('normal week: 32 of 35 habits → copy includes "32 of 35"', () => {
    // 5 habits, 7 days expected (35 total), 32 completed
    // Build: 4 habits with 7 completions (28) + 1 habit with 4 completions = 32
    const weekStart = WEEK_START;
    const habits = [
      ...makeHabits(4, 7, weekStart),
      {
        id: 'h4',
        name: 'workout',
        cueTime: 'morning',
        completions: Array.from({ length: 4 }, (_, d) => ({
          ts: weekStart + d * DAY_MS + 9 * 3600_000,
        })),
      },
    ];

    const result = computeWeeklyReview({
      now: SUNDAY_19,
      habits,
      sleepRecords: [],
    });

    expect(result.summary.habitsCompleted).toBe(32);
    expect(result.summary.habitsTotal).toBe(35);
    expect(result.copy).toContain('32 of 35');
  });

  it('sparse week (<5 entries) → first-week-style copy', () => {
    const habits = makeHabits(3, 1, WEEK_START); // only 3 entries total

    const result = computeWeeklyReview({
      now: SUNDAY_19,
      habits,
      sleepRecords: [],
    });

    expect(result.summary.isSparse).toBe(true);
    expect(result.copy).toContain('first week');
    expect(result.copy).not.toContain('of');
  });

  it('sparse threshold is ' + SPARSE_THRESHOLD, () => {
    expect(SPARSE_THRESHOLD).toBe(5);
  });

  it('skipped-day detection: workout habit skipped on tuesdays → surfaces "tuesdays"', () => {
    // Build a habit with completions on every day EXCEPT tuesday (day index 2)
    // Use the Sunday that starts this week
    const sunStart = new Date('2026-05-03T00:00:00').getTime();
    const completions = [0, 1, 3, 4, 5, 6].map((d) => ({ // skip day 2 = tuesday
      ts: sunStart + d * DAY_MS + 9 * 3600_000,
    }));

    // mostSkippedWeekday should be tuesday (only the workout habit was skipped on tuesday).
    // With 5 habits total, tuesday has 1 skip — 1/5 = 20%, below the ceil(5/2)=3
    // threshold, so it won't surface. Use 3 habits where tuesday is skipped by
    // more than half.
    const habits2 = [
      { id: 'w1', name: 'workout', completions },
      { id: 'w2', name: 'run', completions },
      { id: 'w3', name: 'stretch', completions },
    ];

    const result2 = computeWeeklyReview({
      now: sunStart + 6 * DAY_MS + 20 * 3600_000,
      habits: habits2,
      sleepRecords: [],
    });

    expect(result2.summary.mostSkippedWeekday).toBe('tuesday');
    expect(result2.copy).toContain('tuesday');
  });

  it('dedup: isoWeekKey returns same key for two timestamps in same ISO week', () => {
    // ISO week W20 2026 runs Mon May 11 – Sun May 17.
    // Monday May 11 and Friday May 15 are both in W20.
    const monday = new Date('2026-05-11T08:00:00').getTime();
    const friday = new Date('2026-05-15T20:00:00').getTime();
    expect(isoWeekKey(monday)).toBe(isoWeekKey(friday));
  });

  it('isoWeekKey returns different keys for different ISO weeks', () => {
    // Monday May 11 (W20) vs Monday May 18 (W21)
    const w20 = new Date('2026-05-11T12:00:00').getTime();
    const w21 = new Date('2026-05-18T12:00:00').getTime();
    expect(isoWeekKey(w20)).not.toBe(isoWeekKey(w21));
  });

  it('copy ends with "that\'s information." for non-sparse weeks', () => {
    const weekStart = WEEK_START;
    const habits = makeHabits(5, 7, weekStart);
    const result = computeWeeklyReview({ now: SUNDAY_19, habits, sleepRecords: [] });
    expect(result.copy).toContain("that's information.");
  });

  it('sleep avg surfaced when < 6h and ≥3 nights logged', () => {
    const weekStart = WEEK_START;
    const habits = makeHabits(5, 7, weekStart);
    const sleepRecords = makeSleepRecords(5, 4, weekStart);
    const result = computeWeeklyReview({ now: SUNDAY_19, habits, sleepRecords });
    expect(result.copy).toContain('5h');
    expect(result.summary.sleepAvgHours).toBe(5);
  });

  it('water avg surfaced when < 4 cups/day', () => {
    const weekStart = WEEK_START;
    const habits = makeHabits(5, 7, weekStart);
    // 14 water entries in 7 days = 2 cups/day avg
    const waterLog = Array.from({ length: 14 }, (_, i) => ({
      ts: weekStart + Math.floor(i / 2) * DAY_MS + 10 * 3600_000,
    }));
    const result = computeWeeklyReview({ now: SUNDAY_19, habits, sleepRecords: [], waterLog });
    expect(result.summary.waterAvgCups).toBe(2);
    expect(result.copy).toContain('cups/day');
  });

  it('supplement adherence surfaced when < 70%', () => {
    const habits = makeHabits(5, 7, WEEK_START);
    // Hard-coded ISO dates within week of May 10–16 2026 (verified in-window)
    const supplements = [{
      name: 'Vitamin D',
      checked_dates: ['2026-05-10', '2026-05-11', '2026-05-12'],
    }];
    const result = computeWeeklyReview({ now: SUNDAY_19, habits, sleepRecords: [], supplements });
    // 3 out of 7 = 43%
    expect(result.summary.supplementAdherencePct).toBe(43);
    expect(result.copy).toContain('supplements:');
  });
});

// ─── nextSunday19 ───────────────────────────────────────────────────────────

describe('nextSunday19', () => {
  it('from Monday returns next Sunday 19:00', () => {
    const monday = new Date('2026-05-11T12:00:00').getTime(); // a Monday
    const fireAt = nextSunday19(monday);
    const d = new Date(fireAt);
    expect(d.getDay()).toBe(0); // Sunday
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('from Sunday before 19:00 returns same day 19:00', () => {
    const sunday = new Date('2026-05-10T10:00:00').getTime(); // Sunday before 19:00
    const fireAt = nextSunday19(sunday);
    const d = new Date(fireAt);
    expect(d.getDay()).toBe(0);
    expect(d.getHours()).toBe(19);
    // Should be same date
    expect(new Date(fireAt).toDateString()).toBe(new Date(sunday).toDateString());
  });

  it('from Sunday after 19:00 returns NEXT Sunday 19:00', () => {
    const sunday = new Date('2026-05-10T20:00:00').getTime(); // Sunday after 19:00
    const fireAt = nextSunday19(sunday);
    const d = new Date(fireAt);
    expect(d.getDay()).toBe(0);
    expect(d.getHours()).toBe(19);
    // Should be 7 days later
    expect(fireAt - sunday).toBeGreaterThan(6 * DAY_MS);
  });
});

// ─── emitWeeklyReview ───────────────────────────────────────────────────────

describe('emitWeeklyReview', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SUNDAY_19);
    store = createStore(createMemoryAdapter());
  });

  afterEach(() => {
    vi.useRealTimers();
    _clearAllHandlers();
  });

  it('emits body:weekly_review event with correct shape', () => {
    const weekStart = WEEK_START;
    store.set('shared', 'habits_v2', makeHabits(5, 7, weekStart));

    const received: unknown[] = [];
    on('body:weekly_review', (p) => received.push(p));

    const emitted = emitWeeklyReview({ store, now: () => SUNDAY_19 });
    expect(emitted).toBe(true);
    expect(received).toHaveLength(1);

    const payload = received[0] as {
      ts: number;
      weekStartTs: number;
      weekEndTs: number;
      copy: string;
      summary: { habitsCompleted: number; habitsTotal: number };
    };
    expect(payload.ts).toBe(SUNDAY_19);
    expect(typeof payload.weekStartTs).toBe('number');
    expect(typeof payload.weekEndTs).toBe('number');
    expect(typeof payload.copy).toBe('string');
    expect(payload.copy.length).toBeGreaterThan(0);
    expect(typeof payload.summary.habitsCompleted).toBe('number');
    expect(typeof payload.summary.habitsTotal).toBe('number');
  });

  it('dedup: second emitWeeklyReview same week returns false and does not re-emit', () => {
    const weekStart = WEEK_START;
    store.set('shared', 'habits_v2', makeHabits(5, 7, weekStart));

    const received: unknown[] = [];
    on('body:weekly_review', (p) => received.push(p));

    emitWeeklyReview({ store, now: () => SUNDAY_19 });
    const second = emitWeeklyReview({ store, now: () => SUNDAY_19 + 3600_000 }); // 1h later same week

    expect(second).toBe(false);
    expect(received).toHaveLength(1);
  });

  it('emits again in a different week', () => {
    const weekStart = WEEK_START;
    store.set('shared', 'habits_v2', makeHabits(5, 7, weekStart));

    const received: unknown[] = [];
    on('body:weekly_review', (p) => received.push(p));

    emitWeeklyReview({ store, now: () => SUNDAY_19 });

    // Next Sunday = 7 days later
    const nextSunday = SUNDAY_19 + 7 * DAY_MS;
    store.set('shared', 'habits_v2', makeHabits(5, 7, nextSunday - 7 * DAY_MS));
    const third = emitWeeklyReview({ store, now: () => nextSunday });

    expect(third).toBe(true);
    expect(received).toHaveLength(2);
  });

  it('calls scheduleNotification when injected', () => {
    const weekStart = WEEK_START;
    store.set('shared', 'habits_v2', makeHabits(5, 7, weekStart));

    const calls: Array<{ spec: NotificationSpec; fireAt: number }> = [];
    const scheduleNotification = (spec: NotificationSpec, fireAt: number) => {
      calls.push({ spec, fireAt });
    };

    emitWeeklyReview({ store, now: () => SUNDAY_19, scheduleNotification });

    expect(calls).toHaveLength(1);
    expect(calls[0].spec.category).toBe('CONTENT_DELIVERY');
    expect(calls[0].spec.dedupe_key).toContain('body:weekly_review:');
    expect(calls[0].spec.title.length).toBeGreaterThan(0);
  });

  it('copy never contains banned phrases', () => {
    const weekStart = WEEK_START;
    // Test various conditions
    const testCases: WeeklyReviewInput[] = [
      // Normal week
      { now: SUNDAY_19, habits: makeHabits(5, 7, weekStart), sleepRecords: [] },
      // Sparse
      { now: SUNDAY_19, habits: makeHabits(2, 1, weekStart), sleepRecords: [] },
      // Short sleep
      { now: SUNDAY_19, habits: makeHabits(5, 7, weekStart), sleepRecords: makeSleepRecords(5, 4, weekStart) },
    ];

    const banned = [
      'great job', 'great week', 'you did', 'you should', 'streak', 'congratulations',
      'awesome', 'amazing', 'proud', 'do better', 'try harder',
    ];

    for (const tc of testCases) {
      const { copy } = computeWeeklyReview(tc);
      for (const phrase of banned) {
        expect(copy.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});
