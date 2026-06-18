/**
 * Finance module · renewal-mirror whitelist (audit #135)
 *
 * The `log_transaction.renewal_for` mirror whitelist must derive from the
 * shared schema constant RENEWAL_FOR_TYPES so it can never drift from the
 * enum. Before the fix the handler kept a hand-typed Set; a type added to the
 * schema (e.g. 'work_permit') would be silently swallowed.
 *
 * Coverage:
 *   1. EVERY value in RENEWAL_FOR_TYPES mirrors to an admin renewal.
 *   2. A non-renewal transaction does NOT mirror.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateFinance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  transactions: { add: vi.fn().mockResolvedValue({ id: 'tx-id', merchant: null }), remove: vi.fn() },
  bills: { add: vi.fn(), remove: vi.fn() },
  income: { add: vi.fn(), remove: vi.fn() },
  pending: { add: vi.fn(), remove: vi.fn() },
  reflections: { add: vi.fn(), remove: vi.fn() },
  refunds: { add: vi.fn(), remove: vi.fn() },
  subscriptions: { add: vi.fn(), remove: vi.fn() },
}));

vi.mock('../admin/migrate', () => ({
  migrateAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../admin/repo', () => ({
  renewals: {
    add: vi.fn().mockResolvedValue({ id: 'renewal-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { financeHandler, RENEWAL_FOR_TYPES } from './handler';
import { renewals as adminRenewals } from '../admin/repo';
import type { Fragment } from '../../router/schema';

const mockRenewalAdd = vi.mocked(adminRenewals.add);

function txFragment(renewal_for?: string): Fragment {
  return {
    text: 'paid a fee',
    language: 'en',
    module: 'finance',
    payload: {
      module: 'finance',
      action: 'log_transaction',
      amount: 100,
      ...(renewal_for ? { renewal_for: renewal_for as never } : {}),
    },
    confidence: 0.9,
    source: 'ai',
  };
}

describe('financeHandler — renewal_for mirror whitelist (#135)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(RENEWAL_FOR_TYPES)('mirrors renewal_for=%s to an admin renewal', async (type) => {
    await financeHandler.apply(txFragment(type));
    expect(mockRenewalAdd).toHaveBeenCalledOnce();
    expect(mockRenewalAdd).toHaveBeenCalledWith({ renewalType: type, dueDate: null });
  });

  it('does NOT mirror a plain transaction with no renewal_for', async () => {
    await financeHandler.apply(txFragment());
    expect(mockRenewalAdd).not.toHaveBeenCalled();
  });

  it('does NOT mirror an unrecognised renewal_for value', async () => {
    await financeHandler.apply(txFragment('spaceship_registration'));
    expect(mockRenewalAdd).not.toHaveBeenCalled();
  });
});
