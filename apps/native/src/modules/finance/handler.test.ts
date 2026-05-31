/**
 * Finance module · handler unit tests
 *
 * Coverage:
 *   - undo for `log_transaction` removes the transaction row by id
 *   - renewal_for hint mirrors to admin.renewals.add + undo removes both rows
 *   - log_transaction without renewal_for does NOT call admin
 *   - admin mirror failure does not roll back the primary finance write
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

import { transactions } from './repo';
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
