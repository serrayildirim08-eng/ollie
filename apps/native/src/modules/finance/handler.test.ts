/**
 * Finance module · handler unit tests
 *
 * Coverage:
 *   - undo for `log_transaction` removes the transaction row by id
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

import { transactions } from './repo';
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
