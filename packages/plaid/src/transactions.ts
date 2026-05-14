/**
 * @ollie/plaid · transaction fetch + normalize
 *
 * Two fetch paths exist on the Plaid side:
 *
 *   - /transactions/get      legacy, paginated, requires explicit window
 *   - /transactions/sync     newer, cursor-based, incremental
 *
 * ollie uses /transactions/sync for the worker cron + webhook-driven
 * pull (cursor lives in the `plaid_items` row). /transactions/get is
 * kept for the sandbox smoke script where we want a deterministic
 * "give me the last N days" assertion.
 *
 * Output: PlaidNormalizedTransaction → wired into FinanceRecord shape
 * by the caller. We do NOT touch ollie's store from this package; the
 * worker stages encrypted blobs into plaid_inbox and the client
 * re-encrypts + lands into finance_records on the next session.
 */

import type { PlaidApi } from 'plaid';
import type {
  PlaidNormalizedTransaction,
  PlaidTransactionShape,
} from './types';

// Re-export the Plaid-side transaction shape for consumers who need
// the raw type (e.g. tests asserting against fixture payloads).
export type PlaidTransaction = PlaidTransactionShape;

export interface FetchTransactionsInput {
  accessToken: string;
  /** ISO date YYYY-MM-DD. Default = 90 days ago. */
  startDate?: string;
  /** ISO date YYYY-MM-DD. Default = today. */
  endDate?: string;
  /** Max rows; Plaid caps at 500/page. Default 500. */
  count?: number;
  /** Pagination offset; default 0. */
  offset?: number;
}

export interface FetchTransactionsResult {
  transactions: PlaidNormalizedTransaction[];
  total_transactions: number;
  raw_count: number;
  request_id: string;
}

/**
 * Fetch a fixed window of transactions for an access_token. Use this
 * in tests / smoke scripts. The worker uses syncTransactionsCursor()
 * for incremental updates instead.
 */
export async function fetchTransactions(
  plaid: PlaidApi,
  input: FetchTransactionsInput,
): Promise<FetchTransactionsResult> {
  if (!input.accessToken) {
    throw new Error('@ollie/plaid · fetchTransactions: accessToken required');
  }
  const end = input.endDate ?? todayIso();
  const start = input.startDate ?? daysAgoIso(90);
  const count = Math.min(Math.max(input.count ?? 500, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);

  const r = await plaid.transactionsGet({
    access_token: input.accessToken,
    start_date: start,
    end_date: end,
    options: { count, offset },
  });

  const itemId = r.data.item.item_id;
  const rawTxns = r.data.transactions as unknown as PlaidTransactionShape[];

  return {
    transactions: rawTxns
      .filter((t) => !t.pending)
      .map((t) => normalizePlaidTransaction(t, itemId)),
    total_transactions: r.data.total_transactions,
    raw_count: rawTxns.length,
    request_id: r.data.request_id,
  };
}

export interface SyncCursorResult {
  /** Newly added or modified transactions, normalized. */
  added: PlaidNormalizedTransaction[];
  /** Transactions removed since the last cursor (use ids to tombstone). */
  removed_ids: string[];
  /**
   * Opaque cursor for the next call. Store this in `plaid_items.cursor`
   * (or its analogue) and pass back on the next call. First call may
   * pass an empty string / undefined.
   */
  next_cursor: string;
  /** Plaid signals more pages exist; caller should loop. */
  has_more: boolean;
  request_id: string;
}

/**
 * Cursor-based incremental sync — preferred path for the worker.
 *
 * On first call (cursor === undefined | ''), Plaid returns the full
 * historical window (up to 2 years). Subsequent calls return only
 * deltas. Cursor lifecycle: per (item_id, access_token) — store in
 * plaid_items.cursor.
 */
export async function syncTransactionsCursor(
  plaid: PlaidApi,
  input: {
    accessToken: string;
    cursor?: string;
    /** Plaid caps at 500/page on this endpoint too. */
    count?: number;
  },
): Promise<SyncCursorResult> {
  if (!input.accessToken) {
    throw new Error('@ollie/plaid · syncTransactionsCursor: accessToken required');
  }
  const r = await plaid.transactionsSync({
    access_token: input.accessToken,
    cursor: input.cursor || undefined,
    count: Math.min(Math.max(input.count ?? 500, 1), 500),
  });

  // We need item_id for the normalized record. /transactions/sync
  // does not include `item` in the response; the caller knows it
  // already (it's the row key), so we pass it through via a
  // post-step in the worker. For test/smoke convenience, plumb a
  // synthetic id when missing.
  const itemId =
    (r.data as unknown as { item_id?: string }).item_id ?? 'unknown_item';

  const added = (r.data.added as unknown as PlaidTransactionShape[])
    .filter((t) => !t.pending)
    .map((t) => normalizePlaidTransaction(t, itemId));
  const modified = (r.data.modified as unknown as PlaidTransactionShape[])
    .filter((t) => !t.pending)
    .map((t) => normalizePlaidTransaction(t, itemId));

  // We treat modified as added — same id will upsert. Caller dedupes.
  const merged = [...added, ...modified];

  return {
    added: merged,
    removed_ids: (r.data.removed ?? []).map(
      (rec: { transaction_id?: string }) => rec.transaction_id ?? '',
    ).filter(Boolean),
    next_cursor: r.data.next_cursor,
    has_more: r.data.has_more,
    request_id: r.data.request_id,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Normalization — PlaidTransaction → ollie's FinanceRecord-shaped row
// ──────────────────────────────────────────────────────────────────────────

/**
 * Map a single Plaid transaction to ollie's FinanceRecord shape.
 *
 * Sign convention (Plaid → ollie):
 *   Plaid: positive = money OUT of account (debit/outflow)
 *          negative = money IN (credit/inflow)
 *   ollie: `amount` is always positive; `direction: 'in' | 'out'`
 *          carries the sign.
 *
 * Merchant normalization:
 *   prefer `merchant_name` (Plaid-normalized) → fall back to `name`.
 *   `merchant_normalized` lowercases + trims to match ollie's existing
 *   pattern-matching merchant key.
 *
 * Category:
 *   prefer `personal_finance_category.detailed` (newer, richer) →
 *   fall back to the joined `category` array → null.
 */
export function normalizePlaidTransaction(
  t: PlaidTransactionShape,
  itemId: string,
): PlaidNormalizedTransaction {
  const merchant = t.merchant_name ?? t.name ?? null;
  const merchant_normalized = merchant
    ? merchant.toLowerCase().trim().replace(/\s+/g, ' ')
    : null;

  let category: string | null = null;
  if (t.personal_finance_category?.detailed) {
    category = t.personal_finance_category.detailed;
  } else if (t.category && t.category.length > 0) {
    category = t.category.join(' · ');
  }

  // Plaid stores debit as positive; flip sign for ollie's direction.
  const direction: 'in' | 'out' = t.amount >= 0 ? 'out' : 'in';
  const absAmount = Math.abs(t.amount);

  const currency =
    t.iso_currency_code ?? t.unofficial_currency_code ?? 'USD';

  return {
    id: t.transaction_id,
    event_date: t.date,
    amount: absAmount,
    currency,
    merchant,
    merchant_normalized,
    category,
    notes: null,
    direction,
    source: 'plaid',
    source_account_id: t.account_id,
    source_item_id: itemId,
    created_at: Date.now(),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// helpers (pure, deterministic — exported for tests)
// ──────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
