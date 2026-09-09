import { describe, it, expect } from 'vitest';
import {
  detectBoundaries,
  posteriorCycleLength,
  detectChangePoint,
  robustStats,
  predictNextPeriod,
  predictOvulation,
  fertileWindow,
  detectAdherenceIssue,
  computePhaseForDate,
  deriveCycleStats,
  correlateSymptom,
  detectHealthFlags,
  DEFAULT_PRIOR,
  DAY_MS,
  type CycleItem,
} from '../src/cycle';

// ─── fixtures ────────────────────────────────────────────────────────
const day = (n: number): number => n * DAY_MS;
const startEvents = (offsets: readonly number[]): CycleItem[] =>
  offsets.map((d) => ({ ts: day(d), action: 'started' as const }));

describe('detectBoundaries', () => {
  it('returns [] for empty / undefined / null input', () => {
    expect(detectBoundaries([])).toEqual([]);
    expect(detectBoundaries(undefined)).toEqual([]);
    expect(detectBoundaries(null)).toEqual([]);
  });

  it('builds a single open cycle from one start event', () => {
    const cycles = detectBoundaries(startEvents([100]));
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycleStartTs).toBe(day(100));
    expect(cycles[0].cycleEndTs).toBeUndefined();
  });

  it('closes each cycle with the next start ts and computes length', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84]));
    expect(cycles).toHaveLength(4);
    expect(cycles[0].cycleLengthDays).toBe(28);
    expect(cycles[1].cycleLengthDays).toBe(28);
    expect(cycles[3].cycleEndTs).toBeUndefined();
  });

  it('drops rage-tap starts under MIN_CYCLE_DAYS (10) apart', () => {
    const cycles = detectBoundaries(startEvents([0, 3, 28]));
    expect(cycles).toHaveLength(2);
    expect(cycles[0].cycleLengthDays).toBe(28);
  });

  it('records periodLengthDays when an `ended` event lands inside the cycle', () => {
    const items: CycleItem[] = [
      { ts: day(0), action: 'started' },
      { ts: day(5), action: 'ended' },
      { ts: day(28), action: 'started' },
    ];
    const cycles = detectBoundaries(items);
    expect(cycles[0].periodLengthDays).toBe(5);
  });
});

describe('posteriorCycleLength', () => {
  it('cold-starts to the population prior with n=0', () => {
    const p = posteriorCycleLength([]);
    expect(p.cold_start).toBe(true);
    expect(p.mean).toBe(DEFAULT_PRIOR.mean);
    expect(p.sd).toBe(DEFAULT_PRIOR.sd);
    expect(p.n_effective).toBe(0);
  });

  it('tightens sd as more cycles accrue', () => {
    const lens = [28, 28, 28, 28, 28, 28];
    const p = posteriorCycleLength(lens);
    expect(p.cold_start).toBe(false);
    expect(p.mean).toBeCloseTo(28, 0);
    // Posterior sd must be no wider than the prior sd for a steady-state user.
    expect(p.sd).toBeLessThan(DEFAULT_PRIOR.sd);
  });
});

describe('detectChangePoint', () => {
  it('returns no change for fewer than 9 cycles', () => {
    expect(detectChangePoint([28, 28, 28])).toEqual({ detected: false, cutoff: 0 });
  });

  it('detects a real shift from ~28d to ~38d', () => {
    const cp = detectChangePoint([28, 27, 28, 29, 28, 27, 38, 39, 37, 40, 38, 39]);
    expect(cp.detected).toBe(true);
    expect(cp.cutoff).toBe(6);
  });

  it('does NOT flag a stable history', () => {
    const cp = detectChangePoint([28, 27, 29, 28, 28, 27, 28, 29, 28, 27, 28, 28]);
    expect(cp.detected).toBe(false);
  });

  // #141 regression: when both windows have zero variance (perfectly regular
  // cycles) the pooled sd is 0, so `delta > 2*0` previously fired on ANY
  // nonzero shift. A 1-day jump must NOT register as a change-point.
  it('does NOT fire on a 1-day shift between zero-variance windows', () => {
    // older = [28×6], recent = [29×6] → delta 1, both variances 0.
    const cp = detectChangePoint([28, 28, 28, 28, 28, 28, 29, 29, 29, 29, 29, 29]);
    expect(cp.pooledSd).toBeGreaterThan(0); // floored, not 0
    expect(cp.detected).toBe(false);
  });

  it('still fires on a large shift between zero-variance windows', () => {
    // delta 10 still exceeds 2×floor(1.0) = 2.
    const cp = detectChangePoint([28, 28, 28, 28, 28, 28, 38, 38, 38, 38, 38, 38]);
    expect(cp.detected).toBe(true);
  });
});

describe('robustStats', () => {
  it('uses mean/sd when sd ≤ 7', () => {
    const r = robustStats([28, 27, 29, 28, 30, 28]);
    expect(r.useRobust).toBe(false);
    expect(r.center).toBeCloseTo(28.33, 1);
  });

  it('switches to median + MAD when sd > 7', () => {
    const r = robustStats([22, 28, 33, 26, 45, 30, 24, 38]);
    expect(r.useRobust).toBe(true);
    expect(r.center).toBeTypeOf('number');
    expect(r.spread).toBeGreaterThanOrEqual(2);
  });

  it('returns null center for empty input', () => {
    expect(robustStats([])).toEqual({ useRobust: false, center: null, spread: 0 });
  });
});

describe('predictNextPeriod', () => {
  it('cold-start returns the prior with no expectedStart', () => {
    const p = predictNextPeriod([]);
    expect(p.flags.cold_start).toBe(true);
    expect(p.tier).toBe('cold');
    expect(p.nextTs).toBeNull();
  });

  it('warm tier for a regular 28-day user with 2 cycles', () => {
    const p = predictNextPeriod(detectBoundaries(startEvents([0, 28, 56])));
    expect(p.tier).toBe('warm');
    expect(p.nextTs).toBeTypeOf('number');
    expect(p.fertile_window).not.toBeNull();
  });

  it('hot tier once n_effective ≥ 6 (~17 steady cycles under EWMA α=0.85)', () => {
    const offsets = Array.from({ length: 18 }, (_, i) => i * 28);
    const p = predictNextPeriod(detectBoundaries(startEvents(offsets)));
    expect(p.tier).toBe('hot');
  });

  it('irregular flag fires on a variable-cycle user', () => {
    const p = predictNextPeriod(
      detectBoundaries(startEvents([0, 22, 60, 88, 140, 168, 215, 260, 290, 340])),
    );
    expect(p.flags.irregular).toBe(true);
    expect(p.fertile_window).toBeNull();
  });
});

describe('predictOvulation', () => {
  it('returns null when there is no expectedStart', () => {
    const o = predictOvulation([]);
    expect(o.ovulationTs).toBeNull();
  });

  it('lands ~14 days before the next predicted period', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56]));
    const pred = predictNextPeriod(cycles);
    const ov = predictOvulation(cycles);
    expect(ov.ovulationTs).toBe(pred.nextTs! - 14 * DAY_MS);
  });
});

describe('fertileWindow', () => {
  it('returns null when cold-started', () => {
    expect(fertileWindow([])).toBeNull();
  });

  it('returns a [Date, Date] tuple when stable', () => {
    const win = fertileWindow(detectBoundaries(startEvents([0, 28, 56, 84])));
    expect(win).not.toBeNull();
    expect(win![0]).toBeInstanceOf(Date);
    expect(win![1]).toBeInstanceOf(Date);
    expect(win![1].getTime()).toBeGreaterThan(win![0].getTime());
  });
});

describe('detectAdherenceIssue', () => {
  it('no issue when fewer than 2 cycles', () => {
    expect(detectAdherenceIssue([{ cycleStartTs: 0 }])).toEqual({ hasIssue: false });
  });

  it('flags an outlier long cycle as a likely missed log', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 168]));
    const issue = detectAdherenceIssue(cycles);
    expect(issue.hasIssue).toBe(true);
    expect(issue.observedLength).toBeGreaterThan(70);
    expect(issue.typicalLength).toBeCloseTo(28, 0);
  });

  it('does not flag a steady-state user', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84]));
    expect(detectAdherenceIssue(cycles).hasIssue).toBe(false);
  });
});

describe('computePhaseForDate', () => {
  const cycles = detectBoundaries(startEvents([0, 28, 56, 84]));
  const lastStart = cycles[cycles.length - 1].cycleStartTs;

  it('returns unknown before the first cycle', () => {
    expect(computePhaseForDate(cycles, -1)).toBe('unknown');
  });

  it('returns menstrual on day 1–5', () => {
    expect(computePhaseForDate(cycles, lastStart + day(0))).toBe('menstrual');
    expect(computePhaseForDate(cycles, lastStart + day(4))).toBe('menstrual');
  });

  it('returns follicular in the middle of the cycle', () => {
    expect(computePhaseForDate(cycles, lastStart + day(7))).toBe('follicular');
  });

  it('returns ovulation window around day 11–15', () => {
    expect(computePhaseForDate(cycles, lastStart + day(13))).toBe('ovulation window');
  });

  it('returns luteal after the ovulation window', () => {
    expect(computePhaseForDate(cycles, lastStart + day(20))).toBe('luteal');
  });

  // #138 regression: without an upper day bound a stale last-cycle start makes
  // every future date read as 'luteal' forever. Beyond avgCycle (28) + margin
  // (7) = day 35, the phase is unknown (a missed/unlogged period).
  it('returns luteal just inside the upper bound', () => {
    expect(computePhaseForDate(cycles, lastStart + day(34))).toBe('luteal');
  });

  it('returns unknown well beyond avgCycle + margin', () => {
    expect(computePhaseForDate(cycles, lastStart + day(45))).toBe('unknown');
    expect(computePhaseForDate(cycles, lastStart + day(120))).toBe('unknown');
  });
});

describe('deriveCycleStats', () => {
  it('zero cycles → cycles_logged_count = 0', () => {
    const s = deriveCycleStats([]);
    expect(s.cycles_logged_count).toBe(0);
    expect(s.mean_length).toBeNull();
    expect(s.irregular_flag).toBe(false);
  });

  it('irregular_flag fires when sd > 7', () => {
    const cycles = detectBoundaries(startEvents([0, 22, 60, 88, 140, 168, 215, 260]));
    const s = deriveCycleStats(cycles);
    expect(s.irregular_flag).toBe(true);
  });

  it('irregular_flag stays false for a steady-state user', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112]));
    const s = deriveCycleStats(cycles);
    expect(s.irregular_flag).toBe(false);
  });
});

describe('correlateSymptom', () => {
  it('returns hasPattern=false when fewer than 3 cycles have the symptom', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56]));
    const events = [{ ts: day(2), text: 'cramps' }];
    expect(correlateSymptom(cycles, events, 'cramps')).toMatchObject({ hasPattern: false });
  });

  it('detects a luteal cluster with 4+ cycles of evidence', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112]));
    const events = [
      { ts: day(20), text: 'cramps' },
      { ts: day(48), text: 'cramps' },
      { ts: day(76), text: 'cramps' },
      { ts: day(104), text: 'cramps' },
    ];
    const result = correlateSymptom(cycles, events, 'cramps');
    expect(result.hasPattern).toBe(true);
    expect(result.phase).toBe('luteal');
    expect(result.cycles).toBeGreaterThanOrEqual(3);
  });
});

describe('detectHealthFlags', () => {
  it('returns [] for <3 closed cycles', () => {
    const cycles = detectBoundaries(startEvents([0, 28]));
    expect(detectHealthFlags(cycles, [])).toEqual([]);
  });

  it('raises long-cycles for 3+ consecutive ≥35d', () => {
    const cycles = detectBoundaries(startEvents([0, 38, 76, 114, 152]));
    const flags = detectHealthFlags(cycles, []);
    expect(flags.some((f) => f.id === 'long-cycles')).toBe(true);
  });

  it('raises short-cycles for 3+ consecutive <21d', () => {
    const cycles = detectBoundaries(startEvents([0, 18, 36, 54, 72]));
    const flags = detectHealthFlags(cycles, []);
    expect(flags.some((f) => f.id === 'short-cycles')).toBe(true);
  });

  it('72h edit cooldown suppresses a flag when ANY cycle in the run was recently edited', () => {
    const cycles = detectBoundaries(startEvents([0, 38, 76, 114, 152]));
    const now = day(200);
    // detectHealthFlags only operates on closed cycles; pick the last CLOSED one.
    const closed = cycles.filter((c) => typeof c.cycleLengthDays === 'number');
    const lastEdited = {
      [closed[closed.length - 1].cycleStartTs]: now - 3600 * 1000,
    };
    const flags = detectHealthFlags(cycles, [], now, lastEdited);
    expect(flags.some((f) => f.id === 'long-cycles')).toBe(false);
  });

  it('every flag includes at least one source URL', () => {
    const cycles = detectBoundaries(startEvents([0, 38, 76, 114, 152]));
    const flags = detectHealthFlags(cycles, []);
    for (const f of flags) {
      expect(f.sources.length).toBeGreaterThan(0);
      expect(f.sources[0]).toMatch(/^https:\/\//);
    }
  });
});
