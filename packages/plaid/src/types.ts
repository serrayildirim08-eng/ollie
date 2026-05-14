/**
 * @ollie/plaid · narrow types
 *
 * Why this file exists:
 *   The official `plaid` npm package ships ~50 MB of types covering
 *   every product, including the ones we DELIBERATELY do not touch
 *   (transfer, payment_initiation, signal). Pulling those types into
 *   client/worker code muddies the surface and tempts a future
 *   contributor to "just call the transfer API". We keep a tiny set of
 *   narrowly-typed aliases here so:
 *
 *     - the public surface of @ollie/plaid is documented by hand
 *     - read-only is enforced at the type level, not just at runtime
 *     - downstream code (FinanceRecord normalizer, webhook router)
 *       depends on a stable shape that we control
 */

/** Opaque branded id types so they cannot be confused at call sites. */
export type PlaidItemId = string & { readonly __brand: 'PlaidItemId' };
export type PlaidAccessToken = string & { readonly __brand: 'PlaidAccessToken' };
export type PlaidPublicToken = string & { readonly __brand: 'PlaidPublicToken' };
export type PlaidAccountId = string & { readonly __brand: 'PlaidAccountId' };

/**
 * Subset of Plaid's `Transaction` object that we actually map into
 * ollie. Field names + nullability mirror the upstream contract. See
 * https://plaid.com/docs/api/products/transactions/#transactions-get-response-transactions
 */
export interface PlaidTransactionShape {
  /** Plaid's stable per-transaction id. */
  transaction_id: string;
  /** Plaid's stable per-account id. */
  account_id: string;
  /**
   * Signed amount in account currency. POSITIVE = money OUT of the
   * account (debit / outflow). NEGATIVE = money IN (credit / inflow).
   * ollie's `FinanceRecord.direction` flips this to `'in' | 'out'`
   * for human readability.
   */
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  /** YYYY-MM-DD. Date the transaction posted on the account. */
  date: string;
  /** ISO datetime if Plaid has it; fallback to `date`. */
  datetime: string | null;
  /** Merchant string as Plaid normalized it. May be null. */
  merchant_name: string | null;
  /** Raw merchant name from the bank feed. Usually present. */
  name: string;
  /** Pending-state — we suppress these on ingest to avoid dupes. */
  pending: boolean;
  /** Plaid's PFM category path. e.g. `['Food and Drink', 'Restaurants']`. */
  category: string[] | null;
  /** Per-account-set "personal finance" category (newer API). */
  personal_finance_category: {
    primary: string;
    detailed: string;
  } | null;
  /** Geolocation, when available. */
  location: {
    city: string | null;
    region: string | null;
    country: string | null;
  } | null;
  /** Payment metadata — we ignore for read-only ingest. */
  payment_channel: 'online' | 'in store' | 'other' | string;
}

/** ollie-side normalized record stitched into FinanceRecord. */
export interface PlaidNormalizedTransaction {
  /** Stable id we use as `FinanceRecord.id` — Plaid's transaction_id. */
  id: string;
  /** YYYY-MM-DD. */
  event_date: string;
  /** Positive number; direction tells inflow/outflow. */
  amount: number;
  currency: string;
  merchant: string | null;
  merchant_normalized: string | null;
  category: string | null;
  notes: string | null;
  direction: 'in' | 'out';
  /** Always 'plaid' so downstream can identify the source. */
  source: 'plaid';
  /** Plaid's account_id for cross-record joins. */
  source_account_id: string;
  /** Plaid's item_id (the bank connection) — useful for revocation. */
  source_item_id: string;
  /** Wall-clock the worker normalized this row (ms). */
  created_at: number;
}

/** Webhook event types we handle. Plaid sends many more we drop. */
export type PlaidWebhookCode =
  | 'INITIAL_UPDATE'
  | 'HISTORICAL_UPDATE'
  | 'DEFAULT_UPDATE'
  | 'TRANSACTIONS_REMOVED'
  | 'SYNC_UPDATES_AVAILABLE'
  | 'ERROR'
  | 'PENDING_EXPIRATION'
  | 'USER_PERMISSION_REVOKED';

export type PlaidWebhookType =
  | 'TRANSACTIONS'
  | 'ITEM'
  | 'AUTH'
  | 'IDENTITY';
