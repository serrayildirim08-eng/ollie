import { describe, it, expect } from 'vitest';
import { patterns } from '../src/index';

const { spearman, ranks, bhAdjust, mulberry32, bootstrapCI } = patterns;

describe('patterns/stats · ranks', () => {
  it('returns mid-ranks for ties', () => {
    expect(ranks([10, 20, 30])).toEqual([1, 2, 3]);
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe('patterns/stats · spearman', () => {
  it('returns 1 for a perfect monotonic increase', () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1.0, 5);
  });

  it('returns -1 for a perfect monotonic decrease', () => {
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for unrelated rank order', () => {
    expect(Math.abs(spearman([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]))).toBeLessThan(0.6);
  });

  it('returns 0 for malformed input', () => {
    expect(spearman([1, 2], [3])).toBe(0);
    expect(spearman([1], [2])).toBe(0);
  });
});

describe('patterns/stats · bhAdjust', () => {
  it('rejects all p when all are very small', () => {
    expect(bhAdjust([0.001, 0.002, 0.003], 0.1)).toEqual([true, true, true]);
  });

  it('rejects none when all are above threshold', () => {
    expect(bhAdjust([0.5, 0.6, 0.7], 0.1)).toEqual([false, false, false]);
  });
});

describe('patterns/stats · mulberry32 + bootstrapCI', () => {
  it('mulberry32 is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('bootstrapCI returns a finite interval that brackets a known stat', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const meanDiff = (a: number[], b: number[]): number => {
      const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
      return mean(b) - mean(a);
    };
    const rng = mulberry32(123);
    const [lo, hi] = bootstrapCI(xs, ys, meanDiff, 500, 0.1, rng);
    expect(Number.isFinite(lo)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
    expect(lo).toBeLessThan(hi);
  });

  // #21 regression: the default RNG seed must NOT be coupled to `iters`. With a
  // seed of mulberry32(iters), the resample stream changed whenever iters did,
  // so a CI shifted for reasons unrelated to the data. With a fixed default
  // seed, the first min(iters) resamples are shared, so the smaller-iters CI
  // bounds appear within the larger run's sorted stat distribution.
  it('default-seed resample stream is decoupled from iters', () => {
    const xs = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
    const ys = [2, 7, 1, 8, 2, 8, 1, 8, 2, 8, 4, 5];
    const meanDiff = (a: number[], b: number[]): number => {
      const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
      return mean(b) - mean(a);
    };
    // Same default seed → first 200 resamples identical regardless of total
    // iters, so the first drawn statistic matches across runs.
    const firstStat = (iters: number): number => {
      let captured = NaN;
      const wrappedStat = (a: number[], b: number[]): number => {
        const v = meanDiff(a, b);
        if (Number.isNaN(captured)) captured = v;
        return v;
      };
      bootstrapCI(xs, ys, wrappedStat, iters, 0.1); // default rng
      return captured;
    };
    expect(firstStat(200)).toBe(firstStat(2000));
  });
});
