/**
 * Medication cabinet · low-stock logic tests.
 *
 * Low-stock is BOTH signals with the manual flag winning:
 *   - manual lowFlag override (always low when set)
 *   - auto count-down when qty + a daily schedule are known
 *   - manual-only degrade when no qty entered
 */

import { describe, it, expect } from 'vitest';
import {
  isLow,
  daysOfSupply,
  decrementQty,
  LOW_DAYS_THRESHOLD,
  LOW_QTY_FLOOR,
} from './lowStock';

describe('isLow — manual override', () => {
  it('lowFlag true → always low, even with plenty of stock', () => {
    expect(isLow({ lowFlag: true, qty: 100, dosesPerDay: 1 })).toBe(true);
  });

  it('lowFlag true → low even with no qty (manual-only)', () => {
    expect(isLow({ lowFlag: true })).toBe(true);
  });
});

describe('isLow — manual-only (no qty)', () => {
  it('no qty + flag false → not low (degrade to manual-only)', () => {
    expect(isLow({ lowFlag: false })).toBe(false);
    expect(isLow({ lowFlag: false, qty: null })).toBe(false);
    expect(isLow({ lowFlag: false, qty: undefined, dosesPerDay: 2 })).toBe(false);
  });
});

describe('isLow — auto count-down', () => {
  it('qty + schedule, plenty of days left → not low', () => {
    // 30 pills, 1/day → 30 days left, well above the 5-day threshold.
    expect(isLow({ lowFlag: false, qty: 30, dosesPerDay: 1 })).toBe(false);
  });

  it('qty + schedule, few days left → low', () => {
    // 5 pills, 1/day → exactly 5 days left → low (≤ threshold).
    expect(isLow({ lowFlag: false, qty: LOW_DAYS_THRESHOLD, dosesPerDay: 1 })).toBe(true);
    // 8 pills, 2/day → 4 days left → low.
    expect(isLow({ lowFlag: false, qty: 8, dosesPerDay: 2 })).toBe(true);
  });

  it('very low absolute qty → low even with no schedule', () => {
    expect(isLow({ lowFlag: false, qty: LOW_QTY_FLOOR, dosesPerDay: 0 })).toBe(true);
    expect(isLow({ lowFlag: false, qty: 1 })).toBe(true);
    expect(isLow({ lowFlag: false, qty: 0 })).toBe(true);
  });

  it('moderate qty, no schedule → not auto-low (manual governs)', () => {
    // 10 pills, no schedule → can't project days; above the absolute floor.
    expect(isLow({ lowFlag: false, qty: 10, dosesPerDay: 0 })).toBe(false);
  });
});

describe('daysOfSupply', () => {
  it('computes floor(qty / perDay)', () => {
    expect(daysOfSupply({ lowFlag: false, qty: 30, dosesPerDay: 1 })).toBe(30);
    expect(daysOfSupply({ lowFlag: false, qty: 9, dosesPerDay: 2 })).toBe(4);
  });

  it('null when qty or schedule unknown', () => {
    expect(daysOfSupply({ lowFlag: false, qty: null, dosesPerDay: 1 })).toBeNull();
    expect(daysOfSupply({ lowFlag: false, qty: 30, dosesPerDay: 0 })).toBeNull();
  });
});

describe('decrementQty', () => {
  it('decrements a known qty, floored at 0', () => {
    expect(decrementQty(10)).toBe(9);
    expect(decrementQty(1)).toBe(0);
    expect(decrementQty(0)).toBe(0);
  });

  it('no-op (null) when qty unknown — manual-only items do not auto-count', () => {
    expect(decrementQty(null)).toBeNull();
    expect(decrementQty(undefined)).toBeNull();
  });
});
