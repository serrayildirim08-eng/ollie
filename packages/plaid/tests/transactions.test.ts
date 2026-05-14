/**
 * @ollie/plaid · transaction normalization tests
 *
 * These tests pin the Plaid → ollie sign convention + merchant
 * normalization. They run pure (no Plaid SDK calls) against fixture
 * shapes that match the upstream contract.
 */

import { describe, it, expect } from 'vitest';
import { normalizePlaidTransaction } from '../src/transactions';
import type { PlaidTransactionShape } from '../src/types';

function fixture(overrides: Partial<PlaidTransactionShape> = {}): PlaidTransactionShape {
  return {
    transaction_id: 'txn_abc123',
    account_id: 'acct_1',
    amount: 12.34,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    date: '2026-05-10',
    datetime: null,
    merchant_name: 'Trader Joe\'s',
    name: 'TRADER JOES #123',
    pending: false,
    category: ['Food and Drink', 'Groceries'],
    personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' },
    location: { city: 'San Francisco', region: 'CA', country: 'US' },
    payment_channel: 'in store',
    ...overrides,
  };
}

describe('normalizePlaidTransaction', () => {
  it('maps a debit (positive Plaid amount) to direction=out, positive ollie amount', () => {
    const r = normalizePlaidTransaction(fixture({ amount: 12.34 }), 'item_x');
    expect(r.direction).toBe('out');
    expect(r.amount).toBe(12.34);
  });

  it('maps a credit (negative Plaid amount) to direction=in, positive ollie amount', () => {
    const r = normalizePlaidTransaction(fixture({ amount: -50 }), 'item_x');
    expect(r.direction).toBe('in');
    expect(r.amount).toBe(50);
  });

  it('preserves the transaction id and date', () => {
    const r = normalizePlaidTransaction(fixture({ transaction_id: 'TX1', date: '2026-01-02' }), 'item_x');
    expect(r.id).toBe('TX1');
    expect(r.event_date).toBe('2026-01-02');
  });

  it('prefers merchant_name over name, lowercases for merchant_normalized', () => {
    const r = normalizePlaidTransaction(fixture(), 'item_x');
    expect(r.merchant).toBe("Trader Joe's");
    expect(r.merchant_normalized).toBe("trader joe's");
  });

  it('falls back to name when merchant_name is null', () => {
    const r = normalizePlaidTransaction(
      fixture({ merchant_name: null, name: 'AMZN MKTP US*Y1234' }),
      'item_x',
    );
    expect(r.merchant).toBe('AMZN MKTP US*Y1234');
    expect(r.merchant_normalized).toBe('amzn mktp us*y1234');
  });

  it('prefers personal_finance_category.detailed over category[]', () => {
    const r = normalizePlaidTransaction(fixture(), 'item_x');
    expect(r.category).toBe('FOOD_AND_DRINK_GROCERIES');
  });

  it('falls back to joined category[] when personal_finance_category is null', () => {
    const r = normalizePlaidTransaction(
      fixture({ personal_finance_category: null }),
      'item_x',
    );
    expect(r.category).toBe('Food and Drink · Groceries');
  });

  it('uses iso_currency_code, falls back to unofficial, then USD', () => {
    expect(
      normalizePlaidTransaction(fixture({ iso_currency_code: 'EUR' }), 'item').currency,
    ).toBe('EUR');
    expect(
      normalizePlaidTransaction(
        fixture({ iso_currency_code: null, unofficial_currency_code: 'GBP' }),
        'item',
      ).currency,
    ).toBe('GBP');
    expect(
      normalizePlaidTransaction(
        fixture({ iso_currency_code: null, unofficial_currency_code: null }),
        'item',
      ).currency,
    ).toBe('USD');
  });

  it('marks source=plaid and stamps item id + account id', () => {
    const r = normalizePlaidTransaction(fixture({ account_id: 'A99' }), 'item_xyz');
    expect(r.source).toBe('plaid');
    expect(r.source_item_id).toBe('item_xyz');
    expect(r.source_account_id).toBe('A99');
  });

  it('collapses internal whitespace in merchant_normalized', () => {
    const r = normalizePlaidTransaction(
      fixture({ merchant_name: '  Whole   Foods   Market  ' }),
      'item_x',
    );
    expect(r.merchant_normalized).toBe('whole foods market');
  });

  it('handles zero-amount as direction=out (Plaid convention: 0 is treated as debit)', () => {
    const r = normalizePlaidTransaction(fixture({ amount: 0 }), 'item_x');
    expect(r.direction).toBe('out');
    expect(r.amount).toBe(0);
  });
});
