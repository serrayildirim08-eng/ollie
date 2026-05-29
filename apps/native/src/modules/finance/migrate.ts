/**
 * Finance module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Three tables, each carrying its own DESC index on the time column the UI
 * orders by (occurred_at for transactions, added_at for bills + subs).
 *
 * Subscriptions carry an optional `amount` + `currency` so they can feed
 * the monthly-burn headline; older rows return null and contribute zero.
 * Both columns are backfilled with ADD COLUMN IF NOT EXISTS guards so the
 * migration stays idempotent against existing databases.
 */

import { sql } from '../../storage';

interface PragmaColumnRow {
  name: string;
  [col: string]: unknown;
}

const CREATE_STATEMENTS = [
  // finance_transactions — individual spend events.
  `CREATE TABLE IF NOT EXISTS finance_transactions (
    id           TEXT PRIMARY KEY,
    amount       REAL,
    currency     TEXT,
    merchant     TEXT,
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

  // Indexes for the common UI query (most recent first).
  `CREATE INDEX IF NOT EXISTS idx_finance_transactions_occurred_at
    ON finance_transactions(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_bills_added_at
    ON finance_bills(added_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_subscriptions_added_at
    ON finance_subscriptions(added_at DESC)`,
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
    })();
  }
  return migrationPromise;
}
