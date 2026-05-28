/**
 * Finance module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Three tables, each carrying its own DESC index on the time column the UI
 * orders by (occurred_at for transactions, added_at for bills + subs).
 */

import { sql } from '../../storage';

const MIGRATIONS = [
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
  `CREATE TABLE IF NOT EXISTS finance_subscriptions (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
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
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
