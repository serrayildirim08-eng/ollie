import { describe, it, expect } from 'vitest';
import { products } from '../src/index';
import { detectBoundaries, DAY_MS, type CycleItem } from '../src/cycle';

const { forecast, computeDailyUse, deriveInventory, PRODUCT_FALLBACK } = products;

const day = (n: number): number => n * DAY_MS;
const startEvents = (offsets: readonly number[]): CycleItem[] =>
  offsets.map((d) => ({ ts: day(d), action: 'started' as const }));

describe('products.forecast', () => {
  it('falls back to population averages with no product-use history', () => {
    const f = forecast([], []);
    expect(f.source).toBe('fallback');
    expect(f.totals).toEqual(PRODUCT_FALLBACK);
  });

  it('learns from history when product-use is present', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56]));
    const uses = [
      { ts: day(1), type: 'tampon', count: 18 },
      { ts: day(29), type: 'tampon', count: 22 },
      { ts: day(57), type: 'tampon', count: 20 },
    ];
    const f = forecast(cycles, uses);
    expect(f.source).toBe('learned');
    expect(f.totals.tampon).toBeGreaterThanOrEqual(18);
    expect(f.totals.tampon).toBeLessThanOrEqual(22);
  });

  it('drops product-use events outside any cycle window', () => {
    const cycles = detectBoundaries(startEvents([100, 128, 156]));
    const uses = [{ ts: day(0), type: 'tampon', count: 99 }];
    const f = forecast(cycles, uses);
    expect(f.source).toBe('fallback'); // single use outside any cycle → no learning
  });
});

describe('products.computeDailyUse', () => {
  it('returns {} for empty inputs', () => {
    expect(computeDailyUse([], [])).toEqual({});
    expect(computeDailyUse(detectBoundaries(startEvents([0, 28])), [])).toEqual({});
  });

  it('averages total use over total days across cycles', () => {
    // 3 cycle records: 2 closed (28d each) + 1 open (28d fallback) = 84 day denominator
    const cycles = detectBoundaries(startEvents([0, 28, 56]));
    const uses = [
      { ts: day(1), type: 'tampon', count: 42 },
      { ts: day(29), type: 'tampon', count: 42 },
    ];
    expect(computeDailyUse(cycles, uses)).toEqual({ tampon: 1.0 });
  });
});

describe('products.deriveInventory', () => {
  it('passes through a non-empty stored inventory unchanged', () => {
    const stored = {
      tampon: { count: 10, capacity: 20, lastRestockedAt: 0 },
    };
    expect(deriveInventory([], stored)).toBe(stored);
  });

  it('builds a fresh inventory from use events when nothing is stored', () => {
    const uses = [
      { ts: day(1), type: 'tampon', count: 20 },
      { ts: day(2), type: 'pad', count: 10 },
      { ts: day(3), type: 'tampon', count: 30 }, // later restock — wins for that type
    ];
    const inv = deriveInventory(uses, null);
    expect(inv.tampon.count).toBe(30);
    expect(inv.tampon.lastRestockedAt).toBe(day(3));
    expect(inv.pad.count).toBe(10);
  });
});
