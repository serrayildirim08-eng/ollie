/**
 * IncomeCard · unit tests
 *
 * The card is a pure consumer of @ollie/logic/finance income-detection
 * pure-fns. These tests verify the *surface*: sparse-data renders null,
 * normal data renders this-month + 3-month-avg + delta, and delta sign
 * carries the correct prefix + colour bucket.
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { FinanceRecord } from '@ollie/logic/finance';
import { IncomeCard } from './IncomeCard';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const NOW = new Date('2026-05-14T12:00:00Z').getTime();
const $fmt = (n: number | null | undefined): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n ?? 0));

function mount(records: FinanceRecord[], masked = false) {
  act(() => {
    root.render(
      <IncomeCard records={records} now={NOW} masked={masked} $fmt={$fmt} />,
    );
  });
}

function rec(date: string, amount: number, dir: 'in' | 'out' = 'in'): FinanceRecord {
  return {
    event_date: date,
    amount,
    currency: 'USD',
    merchant: 'client a',
    merchant_normalized: 'client a',
    direction: dir,
  };
}

describe('IncomeCard · sparse data', () => {
  it('renders nothing when no inbound records', () => {
    mount([]);
    expect(container.textContent ?? '').toBe('');
  });

  it('renders nothing when only one month of inbound data', () => {
    mount([
      rec('2026-05-01', 1000),
      rec('2026-05-15', 1000),
    ]);
    expect(container.textContent ?? '').toBe('');
  });

  it('renders nothing when only outbound records exist', () => {
    mount([
      rec('2026-03-15', 1000, 'out'),
      rec('2026-04-15', 1000, 'out'),
      rec('2026-05-15', 1000, 'out'),
    ]);
    expect(container.textContent ?? '').toBe('');
  });
});

describe('IncomeCard · normal data', () => {
  // Biweekly $2000 payments across 4 months. April + May identical → 0% delta.
  const biweekly: FinanceRecord[] = [
    rec('2026-02-01', 2000),
    rec('2026-02-15', 2000),
    rec('2026-03-01', 2000),
    rec('2026-03-15', 2000),
    rec('2026-04-01', 2000),
    rec('2026-04-15', 2000),
    rec('2026-05-01', 2000),
    rec('2026-05-13', 2000),
  ];

  it('renders all three numbers', () => {
    mount(biweekly);
    const txt = container.textContent ?? '';
    // this-month total: $4000
    expect(txt).toContain('this month');
    expect(txt).toContain('$4,000');
    // 3-month avg: ($4000 + $4000 + $4000) / 3 = $4000
    expect(txt).toContain('average');
    expect(txt).toContain('3 mo');
    // delta: 0%
    expect(txt).toContain('delta');
    expect(txt).toContain('+0%');
  });

  it('renders the frequency badge when n_events >= 3', () => {
    mount(biweekly);
    expect((container.textContent ?? '').toLowerCase()).toContain('biweekly');
  });

  it('title stays "income" when delta is within ±20%', () => {
    mount(biweekly);
    // No 'income · variable' header bump.
    const text = container.textContent ?? '';
    expect(text).toContain('income');
    expect(text).not.toContain('variable');
  });
});

describe('IncomeCard · delta sign + magnitude', () => {
  it('shows negative delta with minus prefix when this month dips', () => {
    // Avg priors $4000/mo; this month $2000 → -50%.
    const dipping: FinanceRecord[] = [
      rec('2026-02-01', 2000),
      rec('2026-02-15', 2000),
      rec('2026-03-01', 2000),
      rec('2026-03-15', 2000),
      rec('2026-04-01', 2000),
      rec('2026-04-15', 2000),
      rec('2026-05-13', 2000),
    ];
    mount(dipping);
    const delta = container.querySelector('[data-testid="income-delta"]');
    expect(delta).not.toBeNull();
    expect(delta?.textContent).toContain('-50%');
  });

  it('shows positive delta with plus prefix when this month surges', () => {
    // Avg priors $2000/mo; this month $4000 → +100%.
    const surging: FinanceRecord[] = [
      rec('2026-02-15', 2000),
      rec('2026-03-15', 2000),
      rec('2026-04-15', 2000),
      rec('2026-05-01', 2000),
      rec('2026-05-13', 2000),
    ];
    mount(surging);
    const delta = container.querySelector('[data-testid="income-delta"]');
    expect(delta).not.toBeNull();
    expect(delta?.textContent).toContain('+100%');
  });

  it('promotes title to "income · variable" when delta exceeds ±20%', () => {
    const dipping: FinanceRecord[] = [
      rec('2026-02-01', 2000),
      rec('2026-02-15', 2000),
      rec('2026-03-01', 2000),
      rec('2026-03-15', 2000),
      rec('2026-04-01', 2000),
      rec('2026-04-15', 2000),
      rec('2026-05-13', 2000),
    ];
    mount(dipping);
    expect((container.textContent ?? '').toLowerCase()).toContain('income · variable');
  });

  it('positive and negative deltas render distinct colours', () => {
    // Positive surge first.
    const surging: FinanceRecord[] = [
      rec('2026-02-15', 2000),
      rec('2026-03-15', 2000),
      rec('2026-04-15', 2000),
      rec('2026-05-01', 4000),
    ];
    mount(surging);
    const posColor = (container.querySelector('[data-testid="income-delta"]') as HTMLElement | null)?.style.color ?? '';
    expect(posColor).toMatch(/rgba?\(/);

    // Negative dip after re-mount.
    const dipping: FinanceRecord[] = [
      rec('2026-02-15', 4000),
      rec('2026-03-15', 4000),
      rec('2026-04-15', 4000),
      rec('2026-05-01', 1000),
    ];
    act(() => { root.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mount(dipping);
    const negColor = (container.querySelector('[data-testid="income-delta"]') as HTMLElement | null)?.style.color ?? '';
    expect(negColor).toMatch(/rgba?\(/);
    expect(posColor).not.toBe(negColor);
  });
});

describe('IncomeCard · privacy mode', () => {
  it('masks figures when masked=true', () => {
    const records: FinanceRecord[] = [
      rec('2026-02-15', 2000),
      rec('2026-03-15', 2000),
      rec('2026-04-15', 2000),
      rec('2026-05-13', 2000),
    ];
    const maskFmt = (n: number | null | undefined): string => {
      void n;
      return '▮▮▮';
    };
    act(() => {
      root.render(
        <IncomeCard records={records} now={NOW} masked={true} $fmt={maskFmt} />,
      );
    });
    const txt = container.textContent ?? '';
    expect(txt).toContain('▮▮▮');
    expect(txt).not.toContain('$2,000');
    expect(txt).not.toContain('$8,000');
  });
});
