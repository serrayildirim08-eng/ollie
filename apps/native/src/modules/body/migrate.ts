/**
 * Body module · schema migration.
 *
 * Event-log shape: one `body_events` table with a JSON `data` column for
 * action-specific payload (amount mL, severity, supplement dose, …). This
 * keeps us out of the migrate-per-action treadmill the router would
 * otherwise force.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 */

import { sql } from '../../storage/sqlite';

const MIGRATIONS = [
  // body_events — every logged body moment (water, movement, symptom, …).
  `CREATE TABLE IF NOT EXISTS body_events (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // Index for the common UI query (most recent first + today filters).
  `CREATE INDEX IF NOT EXISTS idx_body_events_logged_at
    ON body_events(logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateBody(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
