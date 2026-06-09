import { describe, it, expect } from 'vitest';
import {
  sum,
  mean,
  median,
  variance,
  stdev,
  sampleSd,
  mad,
  ranks,
  pearson,
  spearman,
  mulberry32,
} from '../src/stats';

describe('stats · median (even-length bug fix, item #2)', () => {
  it('averages the two middle elements for even-length arrays', () => {
    // The old finance/reports.ts + workout-skip-mood.ts copies returned
    // sorted[floor(n/2)] — the upper-middle element. For [1, 3] that gave
    // 3; the correct median is 2.
    expect(median([1, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([4, 2, 1, 3])).toBe(2.5); // unsorted input
    expect(median([10, 20, 30, 40, 50, 60])).toBe(35);
  });

  it('returns the middle element for odd-length arrays', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('returns 0 for an empty array', () => {
    expect(median([])).toBe(0);
  });
});

describe('stats · central tendency', () => {
  it('sum and mean', () => {
    expect(sum([1, 2, 3, 4])).toBe(10);
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
  });
});

describe('stats · dispersion', () => {
  it('population variance and stdev', () => {
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4, 5);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
    expect(variance([])).toBe(0);
  });

  it('sample standard deviation (Bessel-corrected)', () => {
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sampleSd([5])).toBe(0);
  });

  it('scaled MAD with even-length input', () => {
    // deviations from median(2.5) of [1,2,3,4] are [1.5,0.5,0.5,1.5];
    // their median is 1.0 → scaled MAD = 1.4826.
    expect(mad([1, 2, 3, 4])).toBeCloseTo(1.4826, 4);
    expect(mad([1, 2, 3, 4], 1)).toBeCloseTo(1.0, 5);
  });
});

describe('stats · correlation', () => {
  it('ranks assigns mid-ranks for ties', () => {
    expect(ranks([10, 20, 30])).toEqual([1, 2, 3]);
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('pearson returns 1 / -1 / 0', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 5);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0); // zero variance
  });

  it('spearman is tie-aware', () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 5);
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 5);
  });
});

describe('stats · mulberry32', () => {
  it('is deterministic for a fixed seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });
});
