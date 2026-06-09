/**
 * Finance module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Tables (each with its own DESC index on the time column the UI orders by):
 *   - finance_transactions       (occurred_at)   money OUT (spends)
 *   - finance_bills              (added_at)      recurring fixed obligations
 *   - finance_subscriptions      (added_at)      named services
 *   - finance_pending_decisions  (created_at)    pending money decisions
 *   - finance_income             (received_at)   money IN — 2026-05-31
 *   - finance_refunds            (refunded_at)   money back from a prior purchase — 2026-05-31
 *   - finance_reflections        (noted_at)      spending-pattern reflections — 2026-05-31
 *
 * Subscriptions carry an optional `amount` + `currency` so they can feed
 * the monthly-burn headline; older rows return null and contribute zero.
 * Both columns are backfilled with ADD COLUMN IF NOT EXISTS guards so the
 * migration stays idempotent against existing databases.
 *
 * `finance_pending_decisions` predates the dump-routed pending_decision
 * action; we extend its row shape with amount / currency / deadline /
 * decided_at_ms via PRAGMA-guarded ALTERs so the existing table is reused
 * rather than duplicated.
 */

import { sql } from '../../storage';

interface PragmaColumnRow {
  name: string;
  [col: string]: unknown;
}

const CREATE_STATEMENTS = [
  // finance_transactions — individual spend events.
  // `category` (2026-06-01) is a soft label (groceries/dining/transport/…
  // or freeform); nullable so brain-dump spends that never named one stay
  // valid. It unblocks the category-keyed watchers (hyperfocus burst,
  // duplicate-by-category) that read FinanceRecord.category via the bridge.
  `CREATE TABLE IF NOT EXISTS finance_transactions (
    id           TEXT PRIMARY KEY,
    amount       REAL,
    currency     TEXT,
    merchant     TEXT,
    category     TEXT,
    occurred_at  INTEGER NOT NULL
  )`,

  // finance_bills — recurring obligations.
  `CREATE TABLE IF NOT EXISTS finance_bills (
    id           TEXT PRIMARY KEY,
    merchant     TEXT NOT NULL,
    amount       REAL,
    currency     TEXT,
    cadence      TEXT,
    added_at     INTEGER NOT NULL
  )`,

  // finance_subscriptions — named services, deduped by lowercased name.
  // amount + currency added 2026-05-28; cadence added 2026-05-29 so a
  // yearly sub amortises correctly instead of counting as monthly.
  `CREATE TABLE IF NOT EXISTS finance_subscriptions (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    amount       REAL,
    currency     TEXT,
    cadence      TEXT,
    added_at     INTEGER NOT NULL
  )`,

  // finance_pending_decisions — "moving quote 2400", "solar panels proceed?"
  // decisions from brain dump that need user action. Separate table so snooze
  // semantics stay isolated from the transaction / bill / subscription schema.
  // amount/currency/deadline/decided_at_ms backfilled below (2026-05-31).
  `CREATE TABLE IF NOT EXISTS finance_pending_decisions (
    id               TEXT PRIMARY KEY,
    what             TEXT NOT NULL,
    decision         TEXT,
    snooze_until_ms  INTEGER,
    created_at       INTEGER NOT NULL
  )`,

  // finance_income — money IN (paycheck, freelance, gift). 2026-05-31.
  `CREATE TABLE IF NOT EXISTS finance_income (
    id           TEXT PRIMARY KEY,
    amount       REAL,
    currency     TEXT,
    source       TEXT,
    received_at  INTEGER NOT NULL
  )`,

  // finance_refunds — money back from a prior purchase. 2026-05-31.
  // `original_item` is the returned item when the user named it
  // ("returned the scarf"); merchant is the payer ("amazon refunded me").
  `CREATE TABLE IF NOT EXISTS finance_refunds (
    id             TEXT PRIMARY KEY,
    amount         REAL,
    currency       TEXT,
    merchant       TEXT,
    original_item  TEXT,
    refunded_at    INTEGER NOT NULL
  )`,

  // finance_spending_reflections — spending-pattern reflections (NOT
  // transactions). 2026-05-31. `note` is required; sentiment is a soft
  // enum stored as TEXT with a DB-level default for legacy rows.
  `CREATE TABLE IF NOT EXISTS finance_spending_reflections (
    id         TEXT PRIMARY KEY,
    note       TEXT NOT NULL,
    category   TEXT,
    sentiment  TEXT NOT NULL DEFAULT 'concerned',
    noted_at   INTEGER NOT NULL
  )`,

  // Indexes for the common UI query (most recent first).
  `CREATE INDEX IF NOT EXISTS idx_finance_transactions_occurred_at
    ON finance_transactions(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_bills_added_at
    ON finance_bills(added_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_subscriptions_added_at
    ON finance_subscriptions(added_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_pending_decisions_created_at
    ON finance_pending_decisions(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_income_received_at
    ON finance_income(received_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_refunds_refunded_at
    ON finance_refunds(refunded_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_spending_reflections_noted_at
    ON finance_spending_reflections(noted_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateFinance(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of CREATE_STATEMENTS) {
        await sql.execute(stmt);
      }
      // Backfill columns for databases created before subscriptions had
      // amount/currency. SQLite has no "ADD COLUMN IF NOT EXISTS" so we
      // probe with PRAGMA table_info first.
      const cols = await sql.select<PragmaColumnRow>(
        `PRAGMA table_info(finance_subscriptions)`,
      );
      const have = new Set(cols.map((c) => c.name));
      if (!have.has('amount')) {
        await sql.execute(`ALTER TABLE finance_subscriptions ADD COLUMN amount REAL`);
      }
      if (!have.has('currency')) {
        await sql.execute(`ALTER TABLE finance_subscriptions ADD COLUMN currency TEXT`);
      }
      if (!have.has('cadence')) {
        await sql.execute(`ALTER TABLE finance_subscriptions ADD COLUMN cadence TEXT`);
      }
      if (!have.has('canceled_at_ms')) {
        await sql.execute(`ALTER TABLE finance_subscriptions ADD COLUMN canceled_at_ms INTEGER`);
      }
      // Backfill columns on finance_pending_decisions (may exist from an older boot).
      const pdCols = await sql.select<PragmaColumnRow>(
        `PRAGMA table_info(finance_pending_decisions)`,
      );
      const havePd = new Set(pdCols.map((c) => c.name));
      if (!havePd.has('snooze_until_ms')) {
        await sql.execute(
          `ALTER TABLE finance_pending_decisions ADD COLUMN snooze_until_ms INTEGER`,
        );
      }
      if (!havePd.has('decision')) {
        await sql.execute(
          `ALTER TABLE finance_pending_decisions ADD COLUMN decision TEXT`,
        );
      }
      // 2026-05-31 — extend pending_decisions to carry the dump-routed
      // pending_decision shape (amount/currency/deadline/decided_at_ms).
      if (!havePd.has('amount')) {
        await sql.execute(
          `ALTER TABLE finance_pending_decisions ADD COLUMN amount REAL`,
        );
      }
      if (!havePd.has('currency')) {
        await sql.execute(
          `ALTER TABLE finance_pending_decisions ADD COLUMN currency TEXT`,
        );
      }
      if (!havePd.has('deadline')) {
        await sql.execute(
          `ALTER TABLE finance_pending_decisions ADD COLUMN deadline TEXT`,
        );
      }
      if (!havePd.has('decided_at_ms')) {
        await sql.execute(
          `ALTER TABLE finance_pending_decisions ADD COLUMN decided_at_ms INTEGER`,
        );
      }
      // 2026-06-01 — backfill `category` on finance_transactions for databases
      // created before the tap-to-log category picker existed. Additive +
      // nullable; legacy rows simply read null and skip the category watchers.
      const txCols = await sql.select<PragmaColumnRow>(
        `PRAGMA table_info(finance_transactions)`,
      );
      const haveTx = new Set(txCols.map((c) => c.name));
      if (!haveTx.has('category')) {
        await sql.execute(`ALTER TABLE finance_transactions ADD COLUMN category TEXT`);
      }
    })();
  }
  return migrationPromise;
}
