/**
 * @ollie/logic · finance · D3 pattern-detection tests
 */

import { describe, it, expect } from 'vitest';
import {
  detectSubscriptions,
  adhdTaxRunningTotal,
  detectCycleSpendingPattern,
} from '../src/finance/pattern-detection';
import type { FinanceRecord } from '../src/finance/types';

const DAY = 86_400_000;

function tx(date: string, amount: number, merchant: string, extra: Partial<FinanceRecord> = {}): FinanceRecord {
  return {
    id: `${date}-${merchant}-${amount}`,
    event_date: date,
    amount,
    currency: 'USD',
    merchant,
    merchant_normalized: merchant.toLowerCase(),
    direction: 'out',
    ...extra,
  };
}

function addDays(iso: string, n: number): string {
  const t = Date.parse(iso) + n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}

describe('finance/pattern-detection · subscription', () => {
  it('detects monthly Canva at $20 for 3 months', () => {
    const recs: FinanceRecord[] = [
      tx('2026-01-15', 20, 'Canva'),
      tx('2026-02-14', 20, 'Canva'),
      tx('2026-03-15', 20, 'Canva'),
    ];
    const out = detectSubscriptions(recs);
    expect(out).toHaveLength(1);
    expect(out[0].merchant).toBe('canva');
    expect(out[0].amount).toBe(20);
    expect(out[0].cadence).toBe('monthly');
    expect(out[0].occurrence_count).toBe(3);
    expect(out[0].copy).toMatch(/canva.*\$20\.00 monthly for 3 months/i);
  });

  it('detects with ±5% amount drift', () => {
    const recs: FinanceRecord[] = [
      tx('2026-01-15', 19.99, 'Spotify'),
      tx('2026-02-14', 20.50, 'Spotify'),  // 2.5% drift
      tx('2026-03-15', 20.00, 'Spotify'),
    ];
    expect(detectSubscriptions(recs)).toHaveLength(1);
  });

  it('rejects when occurrences < 3', () => {
    const recs: FinanceRecord[] = [
      tx('2026-01-15', 20, 'Canva'),
      tx('2026-02-14', 20, 'Canva'),
    ];
    expect(detectSubscriptions(recs)).toHaveLength(0);
  });

  it('rejects when intervals are inconsistent (not 28-32d, 88-94d, or 360-370d)', () => {
    const recs: FinanceRecord[] = [
      tx('2026-01-01', 20, 'Random'),
      tx('2026-01-15', 20, 'Random'),  // 14 days
      tx('2026-02-15', 20, 'Random'),  // 31 days
    ];
    expect(detectSubscriptions(recs)).toHaveLength(0);
  });

  it('detects quarterly cadence (88-94 days)', () => {
    const recs: FinanceRecord[] = [
      tx('2026-01-01', 100, 'AnnualPro'),
      tx('2026-04-01', 100, 'AnnualPro'),   // 90 days
      tx('2026-07-01', 100, 'AnnualPro'),   // 91 days
    ];
    const out = detectSubscriptions(recs);
    expect(out).toHaveLength(1);
    expect(out[0].cadence).toBe('quarterly');
  });

  it('skips bills (handled by existing recurring detector)', () => {
    const recs: FinanceRecord[] = [
      tx('2026-01-01', 1200, 'Landlord', { kind: 'bill' }),
      tx('2026-02-01', 1200, 'Landlord', { kind: 'bill' }),
      tx('2026-03-01', 1200, 'Landlord', { kind: 'bill' }),
    ];
    expect(detectSubscriptions(recs)).toHaveLength(0);
  });
});

describe('finance/pattern-detection · adhd tax', () => {
  const now = Date.parse('2026-04-01T12:00:00Z');

  it('sums impulse-tagged transactions in last 30 days', () => {
    const recs: FinanceRecord[] = [
      tx('2026-03-25', 50, 'Shop', { is_adhd_tax: true }),
      tx('2026-03-15', 80, 'Shop', { is_adhd_tax: true }),
      tx('2026-03-15', 30, 'Other'), // not tagged → ignored
    ];
    const r = adhdTaxRunningTotal(recs, now);
    expect(r.total_30d).toBe(130);
    expect(r.count_30d).toBe(2);
    expect(r.copy).toMatch(/\$130\.00 this month on impulse/);
  });

  it('drops transactions older than 30 days', () => {
    const recs: FinanceRecord[] = [
      tx('2026-01-01', 999, 'Shop', { is_adhd_tax: true }),
    ];
    const r = adhdTaxRunningTotal(recs, now);
    expect(r.total_30d).toBe(0);
    expect(r.count_30d).toBe(0);
  });

  it('emits empty copy when count_30d=0', () => {
    expect(adhdTaxRunningTotal([], now).copy).toBe('');
  });
});

describe('finance/pattern-detection · cycle-correlated spending', () => {
  it('detects elevation across ≥3 cycles', () => {
    // 4 cycles, 28 days each. Follicular days ~6-13, luteal ~14-27.
    // Add ~$10/day follicular, ~$30/day luteal across all 4 cycles.
    const recs: FinanceRecord[] = [];
    const startTs = Date.parse('2026-01-01');
    const cycles: Array<{ startTs: number; endTs: number; lengthDays: number }> = [];
    for (let c = 0; c < 4; c++) {
      const cStart = startTs + c * 28 * DAY;
      const cEnd = cStart + 28 * DAY;
      cycles.push({ startTs: cStart, endTs: cEnd, lengthDays: 28 });
      for (let d = 6; d < 14; d++) {
        const day = new Date(cStart + d * DAY).toISOString().slice(0, 10);
        recs.push(tx(day, 10, 'Shop', { id: `${c}-f-${d}` }));
      }
      for (let d = 14; d < 28; d++) {
        const day = new Date(cStart + d * DAY).toISOString().slice(0, 10);
        recs.push(tx(day, 30, 'Shop', { id: `${c}-l-${d}` }));
      }
    }
    const card = detectCycleSpendingPattern(recs, cycles);
    expect(card).not.toBeNull();
    expect(card!.cycle_count).toBeGreaterThanOrEqual(3);
    expect(card!.luteal_ratio).toBeGreaterThanOrEqual(1.2);
    expect(card!.copy).toMatch(/luteal phase has been ~\d+% higher across \d+ cycles/);
    expect(card!.copy).toMatch(/pattern, not medical/);
  });

  it('rejects when < 3 cycles available', () => {
    expect(detectCycleSpendingPattern([], [])).toBeNull();
    const cycles = [
      { startTs: 0, endTs: 28 * DAY, lengthDays: 28 },
      { startTs: 28 * DAY, endTs: 56 * DAY, lengthDays: 28 },
    ];
    expect(detectCycleSpendingPattern([], cycles)).toBeNull();
  });

  it('rejects when luteal is not consistently elevated', () => {
    const recs: FinanceRecord[] = [];
    const startTs = Date.parse('2026-01-01');
    const cycles = [];
    for (let c = 0; c < 4; c++) {
      const cStart = startTs + c * 28 * DAY;
      cycles.push({ startTs: cStart, endTs: cStart + 28 * DAY, lengthDays: 28 });
      // Flat ~$15/day all cycle.
      for (let d = 6; d < 28; d++) {
        const day = new Date(cStart + d * DAY).toISOString().slice(0, 10);
        recs.push(tx(day, 15, 'Shop', { id: `${c}-${d}` }));
      }
    }
    expect(detectCycleSpendingPattern(recs, cycles)).toBeNull();
  });
});
