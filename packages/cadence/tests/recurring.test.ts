/**
 * @ollie/cadence · recurring detection tests.
 *
 * Covers the five cases the finance brief calls out + a couple of edges
 * (multiple groups in one pass, amount aggregation).
 */

import { describe, it, expect } from 'vitest';
import {
  detectRecurring,
  classifyCycle,
  type RecurringEvent,
} from '../src/recurring';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

/** Build events for a single key at the listed day-offsets (days BEFORE T0). */
function evs(
  key: string,
  daysAgo: number[],
  amount?: number | null,
): RecurringEvent[] {
  return daysAgo.map((d) => ({
    key,
    ts: T0 - d * DAY,
    amount: amount ?? undefined,
  }));
}

// ─── single one-off — should NOT surface ────────────────────────────────

describe('detectRecurring — single one-off', () => {
  it('yields nothing for a one-event group', () => {
    const out = detectRecurring(evs('sephora', [3], 40));
    expect(out).toEqual([]);
  });
});

// ─── 2 monthly events — should surface ──────────────────────────────────

describe('detectRecurring — 2 monthly events', () => {
  it('emits a monthly pattern at 2 samples with median amount', () => {
    // 30d apart → squarely inside the monthly band (30 ± 5).
    const out = detectRecurring(evs('rent', [30, 0], 2400));
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.key).toBe('rent');
    expect(p.cycle).toBe('monthly');
    // 2 samples + cv=0 → 'observed' (stable needs ≥5).
    expect(p.confidence).toBe('observed');
    expect(p.sampleSize).toBe(2);
    expect(p.medianAmount).toBe(2400);
    expect(p.medianIntervalMs).toBe(30 * DAY);
  });
});

// ─── 3 monthly with jitter — should surface as monthly ──────────────────

describe('detectRecurring — 3 monthly events with jitter', () => {
  it('classifies as monthly when median lands inside the ±5d band', () => {
    // gaps: 28d, 32d → median = 30d (still monthly).
    const out = detectRecurring(evs('netflix', [60, 32, 0], 15.99));
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.cycle).toBe('monthly');
    expect(p.sampleSize).toBe(3);
    expect(p.medianAmount).toBe(15.99);
  });
});

// ─── 2 weekly events — should surface as weekly ─────────────────────────

describe('detectRecurring — 2 weekly events', () => {
  it('classifies a 7-day gap as weekly', () => {
    const out = detectRecurring(evs('gym', [7, 0], 0));
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.cycle).toBe('weekly');
    expect(p.sampleSize).toBe(2);
    expect(p.medianIntervalMs).toBe(7 * DAY);
  });
});

// ─── irregular pattern — should NOT surface ─────────────────────────────

describe('detectRecurring — irregular pattern', () => {
  it('emits nothing when intervals are bursty and far from any cycle', () => {
    // gaps: 1d, 60d, 1d, 60d, 1d → median = 1d (cv extreme).
    // 1d isn't in any band; even if confidence held, classifyCycle returns null.
    const out = detectRecurring(evs('coffee', [123, 122, 62, 61, 1, 0]));
    expect(out).toEqual([]);
  });

  it('emits nothing for moderate-irregular medians that miss every band', () => {
    // gaps: 14d, 14d, 14d → median 14d (bi-weekly).
    // 14d is outside weekly (5-9d), monthly (25-35d), yearly (350-380d).
    const out = detectRecurring(evs('paycheck', [42, 28, 14, 0]));
    expect(out).toEqual([]);
  });
});

// ─── multi-group: detects each independently ────────────────────────────

describe('detectRecurring — multiple groups in one pass', () => {
  it('detects each key independently and sorts by lastTs DESC', () => {
    const all = [
      ...evs('rent', [30, 0], 2400),         // monthly, lastTs = T0
      ...evs('netflix', [62, 31, 1], 15.99), // monthly, lastTs = T0 - 1d
      ...evs('one-off', [5], 12),            // skipped
    ];
    const out = detectRecurring(all);
    expect(out.map((p) => p.key)).toEqual(['rent', 'netflix']);
    expect(out[0]!.cycle).toBe('monthly');
    expect(out[1]!.cycle).toBe('monthly');
  });
});

// ─── classifyCycle direct ───────────────────────────────────────────────

describe('classifyCycle', () => {
  it('classifies edge cases inside / outside bands', () => {
    expect(classifyCycle(7 * DAY)).toBe('weekly');
    expect(classifyCycle(9 * DAY)).toBe('weekly');
    expect(classifyCycle(10 * DAY)).toBeNull();        // outside weekly band
    expect(classifyCycle(30 * DAY)).toBe('monthly');
    expect(classifyCycle(35 * DAY)).toBe('monthly');
    expect(classifyCycle(36 * DAY)).toBeNull();        // outside monthly band
    expect(classifyCycle(365 * DAY)).toBe('yearly');
    expect(classifyCycle(0)).toBeNull();
    expect(classifyCycle(-1)).toBeNull();
    expect(classifyCycle(Number.NaN)).toBeNull();
  });
});

// ─── amount aggregation ─────────────────────────────────────────────────

describe('detectRecurring — amount aggregation', () => {
  it('takes median of amounts, ignoring nulls', () => {
    const events: RecurringEvent[] = [
      { key: 'spotify', ts: T0 - 60 * DAY, amount: 9.99 },
      { key: 'spotify', ts: T0 - 30 * DAY, amount: null },
      { key: 'spotify', ts: T0, amount: 11.99 },
    ];
    const out = detectRecurring(events);
    expect(out).toHaveLength(1);
    // median of [9.99, 11.99] = 10.99
    expect(out[0]!.medianAmount).toBeCloseTo(10.99, 2);
  });

  it('returns null medianAmount when no amount was supplied', () => {
    const out = detectRecurring(evs('walk', [14, 7, 0]));
    expect(out).toHaveLength(1);
    expect(out[0]!.medianAmount).toBeNull();
  });
});
