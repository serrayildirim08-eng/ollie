/**
 * @ollie/logic · finance · savings tracker (F1 + F2) tests
 *
 * Constitutional rules:
 *   - frame: "saved" never "you saved" / "ollie saved you"
 *   - math: elapsed_months × monthly_amount (not annual projection)
 *   - re-subscribe: keep historic count
 */

import { describe, it, expect } from 'vitest';
import {
  computeSavings,
  monthsBetween,
  buildSavingsCardCopy,
  buildMonthlyDigestCopy,
  savingsThisMonth,
  cancellationsAccruedThisMonth,
} from '../src/finance/savings';
import type { Cancellation } from '../src/finance/savings';

function iso(s: string): number { return Date.parse(s); }

const now = iso('2026-05-11T12:00:00Z');

describe('monthsBetween', () => {
  it('zero when end < start', () => {
    expect(monthsBetween(iso('2026-03-15'), iso('2026-03-14'))).toBe(0);
  });
  it('zero for sub-month gap', () => {
    expect(monthsBetween(iso('2026-01-15'), iso('2026-01-31'))).toBe(0);
  });
  it('counts whole month gap', () => {
    expect(monthsBetween(iso('2026-01-15'), iso('2026-02-15'))).toBe(1);
  });
  it('not until day-of-month matches', () => {
    expect(monthsBetween(iso('2026-01-15'), iso('2026-02-14'))).toBe(0);
  });
  it('multi-month', () => {
    expect(monthsBetween(iso('2026-01-15'), iso('2026-04-15'))).toBe(3);
  });
});

describe('computeSavings · single cancellation', () => {
  it('records 3 months × $20 for Canva cancelled in Feb', () => {
    const cancellations: Cancellation[] = [
      { id: 'sub-canva', merchant: 'canva', monthly_amount: 20, cancelled_at: iso('2026-02-10'), surfaced_by_ollie: true },
    ];
    const t = computeSavings(cancellations, now);
    expect(t.entries[0].months_elapsed).toBe(3); // Feb10→Mar10, Apr10, May10
    expect(t.entries[0].saved_amount).toBe(60);
    expect(t.year_total).toBe(60);
    expect(t.all_time_total).toBe(60);
  });
});

describe('computeSavings · multiple cancellations', () => {
  const cancellations: Cancellation[] = [
    { id: 'sub-canva',   merchant: 'canva',          monthly_amount: 20,  cancelled_at: iso('2026-02-10'), surfaced_by_ollie: true },
    { id: 'sub-notion',  merchant: 'notion',         monthly_amount: 16,  cancelled_at: iso('2026-03-10'), surfaced_by_ollie: true },
    { id: 'sub-spotify', merchant: 'spotify family', monthly_amount: 17,  cancelled_at: iso('2025-12-10'), surfaced_by_ollie: true },
  ];

  it('returns correct year total and per-entry amounts', () => {
    const t = computeSavings(cancellations, now);
    // canva: 3 mo × 20 = 60 (all in current year)
    // notion: 2 mo × 16 = 32 (all in current year)
    // spotify: cancelled 2025-12-10 → 5 mo elapsed total. In current
    //   year (jan 1 → may 11), months elapsed = 4 (Jan 10, Feb 10, Mar
    //   10, Apr 10) → 4 × 17 = 68
    expect(t.year_total).toBe(60 + 32 + 68);
    // all-time spotify: 5 × 17 = 85
    expect(t.all_time_total).toBe(60 + 32 + 85);
  });

  it('sorts entries by saved_amount desc', () => {
    const t = computeSavings(cancellations, now);
    expect(t.entries[0].cancellation.merchant).toBe('spotify family');
    expect(t.entries[1].cancellation.merchant).toBe('canva');
    expect(t.entries[2].cancellation.merchant).toBe('notion');
  });
});

describe('computeSavings · re-subscribed (Decision #14 rule)', () => {
  it('keeps the historic entry; clips accrual at resubscribed_at', () => {
    const cancellations: Cancellation[] = [
      {
        id: 'sub-canva',
        merchant: 'canva',
        monthly_amount: 20,
        cancelled_at: iso('2026-02-10'),
        resubscribed_at: iso('2026-04-10'), // 2 months in, then re-subbed
        surfaced_by_ollie: true,
      },
    ];
    const t = computeSavings(cancellations, now);
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0].months_elapsed).toBe(2);
    expect(t.entries[0].saved_amount).toBe(40);
  });
});

describe('buildSavingsCardCopy · constitutional voice', () => {
  it('NEVER says "you saved" or "ollie saved you"', () => {
    const cancellations: Cancellation[] = [
      { id: 'a', merchant: 'canva', monthly_amount: 20, cancelled_at: iso('2026-02-10'), surfaced_by_ollie: true },
      { id: 'b', merchant: 'notion', monthly_amount: 16, cancelled_at: iso('2026-03-10'), surfaced_by_ollie: true },
    ];
    const copy = buildSavingsCardCopy(computeSavings(cancellations, now));
    expect(copy).not.toMatch(/you\s+saved/i);
    expect(copy).not.toMatch(/ollie\s+saved/i);
    expect(copy.toLowerCase()).toContain('saved this year');
  });

  it('returns empty for zero savings', () => {
    expect(buildSavingsCardCopy(computeSavings([], now))).toBe('');
  });
});

describe('buildMonthlyDigestCopy · F2', () => {
  it('frames passively + cites this month and year', () => {
    const cancellations: Cancellation[] = [
      { id: 'a', merchant: 'notion', monthly_amount: 16, cancelled_at: iso('2026-03-10'), surfaced_by_ollie: true },
      { id: 'b', merchant: 'spotify family', monthly_amount: 17, cancelled_at: iso('2025-12-10'), surfaced_by_ollie: true },
    ];
    const totals = computeSavings(cancellations, now);
    const monthCancels = cancellationsAccruedThisMonth(cancellations, now);
    const monthly = savingsThisMonth(cancellations, now);
    const copy = buildMonthlyDigestCopy(totals, monthCancels, monthly);
    expect(copy).toMatch(/this month: \$/);
    expect(copy).toMatch(/total this year: \$/);
    expect(copy).not.toMatch(/you\s+saved/i);
    expect(copy).not.toMatch(/!/);
  });
});

describe('savingsThisMonth', () => {
  it('counts only cancellations whose accrual fell inside the current calendar month', () => {
    const cancellations: Cancellation[] = [
      { id: 'a', merchant: 'canva',  monthly_amount: 20, cancelled_at: iso('2026-04-10'), surfaced_by_ollie: true },
      { id: 'b', merchant: 'notion', monthly_amount: 16, cancelled_at: iso('2026-02-10'), surfaced_by_ollie: true },
    ];
    // now = 2026-05-11. canva: 2026-04-10 → 2026-05-10 = 1 full month
    // boundary, only the month-window slice from May 1 → May 11 — not a
    // full month, so 0. notion is older, 0 contribution in May window.
    expect(savingsThisMonth(cancellations, now)).toBe(0);
  });
});
