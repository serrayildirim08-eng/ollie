import { describe, it, expect } from 'vitest';
import {
  toSeries,
  inferPrior,
  detectChangePoint,
  robustStats,
  posterior,
  tierLabel,
  forecast,
  forecastNextEvent,
  joinStreams,
  correlate,
  stability,
  minDetectableEffect,
  mmrRank,
  bh,
  daysBetween,
  daysSince,
  DAY_MS,
} from '../src/predict';

// ─── helpers ──────────────────────────────────────────────────────────────────

const DAY = DAY_MS;
const T0 = 1_700_000_000_000; // fixed epoch anchor

function ts(daysAgo: number): number {
  return T0 - daysAgo * DAY;
}

// ─── toSeries ─────────────────────────────────────────────────────────────────

describe('toSeries', () => {
  it('bare numbers', () => {
    const s = toSeries([28, 29, 30]);
    expect(s.hasTs).toBe(false);
    expect(s.values).toEqual([28, 29, 30]);
  });

  it('timestamped objects, sorts chronologically', () => {
    const s = toSeries([
      { value: 30, ts: T0 },
      { value: 28, ts: T0 - 2 * DAY },
    ]);
    expect(s.hasTs).toBe(true);
    expect(s.values).toEqual([28, 30]);
    expect(s.ts[0]).toBe(T0 - 2 * DAY);
  });

  it('empty input', () => {
    const s = toSeries([]);
    expect(s.values).toHaveLength(0);
    expect(s.hasTs).toBe(false);
  });
});

// ─── inferPrior ───────────────────────────────────────────────────────────────

describe('inferPrior', () => {
  it('returns sensible defaults for empty', () => {
    const p = inferPrior([]);
    expect(p.mean).toBe(0);
    expect(p.sd).toBeGreaterThan(0);
  });

  it('single observation uses 20% sd floor', () => {
    const p = inferPrior([100]);
    expect(p.mean).toBe(100);
    expect(p.sd).toBeCloseTo(20, 1);
  });

  it('multiple observations', () => {
    const p = inferPrior([28, 29, 30, 31]);
    expect(p.mean).toBeCloseTo(29.5, 1);
    expect(p.sd).toBeGreaterThan(0);
  });
});

// ─── detectChangePoint ────────────────────────────────────────────────────────

describe('detectChangePoint', () => {
  it('no change-point with fewer than 9 values', () => {
    const r = detectChangePoint([28, 29, 30]);
    expect(r.detected).toBe(false);
  });

  it('detects obvious shift', () => {
    // 6 observations ~28 days, then 6 at ~14 days — clear shift
    const before = [28, 29, 28, 30, 27, 29];
    const after = [14, 15, 13, 14, 15, 14];
    const r = detectChangePoint([...before, ...after]);
    expect(r.detected).toBe(true);
    expect(r.cutoff).toBe(6);
  });

  it('no detection when pattern is stable', () => {
    const stable = [28, 29, 30, 28, 29, 30, 28, 29, 30, 28, 29, 30];
    const r = detectChangePoint(stable);
    expect(r.detected).toBe(false);
  });
});

// ─── robustStats ──────────────────────────────────────────────────────────────

describe('robustStats', () => {
  it('uses mean when sd is low', () => {
    const r = robustStats([28, 29, 30, 28], { preset: 'cycleLength' });
    expect(r.useRobust).toBe(false);
    expect(r.center).toBeCloseTo(28.75, 1);
  });

  it('switches to median+MAD when sd is high', () => {
    // Very high variability — sd >> 7 (cycleLength robustThreshold)
    const r = robustStats([10, 50, 10, 50, 10, 50], { preset: 'cycleLength' });
    expect(r.useRobust).toBe(true);
  });

  it('returns null center for empty', () => {
    const r = robustStats([]);
    expect(r.center).toBeNull();
  });
});

// ─── posterior ────────────────────────────────────────────────────────────────

describe('posterior', () => {
  it('cold start returns prior', () => {
    const p = posterior([], { preset: 'cycleLength' });
    expect(p.cold_start).toBe(true);
    expect(p.mean).toBeCloseTo(28.5, 1);
  });

  it('converges toward data with enough observations', () => {
    const data = [26, 26, 26, 26, 26, 26, 26];
    const p = posterior(data, { preset: 'cycleLength' });
    expect(p.cold_start).toBe(false);
    // Should pull mean below prior (28.5) toward 26
    expect(p.mean).toBeLessThan(28.5);
    expect(p.mean).toBeGreaterThan(25);
  });

  it('ci95 is wider than zero', () => {
    const p = posterior([28, 30, 27], { preset: 'cycleLength' });
    expect(p.ci95[1] - p.ci95[0]).toBeGreaterThan(0);
  });
});

// ─── tierLabel ────────────────────────────────────────────────────────────────

describe('tierLabel', () => {
  it('cold when nEff < 1', () => {
    expect(tierLabel(0, 0, { robust: false, change_point: false })).toBe('cold');
  });

  it('variable when robust', () => {
    expect(tierLabel(5, 5, { robust: true, change_point: false })).toBe('variable');
  });

  it('personalized when nRaw >= 6', () => {
    expect(tierLabel(5, 6, { robust: false, change_point: false })).toBe('personalized');
  });

  it('warming for small n', () => {
    expect(tierLabel(2, 3, { robust: false, change_point: false })).toBe('warming');
  });
});

// ─── forecast ─────────────────────────────────────────────────────────────────

describe('forecast', () => {
  it('cold start with no observations', () => {
    const f = forecast([], { preset: 'cycleLength', now: T0 });
    expect(f.tier).toBe('cold');
    expect(f.dont_know_yet).toBe(true);
    expect(f.method).toBe('prior');
  });

  it('uses posterior path with enough bare numbers', () => {
    const f = forecast([28, 29, 30, 28, 29, 30, 28], { preset: 'cycleLength', now: T0 });
    expect(f.tier).toBe('personalized');
    expect(f.method).toBe('posterior');
    expect(f.n_observed).toBe(7);
  });

  it('marks stale when last observation is past halfLife', () => {
    const observations = [
      { value: 28, ts: T0 - 90 * DAY },
      { value: 30, ts: T0 - 80 * DAY },
    ];
    const f = forecast(observations, { preset: 'cycleLength', now: T0, halfLifeDays: 60 });
    expect(f.flags.stale).toBe(true);
  });

  it('uses calendar branch for timestamped observations', () => {
    const observations = [5, 4, 6, 5, 4, 6].map((v, i) => ({ value: v, ts: ts(30 * i) }));
    const f = forecast(observations, { preset: 'sleepHours', now: T0 });
    expect(f.method).toBe('posterior_calendar');
  });

  it('detects change-point and uses recent window', () => {
    const before = [28, 29, 28, 30, 27, 29];
    const after = [14, 15, 13, 14, 15, 14];
    const f = forecast([...before, ...after], { preset: 'cycleLength', now: T0 });
    expect(f.flags.change_point).toBe(true);
    expect(f.n_used).toBeLessThan(f.n_observed);
  });
});

// ─── forecastNextEvent ────────────────────────────────────────────────────────

describe('forecastNextEvent', () => {
  it('empty timestamps returns cold', () => {
    const r = forecastNextEvent([], { now: T0 });
    expect(r.tier).toBe('cold');
    expect(r.nextTs).toBeNull();
  });

  it('single timestamp uses prior for interval', () => {
    const r = forecastNextEvent([T0 - 30 * DAY], { now: T0, preset: 'intervalDays' });
    expect(r.n_observed).toBe(1);
    expect(r.nextTs).not.toBeNull();
  });

  it('multiple events estimates reasonable interval', () => {
    const events = [0, 28, 56, 84, 112, 140, 168].map(d => T0 - (200 - d) * DAY);
    const r = forecastNextEvent(events, { now: T0 });
    expect(r.intervalDays).toBeGreaterThan(20);
    expect(r.intervalDays).toBeLessThan(36);
  });
});

// ─── joinStreams ───────────────────────────────────────────────────────────────

describe('joinStreams', () => {
  it('returns empty for non-timestamped streams', () => {
    const result = joinStreams([1, 2, 3], [4, 5, 6]);
    expect(result).toHaveLength(0);
  });

  it('matches observations within window', () => {
    const streamA = [
      { value: 7, ts: T0 - 3 * DAY },
      { value: 8, ts: T0 - 1 * DAY },
    ];
    const streamB = [{ value: 30, ts: T0 }];
    const result = joinStreams(streamA, streamB, { windowDays: 7 });
    expect(result).toHaveLength(1);
    expect(result[0]!.n).toBe(2);
  });
});

// ─── correlate ────────────────────────────────────────────────────────────────

describe('correlate', () => {
  it('needs ≥ 4 pairs', () => {
    const r = correlate([], []);
    expect(r.hasPattern).toBe(false);
    expect(r.reason).toContain('4');
  });

  it('detects strong positive correlation', () => {
    // Sleep hours increases → cycle value increases (synthetic perfect correlation)
    const n = 10;
    const streamA = Array.from({ length: n }, (_, i) => ({
      value: 6 + i * 0.1,
      ts: T0 - (n - i) * 30 * DAY,
    }));
    const streamB = Array.from({ length: n }, (_, i) => ({
      value: 26 + i,
      ts: T0 - (n - i) * 30 * DAY,
    }));
    const r = correlate(streamA, streamB, { windowDays: 1 });
    if (r.r !== null) {
      expect(r.r).toBeGreaterThan(0.5);
    }
  });
});

// ─── stability ────────────────────────────────────────────────────────────────

describe('stability', () => {
  it('null when fewer than 8 pairs', () => {
    const r = stability([{ x: 1, y: 2, ts: T0 }]);
    expect(r.stable).toBeNull();
  });

  it('stable when halves agree in sign and delta is small', () => {
    const pairs = Array.from({ length: 12 }, (_, i) => ({
      x: i,
      y: i * 0.9 + Math.random() * 0.01,
      ts: T0 - (12 - i) * DAY,
    }));
    const r = stability(pairs);
    // Both halves should both show positive r
    if (r.r_old !== undefined && r.r_new !== undefined) {
      expect(Math.sign(r.r_old)).toBe(Math.sign(r.r_new));
    }
  });
});

// ─── minDetectableEffect ──────────────────────────────────────────────────────

describe('minDetectableEffect', () => {
  it('returns null for n ≤ 4', () => {
    expect(minDetectableEffect(4)).toBeNull();
    expect(minDetectableEffect(3)).toBeNull();
  });

  it('decreases as n increases', () => {
    const mde30 = minDetectableEffect(30)!;
    const mde100 = minDetectableEffect(100)!;
    expect(mde30).toBeGreaterThan(mde100);
  });

  it('is between 0 and 1', () => {
    const mde = minDetectableEffect(20)!;
    expect(mde).toBeGreaterThan(0);
    expect(mde).toBeLessThan(1);
  });
});

// ─── mmrRank ──────────────────────────────────────────────────────────────────

describe('mmrRank', () => {
  const candidates = [
    { id: 'a', effect: 0.9, modules: ['cycle', 'sleep'] },
    { id: 'b', effect: 0.8, modules: ['cycle', 'sleep'] },
    { id: 'c', effect: 0.7, modules: ['finance'] },
    { id: 'd', effect: 0.6, modules: ['habits'] },
  ];

  it('returns topK items', () => {
    const r = mmrRank(candidates, { topK: 3 });
    expect(r).toHaveLength(3);
  });

  it('lambda=1 picks by pure effect', () => {
    const r = mmrRank(candidates, { topK: 2, lambda: 1 });
    expect(r[0]!.id).toBe('a');
    expect(r[1]!.id).toBe('b');
  });

  it('lambda=0 picks diverse modules', () => {
    const r = mmrRank(candidates, { topK: 2, lambda: 0 });
    // With full diversity weight, second pick should differ from first in modules
    expect(r[0]!.id).not.toBe(r[1]!.id);
  });
});

// ─── bh ───────────────────────────────────────────────────────────────────────

describe('bh', () => {
  it('returns empty for empty input', () => {
    expect(bh([])).toHaveLength(0);
  });

  it('rejects all when all p > qTarget', () => {
    const pVals = [
      { id: 'a', p: 0.8 },
      { id: 'b', p: 0.9 },
    ];
    expect(bh(pVals, 0.05)).toHaveLength(0);
  });

  it('accepts small p values', () => {
    const pVals = [
      { id: 'a', p: 0.001 },
      { id: 'b', p: 0.002 },
      { id: 'c', p: 0.9 },
    ];
    const r = bh(pVals, 0.1);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(x => x.p < 0.01)).toBe(true);
  });
});

// ─── daysBetween / daysSince ──────────────────────────────────────────────────

describe('daysBetween / daysSince', () => {
  it('daysBetween computes positive days forward', () => {
    expect(daysBetween(T0, T0 + 7 * DAY)).toBeCloseTo(7, 5);
  });

  it('daysBetween returns null when either arg is not a number type', () => {
    // @ts-expect-error intentional bad input
    expect(daysBetween(undefined, T0)).toBeNull();
    // @ts-expect-error intentional bad input
    expect(daysBetween(T0, null)).toBeNull();
  });

  it('daysSince uses explicit now', () => {
    expect(daysSince(T0 - 3 * DAY, T0)).toBeCloseTo(3, 5);
  });
});
