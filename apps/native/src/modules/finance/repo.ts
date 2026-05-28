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

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
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
  type MonthlyBurn,
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
  amount: number | null;
  currency: string | null;
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
      `SELECT id, name, amount, currency, added_at
       FROM finance_subscriptions
       ORDER BY added_at DESC`,
    );
    return rows.map(rowToSubscription);
  },

  /**
   * Dedupe by lowercased name — refreshes added_at on duplicate. If the
   * caller passes a non-null amount/currency, those overwrite the prior
   * values (so "netflix 15" then "netflix 18" lands the user on 18).
   * Nulls leave the prior values alone.
   */
  async add(input: {
    name: string;
    amount?: number | null;
    currency?: string | null;
  }): Promise<FinanceSubscription> {
    const name = normaliseSubscriptionName(input.name);
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const now = Date.now();

    const existing = await sql.select<SubscriptionRow>(
      `SELECT id, name, amount, currency, added_at
       FROM finance_subscriptions WHERE name = ? LIMIT 1`,
      [name],
    );
    if (existing.length > 0) {
      const row = existing[0]!;
      const nextAmount = amount ?? row.amount;
      const nextCurrency = currency ?? row.currency;
      await sql.execute(
        `UPDATE finance_subscriptions
            SET amount = ?, currency = ?, added_at = ?
          WHERE id = ?`,
        [nextAmount, nextCurrency, now, row.id],
      );
      return {
        id: row.id,
        name: row.name,
        amount: nextAmount,
        currency: nextCurrency,
        addedAt: now,
      };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO finance_subscriptions (id, name, amount, currency, added_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, amount, currency, now],
    );
    return { id, name, amount, currency, addedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_subscriptions WHERE id = ?`, [id]);
  },
};

// ─── monthly burn ─────────────────────────────────────────────────────────
//
// True monthly commitment = transactions logged this calendar month
// + monthly-equivalent of every active subscription
// + monthly-equivalent of every recurring bill.
//
// We bucket by currency because the user may track $ rent next to € coffee
// next to TRY groceries — mixing them would lie. Bills/subs with no
// amount or no cadence contribute nothing (they can still surface in the
// list, just not the headline).

const MONTHS_PER_YEAR = 12;
const WEEKS_PER_YEAR = 52;

/** Convert a bill's amount + cadence into its monthly-equivalent cost. */
function monthlyEquivalent(amount: number, cadence: Cadence | null): number {
  switch (cadence) {
    case 'monthly':
      return amount;
    case 'yearly':
      return amount / MONTHS_PER_YEAR;
    case 'weekly':
      return (amount * WEEKS_PER_YEAR) / MONTHS_PER_YEAR;
    case null:
    default:
      // Cadence-less bills can't be amortised honestly; treat as zero so
      // the headline never lies. They still show in the bills list.
      return 0;
  }
}

// ─── row mappers ──────────────────────────────────────────────────────────

function rowToTransaction(r: TransactionRow): FinanceTransaction {
  return {
    id: r.id,
    amount: r.amount,
    // Re-normalise on read so pre-fix rows ("dollars", "$") still group
    // cleanly with newer ISO-coded rows ("USD") in the "this month" total.
    currency: normaliseCurrency(r.currency),
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
    amount: r.amount,
    // Re-normalise on read so legacy "$"/"dollars" rows group with USD.
    currency: normaliseCurrency(r.currency),
    addedAt: r.added_at,
  };
}

/**
 * Compute the true monthly burn per currency.
 *
 * Returns one MonthlyBurn row per currency present across transactions
 * (this month), subscriptions and bills. Sorted biggest total first so the
 * UI can pick `[0]` for its headline. Null-currency rows group under one
 * "unparsed" bucket (currency: null) so the user still sees the leak.
 */
export async function getMonthlyBurn(): Promise<MonthlyBurn[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const [txRows, billRows, subRows] = await Promise.all([
    sql.select<TransactionRow>(
      `SELECT id, amount, currency, merchant, occurred_at
       FROM finance_transactions
       WHERE occurred_at >= ?`,
      [monthStart],
    ),
    sql.select<BillRow>(
      `SELECT id, merchant, amount, currency, cadence, added_at FROM finance_bills`,
    ),
    sql.select<SubscriptionRow>(
      `SELECT id, name, amount, currency, added_at FROM finance_subscriptions`,
    ),
  ]);

  const buckets = new Map<string, MonthlyBurn>();
  const keyOf = (c: string | null): string => c ?? '_';
  const ensure = (currency: string | null): MonthlyBurn => {
    const k = keyOf(currency);
    let row = buckets.get(k);
    if (!row) {
      row = { currency, transactions: 0, subscriptions: 0, billsDue: 0, total: 0 };
      buckets.set(k, row);
    }
    return row;
  };

  for (const r of txRows) {
    if (r.amount == null) continue;
    const currency = normaliseCurrency(r.currency);
    ensure(currency).transactions += r.amount;
  }
  for (const r of subRows) {
    if (r.amount == null) continue;
    const currency = normaliseCurrency(r.currency);
    ensure(currency).subscriptions += r.amount;
  }
  for (const r of billRows) {
    if (r.amount == null) continue;
    const cadence = (r.cadence as Cadence | null) ?? null;
    const monthly = monthlyEquivalent(r.amount, cadence);
    if (monthly === 0) continue;
    const currency = normaliseCurrency(r.currency);
    ensure(currency).billsDue += monthly;
  }

  for (const row of buckets.values()) {
    row.total = row.transactions + row.subscriptions + row.billsDue;
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Finance transactions are append-only with `occurred_at` timestamps and
// each row carries a normalised `merchant` key. The cadence signal: how
// often a given merchant shows up — coffee shops, rideshare, the gym.
//
// Bills + subscriptions are upsert-only (a single row per merchant /
// cadence pair) so they don't carry a usable timestamp stream — we skip
// cadence for those surfaces (the `cadence` column on bills is the
// router-asserted cadence, not an observed one).

export const cadence = {
  /**
   * Cadence for one merchant. Filters `finance_transactions` rows where
   * the normalised `merchant` matches. Caller can pass the raw label —
   * we normalise defensively so the row and the cadence keying stay in
   * lockstep with the writer.
   */
  async getMerchantCadenceFor(merchant: string | null): Promise<CadenceEstimate> {
    const key = normaliseMerchant(merchant);
    if (!key) return computeCadence([]);
    const rows = await sql.select<TransactionRow>(
      `SELECT id, amount, currency, merchant, occurred_at
       FROM finance_transactions
       WHERE merchant = ?
       ORDER BY occurred_at ASC`,
      [key],
    );
    return computeCadence(
      rows.map((r) => ({ ts: r.occurred_at, label: key })),
    );
  },
};
