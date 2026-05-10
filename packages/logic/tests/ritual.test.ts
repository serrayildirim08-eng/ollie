import { describe, it, expect } from 'vitest';
import { ritual } from '../src/index';

const {
  extractHoursFromLog,
  circularKDE,
  findPeaks,
  fallbackForChronotype,
  inferRitualPeaks,
  currentPeakMatch,
} = ritual;

const tsAt = (hour: number, minute = 0): number =>
  new Date(2026, 4, 1, hour, minute).getTime();

describe('extractHoursFromLog', () => {
  it('drops non-numeric ts', () => {
    const log = [{ ts: tsAt(5, 30) }, { ts: NaN as unknown as number }];
    const hours = extractHoursFromLog(log);
    expect(hours).toHaveLength(1);
    expect(hours[0]).toBeCloseTo(5.5, 1);
    expect(extractHoursFromLog(null)).toEqual([]);
  });

  it('returns decimal hours-of-day', () => {
    const log = [{ ts: tsAt(8, 30) }, { ts: tsAt(21) }];
    const hours = extractHoursFromLog(log);
    expect(hours[0]).toBeCloseTo(8.5, 1);
    expect(hours[1]).toBeCloseTo(21, 1);
  });
});

describe('circularKDE', () => {
  it('returns a length-24 array', () => {
    const density = circularKDE([8, 9, 10]);
    expect(density).toHaveLength(24);
  });

  it('peaks near the input hours', () => {
    const density = circularKDE([8, 8, 8, 9, 9, 21, 21, 22]);
    const morningPeak = Math.max(density[7], density[8], density[9]);
    const noonPeak = density[12];
    expect(morningPeak).toBeGreaterThan(noonPeak);
  });

  it('returns all zeros for empty input', () => {
    const density = circularKDE([]);
    expect(density.every((v) => v === 0)).toBe(true);
  });
});

describe('findPeaks', () => {
  it('returns [] for invalid input', () => {
    expect(findPeaks([])).toEqual([]);
    expect(findPeaks([1, 2, 3] as unknown as number[])).toEqual([]);
  });

  it('finds local maxima above the prominence floor', () => {
    const density = new Array(24).fill(0.01) as number[];
    density[8] = 1.0;
    density[20] = 0.8;
    const peaks = findPeaks(density);
    expect(peaks[0].hour).toBe(8);
    expect(peaks[1]?.hour).toBe(20);
  });

  it('caps at 3 peaks', () => {
    const density = new Array(24).fill(0.01) as number[];
    for (const h of [3, 7, 11, 15, 19, 23]) density[h] = 0.5;
    const peaks = findPeaks(density);
    expect(peaks.length).toBeLessThanOrEqual(3);
  });
});

describe('fallbackForChronotype', () => {
  it('returns earlier hours for an early chronotype', () => {
    const peaks = fallbackForChronotype({ category: 'early bird' });
    expect(peaks[0].hour).toBeLessThan(10);
  });

  it('returns later hours for a late chronotype', () => {
    const peaks = fallbackForChronotype({ category: 'late riser' });
    expect(peaks[peaks.length - 1].hour).toBeGreaterThanOrEqual(22);
  });

  it('uses a balanced default for unknown chronotype', () => {
    expect(fallbackForChronotype(null)).toEqual([
      { hour: 8, strength: 0 },
      { hour: 21, strength: 0 },
    ]);
  });
});

describe('inferRitualPeaks', () => {
  it('returns fallback when fewer than 14 samples', () => {
    const result = inferRitualPeaks(
      Array.from({ length: 10 }, () => ({ ts: tsAt(9) })),
      null,
    );
    expect(result.source).toBe('fallback');
    expect(result.n).toBe(10);
  });

  it('returns learned peaks with 14+ clean samples', () => {
    const log = Array.from({ length: 20 }, (_, i) => ({
      ts: tsAt(i < 10 ? 8 : 21, (i * 3) % 60),
    }));
    const result = inferRitualPeaks(log, null);
    expect(result.source).toBe('learned');
    const peakHours = result.peaks.map((p) => p.hour);
    // Should land near 8 and 21 (within 2 hours either way given KDE width)
    expect(peakHours.some((h) => Math.abs(h - 8) <= 2)).toBe(true);
    expect(peakHours.some((h) => Math.abs(h - 21) <= 2)).toBe(true);
  });
});

describe('currentPeakMatch', () => {
  const peaks = [{ hour: 8, strength: 1 }, { hour: 21, strength: 0.8 }];

  it('matches when within the window', () => {
    expect(currentPeakMatch(peaks, tsAt(8, 15))?.hour).toBe(8);
    expect(currentPeakMatch(peaks, tsAt(20, 30), 1)?.hour).toBe(21);
  });

  it('returns null when outside any window', () => {
    expect(currentPeakMatch(peaks, tsAt(13))).toBeNull();
  });

  it('respects the circular boundary (23:30 → 0)', () => {
    const midnightPeak = [{ hour: 0, strength: 1 }];
    expect(currentPeakMatch(midnightPeak, tsAt(23, 30), 1)?.hour).toBe(0);
  });
});
