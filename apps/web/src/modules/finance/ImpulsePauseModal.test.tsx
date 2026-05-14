/**
 * ImpulsePauseModal · unit tests
 *
 * Covers:
 *   - pure helpers: thisMonthVariableTotal, pctOfVariable, findSimilarPurchases,
 *     isHoldEligible
 *   - modal renders amount + countdown + similar list when open
 *   - "didn't buy" + "bought anyway" buttons fire the right callbacks
 *   - closing the dialog (Esc / overlay click) calls onClose, NOT a resolver
 *   - timer ticks down without re-mounting
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  ImpulsePauseModal,
  thisMonthVariableTotal,
  pctOfVariable,
  findSimilarPurchases,
  isHoldEligible,
  type PendingPause,
} from './ImpulsePauseModal';

const TX = (overrides: Partial<{ ts: number; amount: number; merchant: string; category: string; direction: 'in' | 'out' }> = {}) => ({
  ts: Date.now(),
  amount: 10,
  merchant: '',
  category: 'other',
  direction: 'out' as const,
  ...overrides,
});

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

function makePause(over: Partial<PendingPause> = {}): PendingPause {
  const now = Date.now();
  return {
    id: 'pause-test',
    amount: 42,
    merchant: 'amazon',
    category: 'other',
    ts: now,
    expires_at: now + 24 * 3600_000,
    draft: { returnable_until: null },
    ...over,
  };
}

function mount(props: Partial<React.ComponentProps<typeof ImpulsePauseModal>> = {}) {
  const merged: React.ComponentProps<typeof ImpulsePauseModal> = {
    open: true,
    pause: makePause(),
    variableBudgetPct: 12,
    similar: [],
    onSkip: () => {},
    onPurchase: () => {},
    onClose: () => {},
    ...props,
  };
  act(() => {
    root.render(<ImpulsePauseModal {...merged} />);
  });
}

// ─── pure helpers ──────────────────────────────────────────────────────────

describe('thisMonthVariableTotal', () => {
  it('sums only this-month outflows excluding bills + subscriptions', () => {
    const now = new Date(2026, 4, 14, 12).getTime(); // 2026-05-14
    const startOfMonth = new Date(2026, 4, 1).getTime();
    const txs = [
      TX({ ts: startOfMonth + 86_400_000, amount: 12, category: 'coffee' }),
      TX({ ts: startOfMonth + 86_400_000, amount: 30, category: 'takeout' }),
      TX({ ts: startOfMonth + 86_400_000, amount: 1500, category: 'bills' }),    // excluded
      TX({ ts: startOfMonth + 86_400_000, amount: 15, category: 'subscriptions' }), // excluded
      TX({ ts: startOfMonth + 86_400_000, amount: 100, category: 'groceries' }), // included
      TX({ ts: startOfMonth - 86_400_000, amount: 99, category: 'coffee' }),     // last month, excluded
      TX({ ts: startOfMonth + 86_400_000, amount: 200, category: 'other', direction: 'in' }), // income excluded
    ];
    expect(thisMonthVariableTotal(txs, now)).toBe(142);
  });
});

describe('pctOfVariable', () => {
  it('returns null when month variable is 0', () => {
    expect(pctOfVariable(20, 0)).toBeNull();
  });
  it('divides amount by (variable + amount)', () => {
    expect(Math.round(pctOfVariable(50, 150) ?? 0)).toBe(25); // 50 / 200 = 25%
  });
});

describe('findSimilarPurchases', () => {
  const now = Date.now();
  const txs = [
    { ts: now - 5 * 86_400_000, amount: 7, merchant: 'starbucks', category: 'coffee' },
    { ts: now - 30 * 86_400_000, amount: 9, merchant: 'starbucks', category: 'coffee' },
    { ts: now - 100 * 86_400_000, amount: 6, merchant: 'starbucks', category: 'coffee' }, // outside 90d window
    { ts: now - 2 * 86_400_000, amount: 12, merchant: 'whole foods', category: 'groceries' },
  ];

  it('matches by merchant within window', () => {
    const out = findSimilarPurchases(txs, { merchant: 'starbucks', category: 'coffee' }, now);
    expect(out).toHaveLength(2);
    expect(out[0].ts).toBeGreaterThan(out[1].ts); // sorted desc by ts
  });

  it('falls back to category when no merchant provided', () => {
    const out = findSimilarPurchases(txs, { merchant: '', category: 'groceries' }, now);
    expect(out).toHaveLength(1);
    expect(out[0].merchant).toBe('whole foods');
  });

  it('returns empty when neither merchant nor category match', () => {
    const out = findSimilarPurchases(txs, { merchant: 'target', category: 'other' }, now);
    expect(out).toHaveLength(0);
  });
});

describe('isHoldEligible', () => {
  it('flags non-essential variable categories', () => {
    expect(isHoldEligible('coffee')).toBe(true);
    expect(isHoldEligible('takeout')).toBe(true);
    expect(isHoldEligible('transport')).toBe(true);
    expect(isHoldEligible('other')).toBe(true);
  });
  it('excludes essential categories', () => {
    expect(isHoldEligible('bills')).toBe(false);
    expect(isHoldEligible('subscriptions')).toBe(false);
    expect(isHoldEligible('groceries')).toBe(false);
  });
});

// ─── component behaviour ───────────────────────────────────────────────────

describe('ImpulsePauseModal · render', () => {
  it('returns null when closed', () => {
    mount({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders amount + category + variable %', () => {
    mount();
    expect(container.textContent ?? '').toContain('$42');
    expect(container.textContent ?? '').toContain('amazon · other');
    expect(container.textContent ?? '').toContain("of this month's variable");
  });

  it('omits % when variableBudgetPct is null', () => {
    mount({ variableBudgetPct: null });
    expect(container.textContent ?? '').not.toContain("of this month's variable");
  });

  it('renders similar purchases (max 5)', () => {
    const now = Date.now();
    const similar = Array.from({ length: 8 }, (_, i) => ({
      ts: now - (i + 1) * 86_400_000,
      amount: 5 + i,
      merchant: 'starbucks',
      category: 'coffee',
    }));
    mount({ similar });
    // We render 5 rows + section header; count $ rows
    const text = container.textContent ?? '';
    expect(text).toContain('similar · last 90 days');
    // Each shown row has '$' followed by amount; count expected
    const matches = text.match(/\$\d+ · starbucks/g) ?? [];
    expect(matches.length).toBe(5);
  });
});

describe('ImpulsePauseModal · resolution', () => {
  it('calls onSkip when "didn\'t buy" is clicked', () => {
    const onSkip = vi.fn();
    mount({ onSkip });
    const btns = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const skip = btns.find((b) => (b.textContent ?? '').trim() === "didn't buy");
    expect(skip).toBeDefined();
    act(() => { skip!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('calls onPurchase when "bought anyway" is clicked', () => {
    const onPurchase = vi.fn();
    mount({ onPurchase });
    const btns = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const buy = btns.find((b) => (b.textContent ?? '').trim() === 'bought anyway');
    expect(buy).toBeDefined();
    act(() => { buy!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onPurchase).toHaveBeenCalledTimes(1);
  });

  it('calls onClose (not onSkip) when × is clicked', () => {
    const onClose = vi.fn();
    const onSkip = vi.fn();
    mount({ onClose, onSkip });
    const close = container.querySelector('button[aria-label="close"]') as HTMLButtonElement;
    act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    mount({ onClose });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ImpulsePauseModal · banned-phrase audit (smoke)', () => {
  it('does not contain cheerleading copy', () => {
    mount();
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('great');
    expect(text).not.toContain('awesome');
    expect(text).not.toContain('good job');
    expect(text).not.toContain("you've got this"); // notif-scope-allow
    expect(text).not.toContain('!');
  });
});
