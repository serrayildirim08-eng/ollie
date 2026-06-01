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
  normaliseCategory,
  normaliseCurrency,
  normaliseMerchant,
  normaliseSentiment,
  normaliseSubscriptionName,
  type Cadence,
  type FinanceBill,
  type FinanceIncome,
  type FinanceRefund,
  type FinanceSpendingReflection,
  type FinanceSubscription,
  type FinanceTransaction,
  type MonthlyBurn,
  type ReflectionSentiment,
} from './types';

// Index signatures satisfy the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface TransactionRow {
  id: string;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  category: string | null;
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
  cadence: string | null;
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
      `SELECT id, amount, currency, merchant, category, occurred_at
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
    category?: string | null;
  }): Promise<FinanceTransaction> {
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const merchant = normaliseMerchant(input.merchant ?? null);
    const category = normaliseCategory(input.category ?? null);
    const now = Date.now();
    const id = newId();
    await sql.execute(
      `INSERT INTO finance_transactions (id, amount, currency, merchant, category, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, amount, currency, merchant, category, now],
    );
    return { id, amount, currency, merchant, category, occurredAt: now };
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
      `SELECT id, name, amount, currency, cadence, added_at
       FROM finance_subscriptions
       ORDER BY added_at DESC`,
    );
    return rows.map(rowToSubscription);
  },

  /**
   * Dedupe by lowercased name — refreshes added_at on duplicate. If the
   * caller passes a non-null amount/currency/cadence, those overwrite the
   * prior values (so "netflix 15" then "netflix 18" lands the user on 18).
   * Nulls leave the prior values alone.
   */
  async add(input: {
    name: string;
    amount?: number | null;
    currency?: string | null;
    cadence?: Cadence | null;
  }): Promise<FinanceSubscription> {
    const name = normaliseSubscriptionName(input.name);
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const cadence = normaliseCadence(input.cadence ?? null);
    const now = Date.now();

    const existing = await sql.select<SubscriptionRow>(
      `SELECT id, name, amount, currency, cadence, added_at
       FROM finance_subscriptions WHERE name = ? LIMIT 1`,
      [name],
    );
    if (existing.length > 0) {
      const row = existing[0]!;
      const nextAmount = amount ?? row.amount;
      const nextCurrency = currency ?? row.currency;
      const nextCadence = cadence ?? row.cadence;
      await sql.execute(
        `UPDATE finance_subscriptions
            SET amount = ?, currency = ?, cadence = ?, added_at = ?
          WHERE id = ?`,
        [nextAmount, nextCurrency, nextCadence, now, row.id],
      );
      return {
        id: row.id,
        name: row.name,
        amount: nextAmount,
        currency: nextCurrency,
        cadence: (nextCadence as Cadence | null) ?? null,
        addedAt: now,
      };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO finance_subscriptions (id, name, amount, currency, cadence, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, amount, currency, cadence, now],
    );
    return { id, name, amount, currency, cadence, addedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_subscriptions WHERE id = ?`, [id]);
  },

  /**
   * Mark all subscriptions whose name contains `name` (case-insensitive
   * word overlap) as canceled. Called when the user clicks "cancel" on an
   * `admin.recurring_decision` row.
   *
   * Uses a lowercase-contains match: "chatgpt subscription" → matches any
   * finance_subscriptions row whose `name` contains "chatgpt". The caller
   * should pass the normalised name extracted from the decision's `what`
   * field (first significant word).
   */
  async markCanceled(name: string, nowMs: number = Date.now()): Promise<void> {
    const key = name.trim().toLowerCase();
    if (!key) return;
    await sql.execute(
      `UPDATE finance_subscriptions
          SET canceled_at_ms = ?
        WHERE canceled_at_ms IS NULL
          AND LOWER(name) LIKE ?`,
      [nowMs, `%${key}%`],
    );
  },
};

// ─── pending decisions ────────────────────────────────────────────────────
//
// finance.pending_decision action — "moving quote 2400", "want to proceed
// with the solar panels". Backend-senior is shipping the handler in
// parallel; the repo surface is defined here so the /todo aggregate can
// wire up without waiting for the handler merge.

export interface PendingDecisionRow {
  id: string;
  /** The thing to decide on — e.g. "moving quote 2400". */
  what: string;
  /** Set when the user acts. Null while pending. */
  decision: 'proceed' | 'skip' | null;
  snoozeUntilMs: number | null;
  createdAt: number; // ms since epoch
  // 2026-05-31 — extended fields from the dump-routed pending_decision
  // action. Optional / null on rows added before the extension.
  amount: number | null;
  currency: string | null;
  deadline: string | null;
  decidedAtMs: number | null;
}

interface PendingDecisionDbRow {
  id: string;
  what: string;
  decision: string | null;
  snooze_until_ms: number | null;
  created_at: number;
  amount: number | null;
  currency: string | null;
  deadline: string | null;
  decided_at_ms: number | null;
  [col: string]: unknown;
}

const MS_PER_DAY_FIN = 86_400_000;
const SNOOZE_DAYS_FIN = 7;

export const pending = {
  /**
   * Add a pending decision row (from finance handler).
   *
   * Optional amount/currency/deadline accept the dump-routed
   * pending_decision shape ("moving quote 2400", "should I get the new
   * laptop?"). Plain "what"-only calls remain valid for non-dump callers.
   */
  async add(input: {
    what: string;
    amount?: number | null;
    currency?: string | null;
    deadline?: string | null;
  }): Promise<PendingDecisionRow> {
    const id = newId();
    const now = Date.now();
    const what = input.what.trim();
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const deadline = input.deadline?.trim() || null;
    await sql.execute(
      `INSERT INTO finance_pending_decisions
         (id, what, decision, snooze_until_ms, created_at, amount, currency, deadline, decided_at_ms)
       VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, NULL)`,
      [id, what, now, amount, currency, deadline],
    );
    return {
      id,
      what,
      decision: null,
      snoozeUntilMs: null,
      createdAt: now,
      amount,
      currency,
      deadline,
      decidedAtMs: null,
    };
  },

  /**
   * Open pending decisions for the /todo aggregate. Excludes acted-on rows
   * and currently-snoozed rows.
   */
  async listOpen(nowMs: number = Date.now()): Promise<PendingDecisionRow[]> {
    const rows = await sql.select<PendingDecisionDbRow>(
      `SELECT id, what, decision, snooze_until_ms, created_at,
              amount, currency, deadline, decided_at_ms
       FROM finance_pending_decisions
       WHERE decision IS NULL
         AND (snooze_until_ms IS NULL OR snooze_until_ms <= ?)
       ORDER BY created_at DESC`,
      [nowMs],
    );
    return rows.map(rowToPending);
  },

  /**
   * Record the user's decision.
   *
   * - 'proceed' / 'skip' → sets `decision`; row drops from listOpen.
   * - 'later'            → bumps snooze_until_ms forward 7 days.
   *
   * Uses `normalisePendingOutcome` for canonical validation before write.
   */
  async decide(
    id: string,
    decision: 'proceed' | 'skip' | 'later',
    nowMs: number = Date.now(),
  ): Promise<void> {
    if (decision === 'later') {
      const snoozeUntil = nowMs + SNOOZE_DAYS_FIN * MS_PER_DAY_FIN;
      await sql.execute(
        `UPDATE finance_pending_decisions SET snooze_until_ms = ? WHERE id = ?`,
        [snoozeUntil, id],
      );
    } else {
      // decision is statically 'proceed' | 'skip' here; no runtime
      // validation needed.
      await sql.execute(
        `UPDATE finance_pending_decisions
            SET decision = ?, decided_at_ms = ?
          WHERE id = ?`,
        [decision, nowMs, id],
      );
    }
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_pending_decisions WHERE id = ?`, [id]);
  },
};

function rowToPending(r: PendingDecisionDbRow): PendingDecisionRow {
  return {
    id: r.id,
    what: r.what,
    decision: r.decision as PendingDecisionRow['decision'],
    snoozeUntilMs: r.snooze_until_ms,
    createdAt: r.created_at,
    amount: r.amount ?? null,
    currency: normaliseCurrency(r.currency),
    deadline: r.deadline ?? null,
    decidedAtMs: r.decided_at_ms ?? null,
  };
}

// ─── income ───────────────────────────────────────────────────────────────
//
// Money IN. Mirrors the transactions shape but with `source` instead of
// `merchant`. Currency is normalised on read AND write so legacy "$"/"dollars"
// rows group cleanly with USD.

interface IncomeRow {
  id: string;
  amount: number | null;
  currency: string | null;
  source: string | null;
  received_at: number;
  [col: string]: unknown;
}

function rowToIncome(r: IncomeRow): FinanceIncome {
  return {
    id: r.id,
    amount: r.amount,
    currency: normaliseCurrency(r.currency),
    source: r.source,
    receivedAt: r.received_at,
  };
}

export const income = {
  async add(input: {
    amount?: number | null;
    currency?: string | null;
    source?: string | null;
  }): Promise<FinanceIncome> {
    const id = newId();
    const now = Date.now();
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const source = input.source?.toLowerCase().trim() || null;
    await sql.execute(
      `INSERT INTO finance_income (id, amount, currency, source, received_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, amount, currency, source, now],
    );
    return { id, amount, currency, source, receivedAt: now };
  },

  async list(): Promise<FinanceIncome[]> {
    const rows = await sql.select<IncomeRow>(
      `SELECT id, amount, currency, source, received_at
       FROM finance_income
       ORDER BY received_at DESC`,
    );
    return rows.map(rowToIncome);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_income WHERE id = ?`, [id]);
  },
};

// ─── refunds ──────────────────────────────────────────────────────────────
//
// Money returned from a prior purchase. `originalItem` is the returned item
// when the user named it; merchant is the payer.

interface RefundRow {
  id: string;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  original_item: string | null;
  refunded_at: number;
  [col: string]: unknown;
}

function rowToRefund(r: RefundRow): FinanceRefund {
  return {
    id: r.id,
    amount: r.amount,
    currency: normaliseCurrency(r.currency),
    merchant: r.merchant,
    originalItem: r.original_item,
    refundedAt: r.refunded_at,
  };
}

export const refunds = {
  async add(input: {
    amount?: number | null;
    currency?: string | null;
    merchant?: string | null;
    originalItem?: string | null;
  }): Promise<FinanceRefund> {
    const id = newId();
    const now = Date.now();
    const amount = input.amount ?? null;
    const currency = normaliseCurrency(input.currency ?? null);
    const merchant = normaliseMerchant(input.merchant ?? null);
    const originalItem = input.originalItem?.trim() || null;
    await sql.execute(
      `INSERT INTO finance_refunds (id, amount, currency, merchant, original_item, refunded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, amount, currency, merchant, originalItem, now],
    );
    return { id, amount, currency, merchant, originalItem, refundedAt: now };
  },

  async list(): Promise<FinanceRefund[]> {
    const rows = await sql.select<RefundRow>(
      `SELECT id, amount, currency, merchant, original_item, refunded_at
       FROM finance_refunds
       ORDER BY refunded_at DESC`,
    );
    return rows.map(rowToRefund);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_refunds WHERE id = ?`, [id]);
  },
};

// ─── spending reflections ─────────────────────────────────────────────────
//
// A reflection on a SPENDING PATTERN, not a single transaction. `note` is
// required; `category` + `sentiment` are optional.

interface ReflectionRow {
  id: string;
  note: string;
  category: string | null;
  sentiment: string;
  noted_at: number;
  [col: string]: unknown;
}

function rowToReflection(r: ReflectionRow): FinanceSpendingReflection {
  return {
    id: r.id,
    note: r.note,
    category: r.category,
    sentiment: normaliseSentiment(r.sentiment),
    notedAt: r.noted_at,
  };
}

export const reflections = {
  async add(input: {
    note: string;
    category?: string | null;
    sentiment?: string | null;
  }): Promise<FinanceSpendingReflection> {
    const id = newId();
    const now = Date.now();
    const note = input.note.trim();
    const category = input.category?.trim() || null;
    const sentiment: ReflectionSentiment = normaliseSentiment(input.sentiment ?? null);
    await sql.execute(
      `INSERT INTO finance_spending_reflections (id, note, category, sentiment, noted_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, note, category, sentiment, now],
    );
    return { id, note, category, sentiment, notedAt: now };
  },

  async list(): Promise<FinanceSpendingReflection[]> {
    const rows = await sql.select<ReflectionRow>(
      `SELECT id, note, category, sentiment, noted_at
       FROM finance_spending_reflections
       ORDER BY noted_at DESC`,
    );
    return rows.map(rowToReflection);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM finance_spending_reflections WHERE id = ?`, [id]);
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
    category: r.category ?? null,
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
    cadence: (r.cadence as Cadence | null) ?? null,
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
      `SELECT id, name, amount, currency, cadence, added_at FROM finance_subscriptions`,
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
    // Null cadence defaults to monthly (subscriptions were assumed monthly
    // before cadence existed); a known yearly/weekly cadence amortises so a
    // $120/yr sub adds $10/mo, not $120/mo.
    const cadence = (r.cadence as Cadence | null) ?? 'monthly';
    const monthly = monthlyEquivalent(r.amount, cadence);
    const currency = normaliseCurrency(r.currency);
    ensure(currency).subscriptions += monthly;
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
