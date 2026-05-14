/**
 * @ollie/plaid · webhook router tests
 *
 * Pure-function tests for routeWebhook. The verification helper
 * (verifyWebhook) hits crypto.subtle + Plaid's API and is exercised
 * in the smoke script — unit-testing it here would mock more than
 * it asserts.
 */

import { describe, it, expect } from 'vitest';
import { routeWebhook } from '../src/webhook';

describe('routeWebhook', () => {
  it('routes TRANSACTIONS / INITIAL_UPDATE to sync_transactions', () => {
    const r = routeWebhook({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'INITIAL_UPDATE',
      item_id: 'item_1',
    });
    expect(r.action.kind).toBe('sync_transactions');
    if (r.action.kind === 'sync_transactions') {
      expect(r.action.item_id).toBe('item_1');
      expect(r.action.reason).toBe('INITIAL_UPDATE');
    }
  });

  it('routes TRANSACTIONS / SYNC_UPDATES_AVAILABLE to sync_transactions', () => {
    const r = routeWebhook({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'item_2',
    });
    expect(r.action.kind).toBe('sync_transactions');
  });

  it('routes TRANSACTIONS_REMOVED to tombstone_transactions with id list', () => {
    const r = routeWebhook({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'TRANSACTIONS_REMOVED',
      item_id: 'item_3',
      removed_transactions: ['txn_a', 'txn_b'],
    });
    expect(r.action.kind).toBe('tombstone_transactions');
    if (r.action.kind === 'tombstone_transactions') {
      expect(r.action.removed_ids).toEqual(['txn_a', 'txn_b']);
    }
  });

  it('routes ITEM / ERROR to mark_item_error with the error payload', () => {
    const err = { error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED', error_message: 're-auth' };
    const r = routeWebhook({
      webhook_type: 'ITEM',
      webhook_code: 'ERROR',
      item_id: 'item_4',
      error: err,
    });
    expect(r.action.kind).toBe('mark_item_error');
    if (r.action.kind === 'mark_item_error') {
      expect(r.action.error).toEqual(err);
    }
  });

  it('routes ITEM / USER_PERMISSION_REVOKED to mark_item_revoked', () => {
    const r = routeWebhook({
      webhook_type: 'ITEM',
      webhook_code: 'USER_PERMISSION_REVOKED',
      item_id: 'item_5',
    });
    expect(r.action.kind).toBe('mark_item_revoked');
  });

  it('routes ITEM / PENDING_EXPIRATION to mark_item_revoked', () => {
    const r = routeWebhook({
      webhook_type: 'ITEM',
      webhook_code: 'PENDING_EXPIRATION',
      item_id: 'item_6',
    });
    expect(r.action.kind).toBe('mark_item_revoked');
  });

  it('ignores unknown webhook types', () => {
    const r = routeWebhook({
      webhook_type: 'AUTH',
      webhook_code: 'AUTOMATICALLY_VERIFIED',
      item_id: 'item_7',
    });
    expect(r.action.kind).toBe('ignore');
  });
});
