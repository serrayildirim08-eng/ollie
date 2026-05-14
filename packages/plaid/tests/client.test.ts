/**
 * @ollie/plaid · client factory + read-only invariant tests
 */

import { describe, it, expect } from 'vitest';
import { createPlaidClient, PLAID_READ_ONLY_PRODUCTS } from '../src/client';
import { Products } from 'plaid';

describe('PLAID_READ_ONLY_PRODUCTS', () => {
  it('contains exactly transactions, auth, identity — and nothing else', () => {
    expect(PLAID_READ_ONLY_PRODUCTS).toHaveLength(3);
    expect(PLAID_READ_ONLY_PRODUCTS).toContain(Products.Transactions);
    expect(PLAID_READ_ONLY_PRODUCTS).toContain(Products.Auth);
    expect(PLAID_READ_ONLY_PRODUCTS).toContain(Products.Identity);
  });

  it('does NOT contain any money-moving product', () => {
    // These are read-only via the absence assertion. If a future change
    // adds Transfer or PaymentInitiation, the senior review process
    // MUST also delete this test — surfacing the regression in PR diff.
    const banned = ['transfer', 'payment_initiation', 'signal'];
    for (const p of PLAID_READ_ONLY_PRODUCTS) {
      expect(banned).not.toContain(String(p));
    }
  });

  it('is frozen — runtime mutation is rejected', () => {
    expect(Object.isFrozen(PLAID_READ_ONLY_PRODUCTS)).toBe(true);
  });
});

describe('createPlaidClient', () => {
  it('throws if clientId is missing', () => {
    expect(() =>
      createPlaidClient({ env: 'sandbox', clientId: '', secret: 'x' }),
    ).toThrow(/clientId/);
  });

  it('throws if secret is missing', () => {
    expect(() =>
      createPlaidClient({ env: 'sandbox', clientId: 'x', secret: '' }),
    ).toThrow(/secret/);
  });

  it('builds a PlaidApi instance for sandbox', () => {
    const c = createPlaidClient({ env: 'sandbox', clientId: 'cid', secret: 'sec' });
    expect(c).toBeTruthy();
    // PlaidApi instances expose linkTokenCreate; existence is the
    // smoke check (we don't make a real call here).
    expect(typeof c.linkTokenCreate).toBe('function');
  });
});
