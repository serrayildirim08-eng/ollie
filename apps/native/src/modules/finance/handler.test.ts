/**
 * Finance module · handler unit tests
 *
 * Coverage:
 *   - undo for `log_transaction` removes the transaction row by id
 *   - renewal_for hint mirrors to admin.renewals.add + undo removes both rows
 *   - log_transaction without renewal_for does NOT call admin
 *   - admin mirror failure does not roll back the primary finance write
 *   - log_income / log_refund / spending_reflection / pending_decision —
 *     persist via their repo + return a working undo closure (2026-05-31)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateFinance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  transactions: {
    add: vi.fn().mockResolvedValue({ id: 'tx-id', amount: 5, currency: 'USD', merchant: 'coffee', occurredAt: 0 }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  bills: {
    add: vi.fn().mockResolvedValue({ id: 'bill-id', merchant: 'netflix' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  subscriptions: {
    add: vi.fn().mockResolvedValue({ id: 'sub-id', name: 'spotify' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  income: {
    add: vi.fn().mockResolvedValue({
      id: 'inc-id',
      amount: null,
      currency: null,
      source: 'akalan',
      receivedAt: 0,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  refunds: {
    add: vi.fn().mockResolvedValue({
      id: 'ref-id',
      amount: 40,
      currency: 'USD',
      merchant: 'amazon',
      originalItem: null,
      refundedAt: 0,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  reflections: {
    add: vi.fn().mockResolvedValue({
      id: 'refl-id',
      note: 'spending too much on coffee',
      category: 'café',
      sentiment: 'concerned',
      notedAt: 0,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  pending: {
    add: vi.fn().mockResolvedValue({
      id: 'pen-id',
      what: 'moving quote',
      decision: null,
      snoozeUntilMs: null,
      createdAt: 0,
      amount: 2400,
      currency: null,
      deadline: null,
      decidedAtMs: null,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../admin/migrate', () => ({
  migrateAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../admin/repo', () => ({
  renewals: {
    add: vi.fn().mockResolvedValue({ id: 'ren-id', renewalType: 'passport', dueDate: null, addedAt: 0 }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  tasks: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

import { transactions, income, refunds, reflections, pending } from './repo';
import { renewals as adminRenewals } from '../admin/repo';
import { financeHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('financeHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_transaction: undo removes the transaction row by id', async () => {
    const fragment: Fragment = {
      text: 'spent $5 on coffee',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_transaction', amount: 5, currency: 'USD', merchant: 'coffee' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(transactions.remove)).toHaveBeenCalledWith('tx-id');
  });
});

describe('financeHandler — new action types (2026-05-31)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_income: undo removes the income row by id', async () => {
    const fragment: Fragment = {
      text: 'received paycheck from akalan',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_income', source: 'akalan' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.ok).toBe(true);
    await result.undo!();
    expect(vi.mocked(income.remove)).toHaveBeenCalledWith('inc-id');
  });

  it('log_refund: undo removes the refund row by id', async () => {
    const fragment: Fragment = {
      text: 'amazon refunded me 40 dollars',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_refund', amount: 40, currency: 'USD', merchant: 'amazon' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.ok).toBe(true);
    await result.undo!();
    expect(vi.mocked(refunds.remove)).toHaveBeenCalledWith('ref-id');
  });

  it('spending_reflection: undo removes the reflection row', async () => {
    const fragment: Fragment = {
      text: 'i spend too much on coffee',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'spending_reflection', note: 'spending too much on coffee', category: 'café', sentiment: 'concerned' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.ok).toBe(true);
    await result.undo!();
    expect(vi.mocked(reflections.remove)).toHaveBeenCalledWith('refl-id');
  });

  it('pending_decision: undo removes the pending row', async () => {
    const fragment: Fragment = {
      text: 'moving quote 2400 should I take it',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'pending_decision', what: 'moving quote', amount: 2400 },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.ok).toBe(true);
    await result.undo!();
    expect(vi.mocked(pending.remove)).toHaveBeenCalledWith('pen-id');
  });
});

describe('financeHandler — renewal_for cross-route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_transaction with renewal_for writes finance row AND calls admin.renewals.add', async () => {
    const fragment: Fragment = {
      text: 'expedite fee 89 dollars for passport',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_transaction', amount: 89, currency: 'USD', merchant: 'passport expedite', renewal_for: 'passport' },
      confidence: 0.95,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.ok).toBe(true);
    expect(vi.mocked(transactions.add)).toHaveBeenCalledOnce();
    expect(vi.mocked(adminRenewals.add)).toHaveBeenCalledWith({ renewalType: 'passport', dueDate: null });
  });

  it('log_transaction without renewal_for does NOT call admin.renewals.add', async () => {
    const fragment: Fragment = {
      text: 'spent $40 at sephora',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_transaction', amount: 40, currency: 'USD', merchant: 'sephora' },
      confidence: 0.9,
      source: 'ai',
    };
    await financeHandler.apply(fragment);
    expect(vi.mocked(adminRenewals.add)).not.toHaveBeenCalled();
  });

  it('undo removes admin renewal first then finance row (reverse order)', async () => {
    const callOrder: string[] = [];
    vi.mocked(adminRenewals.remove).mockImplementation(async () => { callOrder.push('admin'); });
    vi.mocked(transactions.remove).mockImplementation(async () => { callOrder.push('finance'); });

    const fragment: Fragment = {
      text: 'visa fee 180 euros',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_transaction', amount: 180, currency: 'EUR', merchant: 'visa fee', renewal_for: 'visa' },
      confidence: 0.95,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    await result.undo!();
    expect(callOrder).toEqual(['admin', 'finance']);
    expect(vi.mocked(adminRenewals.remove)).toHaveBeenCalledWith('ren-id');
    expect(vi.mocked(transactions.remove)).toHaveBeenCalledWith('tx-id');
  });

  it('admin mirror failure does not roll back the primary finance write', async () => {
    vi.mocked(adminRenewals.add).mockRejectedValueOnce(new Error('db gone'));

    const fragment: Fragment = {
      text: 'pasaport harcı 600 lira',
      language: 'tr',
      module: 'finance',
      payload: { module: 'finance', action: 'log_transaction', amount: 600, currency: 'TRY', merchant: 'passport fee', renewal_for: 'passport' },
      confidence: 0.95,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    // Primary write must have succeeded
    expect(result.ok).toBe(true);
    expect(vi.mocked(transactions.add)).toHaveBeenCalledOnce();
    // Undo should still remove finance row (no admin row was created)
    await result.undo!();
    expect(vi.mocked(transactions.remove)).toHaveBeenCalledWith('tx-id');
    expect(vi.mocked(adminRenewals.remove)).not.toHaveBeenCalled();
  });
});

// ─── deeper coverage for the four new action types ───────────────────────
//
// Cover note-label rendering, payload pass-through, and empty-string
// defensive fallbacks. Complements the minimal undo suite above.

describe('financeHandler — log_income (label + payload)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders source in the note label and passes payload through', async () => {
    const fragment: Fragment = {
      text: 'akalan paycheck deposited',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_income', source: 'akalan' },
      confidence: 0.95,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.note).toBe('logged income: akalan');
    expect(vi.mocked(income.add)).toHaveBeenCalledWith({
      amount: null,
      currency: null,
      source: 'akalan',
    });
  });

  it('falls back to "income" label when source missing on the persisted row', async () => {
    vi.mocked(income.add).mockResolvedValueOnce({
      id: 'inc-id-2',
      amount: 500,
      currency: 'EUR',
      source: null,
      receivedAt: 0,
    });
    const fragment: Fragment = {
      text: 'got 500',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_income', amount: 500, currency: 'EUR' },
      confidence: 0.85,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.note).toBe('logged income: income');
  });
});

describe('financeHandler — log_refund (label + payload)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes payload through with merchant + amount', async () => {
    const fragment: Fragment = {
      text: 'amazon refunded me $40',
      language: 'en',
      module: 'finance',
      payload: {
        module: 'finance',
        action: 'log_refund',
        amount: 40,
        currency: 'USD',
        merchant: 'amazon',
      },
      confidence: 0.96,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.note).toBe('logged refund: amazon');
    expect(vi.mocked(refunds.add)).toHaveBeenCalledWith({
      amount: 40,
      currency: 'USD',
      merchant: 'amazon',
      originalItem: null,
    });
  });

  it('prefers originalItem over merchant in the label', async () => {
    vi.mocked(refunds.add).mockResolvedValueOnce({
      id: 'ref-id-2',
      amount: null,
      currency: null,
      merchant: null,
      originalItem: 'scarf',
      refundedAt: 0,
    });
    const fragment: Fragment = {
      text: 'returned the scarf',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'log_refund', originalItem: 'scarf' },
      confidence: 0.93,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.note).toBe('logged refund: scarf');
  });
});

describe('financeHandler — spending_reflection (label + payload)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes payload through with category + sentiment', async () => {
    const fragment: Fragment = {
      text: 'gastando demasiado en café',
      language: 'es',
      module: 'finance',
      payload: {
        module: 'finance',
        action: 'spending_reflection',
        note: 'spending too much on coffee',
        category: 'café',
        sentiment: 'concerned',
      },
      confidence: 0.93,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.note).toBe('reflection: café');
    expect(vi.mocked(reflections.add)).toHaveBeenCalledWith({
      note: 'spending too much on coffee',
      category: 'café',
      sentiment: 'concerned',
    });
  });

  it('uses generic label when category is missing on the persisted row', async () => {
    vi.mocked(reflections.add).mockResolvedValueOnce({
      id: 'refl-2',
      note: 'overspending on impulse buys',
      category: null,
      sentiment: 'concerned',
      notedAt: 0,
    });
    const fragment: Fragment = {
      text: 'i overspend on impulse stuff',
      language: 'en',
      module: 'finance',
      payload: {
        module: 'finance',
        action: 'spending_reflection',
        note: 'overspending on impulse buys',
      },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.note).toBe('reflection logged');
  });

  it('falls back to a generic note when the worker sends whitespace only', async () => {
    const fragment: Fragment = {
      text: 'reflection',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'spending_reflection', note: '   ' },
      confidence: 0.7,
      source: 'ai',
    };
    await financeHandler.apply(fragment);
    expect(vi.mocked(reflections.add)).toHaveBeenCalledWith({
      note: 'spending reflection',
      category: null,
      sentiment: null,
    });
  });
});

describe('financeHandler — pending_decision (label + payload)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes payload through with amount', async () => {
    const fragment: Fragment = {
      text: 'moving quote 2400',
      language: 'en',
      module: 'finance',
      payload: {
        module: 'finance',
        action: 'pending_decision',
        what: 'moving quote',
        amount: 2400,
      },
      confidence: 0.95,
      source: 'ai',
    };
    const result = await financeHandler.apply(fragment);
    expect(result.note).toBe('pending: moving quote');
    expect(vi.mocked(pending.add)).toHaveBeenCalledWith({
      what: 'moving quote',
      amount: 2400,
      currency: null,
      deadline: null,
    });
  });

  it('falls back to a generic "what" when the worker sends whitespace only', async () => {
    const fragment: Fragment = {
      text: '?',
      language: 'en',
      module: 'finance',
      payload: { module: 'finance', action: 'pending_decision', what: '  ' },
      confidence: 0.7,
      source: 'ai',
    };
    await financeHandler.apply(fragment);
    expect(vi.mocked(pending.add)).toHaveBeenCalledWith({
      what: 'pending decision',
      amount: null,
      currency: null,
      deadline: null,
    });
  });
});
