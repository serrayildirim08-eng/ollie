/**
 * money-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `finance.*` slices into the v2 view-model. These tests verify the
 * bridge, including the empty / cold-start branches the v2 face depends
 * on for its three states.
 */
import { describe, it, expect } from 'vitest';
import type { FinanceRecord } from '@ollie/logic/finance';
import {
  fmtMoney,
  fmtCompact,
  fmtWhen,
  isMasked,
  nextDueDate,
  upcomingBillRows,
  safeToSpendVM,
  incomeVM,
  savingsVM,
  adhdTaxVM,
  subscriptionAudit,
  dormantCount,
  taxSetAsideVM,
  hasAnyFinanceData,
  type FinanceSlices,
  type StoredBill,
  type StoredSub,
  type StoredGoal,
} from './selectors';

const NOW = new Date('2026-05-18T12:00:00Z').getTime();
const DAY = 86_400_000;

function emptySlices(): FinanceSlices {
  return {
    records: [],
    bills: [],
    subscriptions: [],
    goals: [],
    adhd_tax: [],
    settings: {},
    privacy: { enabled: false, unlockedUntil: 0 },
    safeToSpend: null,
  };
}

function incomeRecord(date: string, amount: number): FinanceRecord {
  return {
    event_date: date,
    amount,
    currency: 'USD',
    merchant: 'client',
    merchant_normalized: 'client',
    direction: 'in',
  };
}

describe('format helpers', () => {
  it('fmtMoney rounds and groups', () => {
    expect(fmtMoney(1199.6)).toBe('1,200');
    expect(fmtMoney(null)).toBe('0');
  });

  it('fmtCompact uses k above 1000', () => {
    expect(fmtCompact(3200)).toEqual({ value: '3.2', unit: 'k' });
    expect(fmtCompact(850)).toEqual({ value: '850', unit: '' });
    expect(fmtCompact(2000)).toEqual({ value: '2', unit: 'k' });
  });

  it('fmtWhen labels relative dates calmly', () => {
    expect(fmtWhen(NOW, NOW)).toBe('today');
    expect(fmtWhen(NOW + DAY, NOW)).toBe('tomorrow');
    expect(fmtWhen(NOW + 30 * DAY, NOW)).toMatch(/jun \d+/);
  });
});

describe('isMasked', () => {
  it('false when privacy is off', () => {
    expect(isMasked({ enabled: false, unlockedUntil: 0 }, NOW)).toBe(false);
  });
  it('true when enabled and the unlock window has passed', () => {
    expect(isMasked({ enabled: true, unlockedUntil: NOW - 1 }, NOW)).toBe(true);
  });
  it('false while still inside the unlock window', () => {
    expect(isMasked({ enabled: true, unlockedUntil: NOW + 1000 }, NOW)).toBe(false);
  });
});

describe('nextDueDate', () => {
  it('returns a future timestamp for a monthly bill', () => {
    const bill: StoredBill = {
      id: 'b1',
      name: 'rent',
      amount: 1200,
      frequency: 'monthly',
      dueDay: 1,
      ts: NOW,
    };
    expect(nextDueDate(bill, NOW)).toBeGreaterThanOrEqual(NOW - DAY);
  });
});

describe('upcomingBillRows', () => {
  it('sorts bills soonest-first', () => {
    const bills: StoredBill[] = [
      { id: 'b1', name: 'internet', amount: 60, frequency: 'monthly', dueDay: 28, ts: NOW },
      { id: 'b2', name: 'rent', amount: 1200, frequency: 'monthly', dueDay: 20, ts: NOW },
    ];
    const rows = upcomingBillRows(bills, NOW);
    expect(rows[0].dueAt).toBeLessThanOrEqual(rows[1].dueAt);
  });
  it('empty in → empty out', () => {
    expect(upcomingBillRows([], NOW)).toEqual([]);
  });
});

describe('safeToSpendVM', () => {
  it('reports cold-start with no data', () => {
    const vm = safeToSpendVM(emptySlices(), NOW);
    expect(vm.coldStart).toBe(true);
    expect(vm.amount).toBeNull();
  });
  it('uses an orchestrator-derived band when present', () => {
    const slices = emptySlices();
    slices.safeToSpend = {
      central: 312,
      sigma: 20,
      band: [280, 344],
      horizonDays: 11,
      cold_start: false,
      contributing_patterns: [],
    };
    const vm = safeToSpendVM(slices, NOW);
    expect(vm.coldStart).toBe(false);
    expect(vm.amount).toBe(312);
    expect(vm.horizonDays).toBe(11);
  });
});

describe('incomeVM', () => {
  it('no income → no signal', () => {
    const vm = incomeVM([], NOW);
    expect(vm.haveSignal).toBe(false);
    expect(vm.monthly).toBe(0);
  });
  it('buckets income into the last 6 months and tracks last landed', () => {
    const records = [
      incomeRecord('2026-03-10', 3000),
      incomeRecord('2026-04-12', 2800),
      incomeRecord('2026-05-12', 1150),
    ];
    const vm = incomeVM(records, NOW);
    expect(vm.haveSignal).toBe(true);
    expect(vm.band).toHaveLength(6);
    expect(vm.lastLanded?.amount).toBe(1150);
    // 2026-05-12T00:00 → 2026-05-18T12:00 is 6.5d, rounds to 7
    expect(vm.lastLanded?.daysAgo).toBe(7);
  });
});

describe('savingsVM', () => {
  it('no goal → haveGoal false', () => {
    expect(savingsVM([], [], NOW).haveGoal).toBe(false);
  });
  it('reports progress for the first goal', () => {
    const goals: StoredGoal[] = [
      { id: 'g1', name: 'a trip', target: 1000, saved: 340, ts: NOW },
    ];
    const vm = savingsVM(goals, [], NOW);
    expect(vm.haveGoal).toBe(true);
    expect(vm.saved).toBe(340);
    expect(vm.target).toBe(1000);
    expect(vm.fill).toBeCloseTo(0.34);
  });
});

describe('adhdTaxVM', () => {
  it('totals this-month adhd-tax records', () => {
    const records: FinanceRecord[] = [
      {
        event_date: '2026-05-10',
        amount: 29,
        currency: 'USD',
        merchant: 'late fee',
        merchant_normalized: 'late fee',
        direction: 'out',
        is_adhd_tax: true,
        notes: 'a late fee · credit card',
      },
    ];
    const vm = adhdTaxVM(records, [], NOW);
    expect(vm.total).toBe(29);
    expect(vm.rows).toHaveLength(1);
    expect(vm.monthLabel).toBe('may, so far');
  });
  it('ignores records from previous months', () => {
    const records: FinanceRecord[] = [
      {
        event_date: '2026-03-10',
        amount: 50,
        currency: 'USD',
        merchant: 'x',
        merchant_normalized: 'x',
        direction: 'out',
        is_adhd_tax: true,
      },
    ];
    expect(adhdTaxVM(records, [], NOW).total).toBe(0);
  });
});

describe('subscriptionAudit / dormantCount', () => {
  const subs: StoredSub[] = [
    { id: 's1', name: 'Netflix', amount: 15, period: 'monthly', ts: NOW },
    { id: 's2', name: 'Spotify', amount: 11, period: 'monthly', ts: NOW },
  ];

  it('flags subs with no recent record as dormant', () => {
    const cards = subscriptionAudit(subs, [], NOW);
    expect(cards.every((c) => c.dormant)).toBe(true);
    expect(dormantCount(subs, [], NOW)).toBe(2);
  });

  it('a recent record keeps a sub non-dormant', () => {
    const records: FinanceRecord[] = [
      {
        event_date: '2026-05-15',
        amount: 15,
        currency: 'USD',
        merchant: 'Netflix subscription',
        merchant_normalized: 'netflix',
        direction: 'out',
      },
    ];
    expect(dormantCount(subs, records, NOW)).toBe(1);
  });
});

describe('taxSetAsideVM', () => {
  it('no income → haveIncome false', () => {
    expect(taxSetAsideVM([], NOW).haveIncome).toBe(false);
  });
  it('computes a positive set-aside from the last income', () => {
    const vm = taxSetAsideVM([incomeRecord('2026-05-12', 1150)], NOW);
    expect(vm.haveIncome).toBe(true);
    expect(vm.landedIncome).toBe(1150);
    expect(vm.setAside).toBeGreaterThan(0);
    expect(vm.pct).toBeGreaterThan(0);
  });
});

describe('hasAnyFinanceData', () => {
  it('false for the empty slices', () => {
    expect(hasAnyFinanceData(emptySlices())).toBe(false);
  });
  it('true once any slice has an entry', () => {
    const slices = emptySlices();
    slices.bills = [
      { id: 'b1', name: 'rent', amount: 1200, frequency: 'monthly', dueDay: 1, ts: NOW },
    ];
    expect(hasAnyFinanceData(slices)).toBe(true);
  });
});
