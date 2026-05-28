/**
 * Grocery module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Tauri's plugin-sql exposes plain SQLite; the browser-preview shim no-ops
 * which is fine (the in-memory shim doesn't persist anyway).
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  // pantry_items — what you have at home.
  `CREATE TABLE IF NOT EXISTS grocery_pantry (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    quantity    REAL,
    unit        TEXT,
    added_at    INTEGER NOT NULL,
    low_flag    INTEGER NOT NULL DEFAULT 0
  )`,

  // shopping_list — what you need to buy.
  `CREATE TABLE IF NOT EXISTS grocery_shopping (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    quantity    REAL,
    unit        TEXT,
    added_at    INTEGER NOT NULL
  )`,

  // grocery_purchase_log — append-only restock history, used by the
  // local @ollie/cadence layer to learn "you buy X every ~N days".
  // Intentionally distinct from the cloud `grocery_purchase_history`
  // table (cloud sync side); this one stays local and never syncs.
  `CREATE TABLE IF NOT EXISTS grocery_purchase_log (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // Index for the common UI query (most recent first).
  `CREATE INDEX IF NOT EXISTS idx_grocery_pantry_added_at
    ON grocery_pantry(added_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_grocery_shopping_added_at
    ON grocery_shopping(added_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_grocery_purchase_log_name_ts
    ON grocery_purchase_log(name, logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateGrocery(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
