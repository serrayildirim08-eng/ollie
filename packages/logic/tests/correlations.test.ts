/**
 * @ollie/logic · body · correlation registry tests
 *
 * Covers:
 *   - registry shape + completeness (6 entries)
 *   - runAllCorrelations executes every implemented correlator
 *   - PENDING (water_focus) returns detected=false without faking math
 *   - threshold + sample-size gating (sparse → detected=false)
 *   - copy passes the banned-phrase scanner
 *   - takeUserDataSnapshot reads canonical store keys
 *
 * Plus per-correlator tests:
 *   - luteal-spending (positive direction, sparse, no cycles)
 *   - workout-skip-mood (positive direction, single class, sparse)
 *   - sleep-debt-habits (negative direction, sparse, missing-data resilience)
 *   - evening-matcha-sleep (matcha-only filter, sparse, non-matcha excluded)
 *   - water-focus (always PENDING)
 */

import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scanForBanned } = require('../../../tools/banned-phrases.cjs') as {
  scanForBanned: (text: string, scope?: string | string[]) => Array<{ id: string; why: string }>;
};

import {
  CORRELATION_REGISTRY,
  runAllCorrelations,
  takeUserDataSnapshot,
  correlateLutealAndSpending,
  correlateWorkoutSkipAndMood,
  correlateSleepDebtAndHabits,
  correlateEveningMatchaAndSleep,
  correlateWaterAndFocus,
  type UserDataSnapshot,
  type CorrelationName,
  type SnapshotStoreLike,
} from '../src/body';
import type { FinanceRecord } from '../src/finance';
import type { CycleRecord } from '../src/cycle/types';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-05-10T12:00:00').getTime();

// ─── helpers ─────────────────────────────────────────────────────────────

function txn(eventDate: string, amount: number, merchant = 'generic'): FinanceRecord {
  return {
    id: `t-${eventDate}-${Math.random().toString(36).slice(2, 6)}`,
    event_date: eventDate,
    amount,
    currency: 'USD',
    merchant,
    merchant_normalized: merchant,
    direction: 'out',
    tokens: [],
    is_adhd_tax: false,
    adhd_tax_type: null,
  };
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptySnapshot(): UserDataSnapshot {
  return {
    now: NOW,
    finance: [],
    brainDumps: [],
    dumps: [],
    sleepRecords: [],
    cycles: [],
    habits: [],
    sleepTargetHours: 7.5,
  };
}

// ─── registry ────────────────────────────────────────────────────────────

describe('CORRELATION_REGISTRY · shape', () => {
  it('lists six correlators', () => {
    expect(CORRELATION_REGISTRY).toHaveLength(6);
  });

  it('has unique names', () => {
    const names = CORRELATION_REGISTRY.map((e) => e.name);
    const set = new Set(names);
    expect(set.size).toBe(names.length);
  });

  it('includes every required CorrelationName', () => {
    const expected: CorrelationName[] = [
      'caffeine_sleep',
      'luteal_spending',
      'workout_skip_mood',
      'water_focus',
      'sleep_debt_habits',
      'evening_matcha_sleep',
    ];
    const names = new Set(CORRELATION_REGISTRY.map((e) => e.name));
    for (const e of expected) expect(names.has(e)).toBe(true);
  });

  it('flags water_focus as PENDING with a reason', () => {
    const entry = CORRELATION_REGISTRY.find((e) => e.name === 'water_focus');
    expect(entry).toBeDefined();
    expect(entry!.implemented).toBe(false);
    expect(entry!.reason).toBeTruthy();
  });

  it('marks every other entry as implemented=true', () => {
    const others = CORRELATION_REGISTRY.filter((e) => e.name !== 'water_focus');
    for (const e of others) expect(e.implemented).toBe(true);
  });

  it('keeps thresholds in (0, 1)', () => {
    for (const e of CORRELATION_REGISTRY) {
      expect(e.threshold).toBeGreaterThan(0);
      expect(e.threshold).toBeLessThan(1);
    }
  });

  it('keeps minSampleSize >= 10', () => {
    for (const e of CORRELATION_REGISTRY) {
      expect(e.minSampleSize).toBeGreaterThanOrEqual(10);
    }
  });
});

// ─── runAllCorrelations ──────────────────────────────────────────────────

describe('runAllCorrelations · execution', () => {
  it('returns one result per registry entry', () => {
    const results = runAllCorrelations(emptySnapshot());
    expect(results).toHaveLength(CORRELATION_REGISTRY.length);
  });

  it('returns detected=false for every correlator on empty input', () => {
    const results = runAllCorrelations(emptySnapshot());
    for (const r of results) {
      expect(r.detected).toBe(false);
      expect(r.copy).toBeNull();
    }
  });

  it('marks water_focus as implemented=false even with input', () => {
    const results = runAllCorrelations(emptySnapshot());
    const wf = results.find((r) => r.name === 'water_focus')!;
    expect(wf.implemented).toBe(false);
    expect(wf.correlation).toBeNull();
    expect(wf.copy).toBeNull();
    expect(wf.detected).toBe(false);
  });

  it('preserves the registry order', () => {
    const results = runAllCorrelations(emptySnapshot());
    for (let i = 0; i < CORRELATION_REGISTRY.length; i++) {
      expect(results[i].name).toBe(CORRELATION_REGISTRY[i].name);
    }
  });

  it('skips PENDING correlators gracefully when input bigger than empty', () => {
    const snap: UserDataSnapshot = {
      ...emptySnapshot(),
      finance: [txn('2026-05-01', 5)],
    };
    const results = runAllCorrelations(snap);
    const wf = results.find((r) => r.name === 'water_focus')!;
    expect(wf.implemented).toBe(false);
    expect(wf.detected).toBe(false);
  });

  it('returns one CorrelationName per entry — no synonyms', () => {
    const results = runAllCorrelations(emptySnapshot());
    const names = results.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── takeUserDataSnapshot ────────────────────────────────────────────────

describe('takeUserDataSnapshot · store adapter', () => {
  function makeStore(state: Record<string, Record<string, unknown>>): SnapshotStoreLike {
    return {
      get<T>(ns: string, key: string, fallback?: T): T | undefined {
        const v = state[ns]?.[key];
        return (v === undefined ? fallback : v) as T | undefined;
      },
    };
  }

  it('returns empty arrays + default targetHours when store is empty', () => {
    const store = makeStore({});
    const snap = takeUserDataSnapshot(store, NOW);
    expect(snap.now).toBe(NOW);
    expect(snap.finance).toEqual([]);
    expect(snap.brainDumps).toEqual([]);
    expect(snap.dumps).toEqual([]);
    expect(snap.sleepRecords).toEqual([]);
    expect(snap.cycles).toEqual([]);
    expect(snap.habits).toEqual([]);
    expect(snap.sleepTargetHours).toBe(7.5);
  });

  it('reads sleep.settings.target_hours when present', () => {
    const store = makeStore({ sleep: { settings: { target_hours: 8 } } });
    const snap = takeUserDataSnapshot(store, NOW);
    expect(snap.sleepTargetHours).toBe(8);
  });

  it('drops undone actionLog entries from dumps', () => {
    const store = makeStore({
      shared: {
        actionLog: [
          { ts: 1, rawText: 'kept' },
          { ts: 2, rawText: 'dropped', undone: true },
        ],
      },
    });
    const snap = takeUserDataSnapshot(store, NOW);
    const texts = snap.dumps.map((d) => d.rawText ?? d.text);
    expect(texts).toContain('kept');
    expect(texts).not.toContain('dropped');
  });
});

// ─── per-correlator: luteal-spending ─────────────────────────────────────

describe('correlateLutealAndSpending', () => {
  function cycle(startTs: number, lengthDays = 28, periodDays = 5): CycleRecord {
    return {
      cycleStartTs: startTs,
      cycleLengthDays: lengthDays,
      periodLengthDays: periodDays,
    };
  }

  it('returns 0 sample on empty cycles', () => {
    const r = correlateLutealAndSpending([], [txn('2026-05-01', 10)], { now: NOW });
    expect(r.sampleSize).toBe(0);
    expect(r.copy).toBe('');
  });

  it('returns 0 sample on empty txns', () => {
    const r = correlateLutealAndSpending(
      [cycle(NOW - 60 * DAY_MS)],
      [],
      { now: NOW },
    );
    expect(r.sampleSize).toBe(0);
  });

  it('detects rising spend across luteal (positive ρ)', () => {
    // Single ~28d cycle starting 28d ago → luteal is days ~16-28.
    const cycleStart = NOW - 28 * DAY_MS;
    const cycles = [cycle(cycleStart, 28, 5)];
    // For each day in last 13 days, build a single luteal-phase txn whose
    // amount climbs linearly. Plus pad lookback with non-luteal txns at 0.
    const txns: FinanceRecord[] = [];
    for (let i = 15; i < 28; i++) {
      const dayTs = cycleStart + i * DAY_MS + 12 * 3600_000;
      txns.push(txn(dayKey(dayTs), 10 + i * 2));
    }
    const r = correlateLutealAndSpending(cycles, txns, {
      now: NOW,
      lookbackDays: 90,
      minSampleSize: 8, // relax for synthetic 13-day window
    });
    expect(r.sampleSize).toBeGreaterThanOrEqual(8);
    expect(r.correlation).toBeGreaterThan(0.30);
    expect(r.copy).toMatch(/spending climbs across luteal/);
  });

  it('emits banned-phrase-clean copy on detection', () => {
    const cycleStart = NOW - 28 * DAY_MS;
    const cycles = [cycle(cycleStart, 28, 5)];
    const txns: FinanceRecord[] = [];
    for (let i = 15; i < 28; i++) {
      const dayTs = cycleStart + i * DAY_MS + 12 * 3600_000;
      txns.push(txn(dayKey(dayTs), 10 + i * 2));
    }
    const r = correlateLutealAndSpending(cycles, txns, { now: NOW, minSampleSize: 8 });
    if (r.copy) {
      const hits = scanForBanned(r.copy);
      expect(hits).toEqual([]);
    }
  });

  it('respects sample size gate with tight lookback', () => {
    // With lookbackDays=3, we only inspect 3 days; any cycle starting
    // 28d ago has those 3 days inside luteal but n < 14 → no detection.
    const cycleStart = NOW - 28 * DAY_MS;
    const cycles = [cycle(cycleStart, 28, 5)];
    const txns: FinanceRecord[] = [
      txn(dayKey(cycleStart + 18 * DAY_MS), 20),
      txn(dayKey(cycleStart + 19 * DAY_MS), 25),
      txn(dayKey(cycleStart + 20 * DAY_MS), 30),
    ];
    const r = correlateLutealAndSpending(cycles, txns, {
      now: NOW,
      lookbackDays: 3,
      minSampleSize: 14,
    });
    expect(r.sampleSize).toBeLessThan(14);
    expect(r.copy).toBe('');
  });
});

// ─── per-correlator: workout-skip-mood ───────────────────────────────────

describe('correlateWorkoutSkipAndMood', () => {
  it('returns 0 sample with no habits', () => {
    const r = correlateWorkoutSkipAndMood(
      [],
      [{ ts: NOW - DAY_MS, rawText: 'overwhelmed today.' }],
      { now: NOW },
    );
    expect(r.sampleSize).toBe(0);
  });

  it('returns 0 sample with no dumps', () => {
    const r = correlateWorkoutSkipAndMood(
      [{ id: 'h1', name: 'gym', category: 'health', completions: [{ ts: NOW - DAY_MS }] }],
      [],
      { now: NOW },
    );
    expect(r.sampleSize).toBe(0);
  });

  it('returns 0 when habits cadence is too sparse to infer skip-eligibility', () => {
    const r = correlateWorkoutSkipAndMood(
      [{ id: 'h1', name: 'gym', category: 'health', completions: [{ ts: NOW - 60 * DAY_MS }] }],
      [{ ts: NOW - DAY_MS, rawText: 'meh.' }],
      { now: NOW },
    );
    expect(r.sampleSize).toBe(0);
  });

  it('runs cleanly on synthetic alternating skip/done pattern', () => {
    // Alternating-day workout pattern with paired dumps. Tests that the
    // correlator runs without throwing + returns a sensible shape; we
    // don't assert correlation direction (depends on weekday alignment).
    const completions: Array<{ ts: number }> = [];
    const dumps: Array<{ ts: number; rawText: string }> = [];
    for (let i = 1; i <= 20; i++) {
      const dayTs = NOW - i * DAY_MS;
      if (i % 2 === 0) {
        completions.push({ ts: dayTs + 9 * 3600_000 });
      }
      dumps.push({
        ts: dayTs + 20 * 3600_000,
        rawText: i % 3 === 0 ? 'overwhelmed. tired.' : 'okay.',
      });
    }
    const r = correlateWorkoutSkipAndMood(
      [{ id: 'h1', name: 'gym', category: 'health', completions }],
      dumps,
      { now: NOW, lookbackDays: 30, minSampleSize: 4, thresholdRho: 0.20 },
    );
    expect(typeof r.correlation).toBe('number');
    expect(r.sampleSize).toBeGreaterThanOrEqual(0);
  });

  it('emits banned-phrase-clean copy when detected', () => {
    // Force a deterministic positive case via a single class-balanced pair.
    const completions: Array<{ ts: number }> = [];
    const dumps: Array<{ ts: number; rawText: string }> = [];
    for (let i = 1; i <= 14; i++) {
      const dayTs = NOW - i * DAY_MS;
      if (i % 2 === 0) completions.push({ ts: dayTs + 9 * 3600_000 });
      const skip = i % 2 === 1;
      dumps.push({
        ts: dayTs + 18 * 3600_000,
        rawText: skip ? 'overwhelmed. tired.' : 'okay day.',
      });
    }
    const r = correlateWorkoutSkipAndMood(
      [{ id: 'h1', name: 'gym', category: 'health', completions }],
      dumps,
      { now: NOW, lookbackDays: 30, minSampleSize: 4, thresholdRho: 0.1 },
    );
    if (r.copy) {
      const hits = scanForBanned(r.copy);
      expect(hits).toEqual([]);
    }
  });
});

// ─── per-correlator: sleep-debt-habits ───────────────────────────────────

describe('correlateSleepDebtAndHabits', () => {
  it('returns 0 sample with no sleep records', () => {
    const r = correlateSleepDebtAndHabits(
      [],
      [{ id: 'h1', completions: [{ ts: NOW - DAY_MS }] }],
      { now: NOW },
    );
    expect(r.sampleSize).toBe(0);
  });

  it('returns 0 sample with < 3 active habits', () => {
    const sleepRecords: Array<{ night_of: string; tst_min: number }> = [];
    for (let i = 1; i <= 14; i++) {
      sleepRecords.push({
        night_of: dayKey(NOW - i * DAY_MS),
        tst_min: 6 * 60,
      });
    }
    const r = correlateSleepDebtAndHabits(sleepRecords, [
      { id: 'h1', completions: [{ ts: NOW - DAY_MS }] },
    ], { now: NOW });
    expect(r.sampleSize).toBe(0);
  });

  it('detects negative r on synthetic debt↔completion drop', () => {
    const sleepRecords: Array<{ night_of: string; tst_min: number }> = [];
    const habits = [
      { id: 'h1', created_at: NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
      { id: 'h2', created_at: NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
      { id: 'h3', created_at: NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
      { id: 'h4', created_at: NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
    ];
    // First half: 8h sleep, all 4 habits done. Second half: 4h sleep, 0 done.
    for (let i = 21; i >= 1; i--) {
      const dayTs = NOW - i * DAY_MS;
      const goodSleep = i > 10;
      sleepRecords.push({
        night_of: dayKey(dayTs),
        tst_min: goodSleep ? 8 * 60 : 4 * 60,
      });
      if (goodSleep) {
        for (const h of habits) h.completions.push({ ts: dayTs + 9 * 3600_000 });
      }
    }
    const r = correlateSleepDebtAndHabits(sleepRecords, habits, {
      now: NOW,
      lookbackDays: 21,
      minSampleSize: 10,
    });
    expect(r.sampleSize).toBeGreaterThanOrEqual(10);
    expect(r.correlation).toBeLessThan(-0.30);
    expect(r.copy).toMatch(/habit completion drops as sleep debt climbs/);
  });

  it('emits banned-phrase-clean copy when detected', () => {
    const sleepRecords: Array<{ night_of: string; tst_min: number }> = [];
    const habits = [
      { id: 'h1', created_at: NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
      { id: 'h2', created_at: NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
      { id: 'h3', created_at: NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
    ];
    for (let i = 21; i >= 1; i--) {
      const dayTs = NOW - i * DAY_MS;
      const goodSleep = i > 10;
      sleepRecords.push({ night_of: dayKey(dayTs), tst_min: goodSleep ? 8 * 60 : 4 * 60 });
      if (goodSleep) for (const h of habits) h.completions.push({ ts: dayTs + 9 * 3600_000 });
    }
    const r = correlateSleepDebtAndHabits(sleepRecords, habits, { now: NOW, minSampleSize: 10 });
    if (r.copy) {
      const hits = scanForBanned(r.copy);
      expect(hits).toEqual([]);
    }
  });

  it('handles sparse / missing data without throwing', () => {
    const r = correlateSleepDebtAndHabits(
      [{ night_of: '2026-05-01', tst_min: 0, is_skipped: true }],
      [{ id: 'h1', created_at: NOW - 30 * DAY_MS, completions: [] }],
      { now: NOW },
    );
    expect(r.sampleSize).toBe(0);
  });
});

// ─── per-correlator: evening-matcha-sleep ────────────────────────────────

describe('correlateEveningMatchaAndSleep', () => {
  it('returns 0 sample when there are no matcha entries', () => {
    const txns: FinanceRecord[] = [txn('2026-05-01', 5, 'starbucks')]; // coffee, not matcha
    const r = correlateEveningMatchaAndSleep(txns, [], [], { now: NOW });
    expect(r.sampleSize).toBe(0);
  });

  it('ignores morning matcha (< 5pm)', () => {
    const morningTs = new Date('2026-05-01T08:00:00').getTime();
    const dumps = [{ ts: morningTs, text: 'had matcha' }];
    const sleep = Array.from({ length: 20 }, (_, i) => ({
      night_of: dayKey(NOW - i * DAY_MS),
      bedtime: '23:00',
      wake_time: '07:00',
      onset_latency_min: 15,
      wakings_count: 0,
      wakings_total_min: 0,
      quality: 4,
      quality_text: null,
      notes: null,
      tokens: [],
      is_skipped: false,
      is_partial: false,
      is_disputed: false,
    }));
    const r = correlateEveningMatchaAndSleep([], dumps, sleep, { now: NOW });
    expect(r.sampleSize).toBe(0);
  });

  it('returns empty copy with no sleep records', () => {
    const dumps = [{ ts: new Date('2026-05-01T19:00:00').getTime(), text: 'matcha' }];
    const r = correlateEveningMatchaAndSleep([], dumps, [], { now: NOW });
    expect(r.copy).toBe('');
  });
});

// ─── per-correlator: water-focus ─────────────────────────────────────────

describe('correlateWaterAndFocus · PENDING', () => {
  it('always returns implemented=false', () => {
    const r = correlateWaterAndFocus(null, null, { now: NOW });
    expect(r.implemented).toBe(false);
    expect(r.correlation).toBeNull();
    expect(r.copy).toBe('');
  });

  it('carries a non-empty reason', () => {
    const r = correlateWaterAndFocus(null, null, { now: NOW });
    expect(r.reason).toBeTruthy();
    expect(r.reason.length).toBeGreaterThan(20);
  });
});

// ─── banned-phrase coverage on registry copy literals ─────────────────────

describe('correlation copy · banned-phrase compliance', () => {
  const SAMPLE_COPIES: string[] = [
    'spending climbs across luteal · avg $42/day · 2 cycles of data',
    'spending drops across luteal for you · 18 days of data',
    'days after skipped workouts read heavier in dumps · 12 days of data',
    'days after skipped workouts read lighter for you · 12 days of data',
    'habit completion drops as sleep debt climbs · 2 weeks of data',
    'habit completion holds steady as sleep debt climbs for you · 14 days of data',
    'evening matcha tracks with lower sleep quality for you · 2 weeks of data',
  ];

  it.each(SAMPLE_COPIES)('clean: %s', (copy) => {
    const hits = scanForBanned(copy);
    expect(hits).toEqual([]);
  });
});
