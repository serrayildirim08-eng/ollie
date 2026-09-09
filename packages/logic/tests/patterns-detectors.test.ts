import { describe, it, expect } from 'vitest';
import {
  detectSymptomInPhase,
  detectSleepCycleLag,
  detectFinanceCycleSpend,
  detectPatterns,
  phaseForDay,
  isIrregular,
  closedCycles,
} from '../src/patterns';
import { detectBoundaries, DAY_MS, type CycleItem } from '../src/cycle';

const day = (n: number): number => n * DAY_MS;
const startEvents = (offsets: readonly number[]): CycleItem[] =>
  offsets.map((d) => ({ ts: day(d), action: 'started' as const }));

describe('phaseForDay', () => {
  it('maps days to phases over a 28-day cycle', () => {
    expect(phaseForDay(1, 28)).toBe('menstrual');
    expect(phaseForDay(5, 28)).toBe('menstrual');
    expect(phaseForDay(8, 28)).toBe('follicular');
    expect(phaseForDay(13, 28)).toBe('ovulation window');
    expect(phaseForDay(20, 28)).toBe('luteal');
  });

  // ── #51 CANONICAL boundary table ──────────────────────────────────────
  // ONE definition for every detector. Boundaries are pinned EXACTLY so the
  // three former copies (which disagreed on `<` vs `<=` and `-17` vs `-18`)
  // can never re-diverge. For cycleLen=28, bleed=5:
  //   menstrual  : day <= 5
  //   follicular : 6 .. 9        (day < cycleLen-18 == 10)
  //   ovulation  : 10 .. 15      (cycleLen-18 .. cycleLen-13, inclusive)
  //   luteal     : day >= 16
  it('pins the inequality edges for a 28-day / 5-day-bleed cycle', () => {
    const table: Array<[number, string]> = [
      [5, 'menstrual'],          // last bleed day
      [6, 'follicular'],         // first non-bleed
      [9, 'follicular'],         // last follicular (cycleLen-18-1)
      [10, 'ovulation window'],  // ov start  == cycleLen-18 (inclusive)
      [15, 'ovulation window'],  // ov end    == cycleLen-13 (inclusive)
      [16, 'luteal'],            // first luteal
      [28, 'luteal'],
    ];
    for (const [d, expected] of table) {
      expect(phaseForDay(d, 28, 5)).toBe(expected);
    }
  });

  it('honors an explicit bleed length', () => {
    // bleed=7 → days 6,7 are now menstrual (were follicular at default bleed=5)
    expect(phaseForDay(6, 28, 7)).toBe('menstrual');
    expect(phaseForDay(7, 28, 7)).toBe('menstrual');
    expect(phaseForDay(8, 28, 7)).toBe('follicular');
  });

  it('clamps degenerate short cycles (window would collide with bleed)', () => {
    // cycleLen=21 → ovStart=3, ovEnd=8; with bleed=5 ovStart(3) <= bleed(5)
    // so the ovulation window is dropped: follicular up to ovEnd, then luteal.
    expect(phaseForDay(5, 21, 5)).toBe('menstrual');
    expect(phaseForDay(6, 21, 5)).toBe('follicular');
    expect(phaseForDay(8, 21, 5)).toBe('follicular');
    expect(phaseForDay(9, 21, 5)).toBe('luteal');
  });

  it('defaults bleed length to 5 when omitted', () => {
    expect(phaseForDay(5, 28)).toBe('menstrual');
    expect(phaseForDay(6, 28)).toBe('follicular');
  });
});

describe('closedCycles + isIrregular', () => {
  it('filters out the open last cycle', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84]));
    expect(closedCycles(cycles)).toHaveLength(3);
  });

  it('flags irregular when sd > 7', () => {
    const irregular = detectBoundaries(startEvents([0, 22, 60, 88, 140, 168])).filter(
      (c) => typeof c.cycleLengthDays === 'number',
    );
    expect(isIrregular(irregular as Parameters<typeof isIrregular>[0])).toBe(true);
  });
});

describe('detectSymptomInPhase', () => {
  it('returns null for < 3 closed cycles', () => {
    const cycles = detectBoundaries(startEvents([0, 28]));
    expect(detectSymptomInPhase(cycles, [], 'cramps')).toBeNull();
  });

  it('returns null when irregular', () => {
    const cycles = detectBoundaries(startEvents([0, 22, 60, 88, 140, 168]));
    const events = [
      { ts: day(20), text: 'cramps' },
      { ts: day(58), text: 'cramps' },
      { ts: day(86), text: 'cramps' },
    ];
    expect(detectSymptomInPhase(cycles, events, 'cramps')).toBeNull();
  });

  it('detects a luteal cluster across 4+ cycles', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112, 140]));
    const events = [
      { ts: day(20), text: 'cramps' },
      { ts: day(48), text: 'cramps' },
      { ts: day(76), text: 'cramps' },
      { ts: day(104), text: 'cramps' },
      { ts: day(132), text: 'cramps' },
    ];
    const result = detectSymptomInPhase(cycles, events, 'cramps');
    expect(result?.type).toBe('symptom_in_phase');
    expect(result?.meta.phase).toBe('luteal');
    expect(result?.cycles).toBeGreaterThanOrEqual(3);
    expect(result?.copy).toContain('luteal');
  });
});

describe('detectSleepCycleLag', () => {
  it('returns null without enough cycles', () => {
    const cycles = detectBoundaries(startEvents([0, 28]));
    expect(detectSleepCycleLag(cycles, [])).toBeNull();
  });

  it('surfaces a cycle-wide pre-period sleep drop', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112]));
    const sleeps: { ts: number; tstMinutes: number }[] = [];
    // Each cycle: 5 sleeps of 420 min mid-cycle, 3 sleeps of 360 min in last 5 days
    for (const startDay of [0, 28, 56, 84]) {
      for (let d = 5; d < 18; d += 3) sleeps.push({ ts: day(startDay + d), tstMinutes: 420 });
      for (let d = 24; d <= 27; d++) sleeps.push({ ts: day(startDay + d), tstMinutes: 360 });
    }
    const result = detectSleepCycleLag(cycles, sleeps);
    expect(result?.type).toBe('sleep_cycle_lag');
    expect(result?.copy).toMatch(/sleep drops/);
  });
});

describe('detectFinanceCycleSpend', () => {
  it('returns null when txn count is below the floor', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84]));
    expect(detectFinanceCycleSpend(cycles, [])).toBeNull();
  });

  it('surfaces a category with > 40% rate shift between phases', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112]));
    const txns = [];
    // High spend in luteal (days 20-27) for "food" category
    for (const startDay of [0, 28, 56, 84]) {
      for (let d = 20; d <= 27; d++) {
        txns.push({ ts: day(startDay + d), amount: 50, category: 'food' });
      }
      // Lower follicular (days 6-10) for same category
      for (let d = 6; d <= 8; d++) {
        txns.push({ ts: day(startDay + d), amount: 10, category: 'food' });
      }
    }
    const result = detectFinanceCycleSpend(cycles, txns);
    expect(result?.type).toBe('finance_cycle_spend');
    expect(result?.meta.category).toBe('food');
    expect(result?.meta.higherPhase).toBe('luteal');
  });
});

describe('detectPatterns (integration)', () => {
  it('returns [] for empty input', () => {
    expect(detectPatterns({})).toEqual([]);
  });

  it('returns multiple detectors when their data is present', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112, 140]));
    const symptomEvents = [
      { ts: day(20), text: 'cramps' },
      { ts: day(48), text: 'cramps' },
      { ts: day(76), text: 'cramps' },
      { ts: day(104), text: 'cramps' },
      { ts: day(132), text: 'cramps' },
    ];
    const out = detectPatterns({ cycles, symptomEvents });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].type).toBe('symptom_in_phase');
  });
});
