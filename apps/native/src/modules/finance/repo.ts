/**
 * Finance module · repository.
 *
 * Thin typed wrapper over the SQLite layer. All SQL strings live here so
 * handler + UI stay query-agnostic.
 *
 * Conventions:
 *   - `transactions.add` never dedupes — every spend is its own row, even
 *     duplicates ("spent $4 coffee" twice = two rows).
 *   - `bills.add` dedupes by lowercased merchant + cadence pair — adding
 *     "netflix monthly" twice updates the existing row.
 *   - `subscriptions.add` dedupes by lowercased name and refreshes the
 *     timestamp on duplicate.
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 */

import { sql } from '../../storage';
import {
  normaliseCadence,
  normaliseCurrency,
  normaliseMerchant,
  normaliseSubscriptionName,
  type Cadence,
  type FinanceBill,
  type FinanceSubscription,
  type FinanceTransaction,
} from './types';

// Index signatures satisfy the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface TransactionRow {
  id: string;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  occurred_at: number;
  [col: string]: unknown;
}

interface BillRow {
  id: string;
  merchant: string;
  amount: number | null;
  currency: string | null;
  cadence: string | null;
  added_at: number;
  [col: string]: unknown;
}

interface SubscriptionRow {
  id: string;
  name: string;
  added_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── transactions ─────────────────────────────────────────────────────────

export const transactions = {
  async list(): Promise<FinanceTransaction[]> {
    const rows = await sql.select<TransactionRow>(
      `SELECT id, amount, currency, merchant, occurred_at
       FROM finance_transactions
       ORDER BY occurred_at DESC`,
    );
    return rows.map(rowToTransaction);
  },

  /** Insert a spend event. Never dedupes — each dump is its own row. */
  async add(input: {
    amount?: number | null;
    currency?: string | null;
    merchant?: string | null;
  }): Promise<FinanceTransaction> {
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const merchant = normaliseMerchant(input.merchant ?? null);
    const now = Date.now();
    const id = newId();
    await sql.execute(
      `INSERT INTO finance_transactions (id, amount, currency, merchant, occurred_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, amount, currency, merchant, now],
    );
    return { id, amount, currency, merchant, occurredAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_transactions WHERE id = ?`, [id]);
  },
};

// ─── bills ────────────────────────────────────────────────────────────────

export const bills = {
  async list(): Promise<FinanceBill[]> {
    const rows = await sql.select<BillRow>(
      `SELECT id, merchant, amount, currency, cadence, added_at
       FROM finance_bills
       ORDER BY added_at DESC`,
    );
    return rows.map(rowToBill);
  },

  /**
   * Add or refresh a bill. Dedupe key is (lowercased merchant, cadence) —
   * "netflix monthly" twice updates the same row; "netflix monthly" then
   * "netflix yearly" produces two rows.
   */
  async add(input: {
    merchant: string;
    amount?: number | null;
    currency?: string | null;
    cadence?: string | null;
  }): Promise<FinanceBill> {
    const merchant = normaliseMerchant(input.merchant) ?? input.merchant.trim();
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const cadence = normaliseCadence(input.cadence ?? null);
    const now = Date.now();

    const existing = await sql.select<BillRow>(
      `SELECT id, merchant, amount, currency, cadence, added_at
       FROM finance_bills
       WHERE merchant = ? AND (cadence IS ? OR cadence = ?)
       LIMIT 1`,
      [merchant, cadence, cadence],
    );

    if (existing.length > 0) {
      const row = existing[0]!;
      const nextAmount = amount ?? row.amount;
      const nextCurrency = currency ?? row.currency;
      await sql.execute(
        `UPDATE finance_bills
           SET amount = ?, currency = ?, added_at = ?
         WHERE id = ?`,
        [nextAmount, nextCurrency, now, row.id],
      );
      return {
        id: row.id,
        merchant: row.merchant,
        amount: nextAmount,
        currency: nextCurrency,
        cadence: (row.cadence as Cadence | null) ?? null,
        addedAt: now,
      };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO finance_bills (id, merchant, amount, currency, cadence, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, merchant, amount, currency, cadence, now],
    );
    return { id, merchant, amount, currency, cadence, addedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_bills WHERE id = ?`, [id]);
  },
};

// ─── subscriptions ────────────────────────────────────────────────────────

export const subscriptions = {
  async list(): Promise<FinanceSubscription[]> {
    const rows = await sql.select<SubscriptionRow>(
      `SELECT id, name, added_at
       FROM finance_subscriptions
       ORDER BY added_at DESC`,
    );
    return rows.map(rowToSubscription);
  },

  /** Dedupe by lowercased name — refreshes added_at on duplicate. */
  async add(input: { name: string }): Promise<FinanceSubscription> {
    const name = normaliseSubscriptionName(input.name);
    const now = Date.now();

    const existing = await sql.select<SubscriptionRow>(
      `SELECT id, name, added_at FROM finance_subscriptions WHERE name = ? LIMIT 1`,
      [name],
    );
    if (existing.length > 0) {
      const row = existing[0]!;
      await sql.execute(
        `UPDATE finance_subscriptions SET added_at = ? WHERE id = ?`,
        [now, row.id],
      );
      return { id: row.id, name: row.name, addedAt: now };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO finance_subscriptions (id, name, added_at)
       VALUES (?, ?, ?)`,
      [id, name, now],
    );
    return { id, name, addedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_subscriptions WHERE id = ?`, [id]);
  },
};

// ─── row mappers ──────────────────────────────────────────────────────────

function rowToTransaction(r: TransactionRow): FinanceTransaction {
  return {
    id: r.id,
    amount: r.amount,
    currency: r.currency,
    merchant: r.merchant,
    occurredAt: r.occurred_at,
  };
}

function rowToBill(r: BillRow): FinanceBill {
  return {
    id: r.id,
    merchant: r.merchant,
    amount: r.amount,
    currency: r.currency,
    cadence: (r.cadence as Cadence | null) ?? null,
    addedAt: r.added_at,
  };
}

function rowToSubscription(r: SubscriptionRow): FinanceSubscription {
  return {
    id: r.id,
    name: r.name,
    addedAt: r.added_at,
  };
}
