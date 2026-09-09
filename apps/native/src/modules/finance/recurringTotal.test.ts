import { describe, it, expect } from 'vitest';
import { recurringMonthlyTotal } from './recurringTotal';

describe('recurringMonthlyTotal', () => {
  it('is null when nothing has an amount', () => {
    expect(recurringMonthlyTotal([])).toBeNull();
    expect(
      recurringMonthlyTotal([{ amount: null, currency: 'TRY', cadence: 'monthly' }]),
    ).toBeNull();
  });

  it('sums monthly amounts in one currency', () => {
    expect(
      recurringMonthlyTotal([
        { amount: 18000, currency: 'TRY', cadence: 'monthly' },
        { amount: 130, currency: 'TRY', cadence: 'monthly' },
        { amount: 80, currency: 'TRY', cadence: 'monthly' },
      ]),
    ).toEqual({ amount: 18210, currency: 'TRY' });
  });

  it('normalises yearly and weekly to monthly-equivalent', () => {
    // 1200/yr = 100/mo
    expect(recurringMonthlyTotal([{ amount: 1200, currency: 'USD', cadence: 'yearly' }])).toEqual({
      amount: 100,
      currency: 'USD',
    });
    // 12/wk = 52/mo
    expect(recurringMonthlyTotal([{ amount: 12, currency: 'USD', cadence: 'weekly' }])).toEqual({
      amount: 52,
      currency: 'USD',
    });
  });

  it('treats unknown cadence as monthly', () => {
    expect(recurringMonthlyTotal([{ amount: 50, currency: 'TRY', cadence: null }])).toEqual({
      amount: 50,
      currency: 'TRY',
    });
  });

  it('never mixes currencies — returns the largest currency total', () => {
    const r = recurringMonthlyTotal([
      { amount: 18000, currency: 'TRY', cadence: 'monthly' },
      { amount: 10, currency: 'USD', cadence: 'monthly' },
    ]);
    expect(r).toEqual({ amount: 18000, currency: 'TRY' });
  });

  it('sums null-currency rows under their own bucket', () => {
    expect(recurringMonthlyTotal([{ amount: 200, currency: null, cadence: 'monthly' }])).toEqual({
      amount: 200,
      currency: null,
    });
  });
});
