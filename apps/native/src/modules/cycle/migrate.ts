/**
 * Cycle module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Schema is deliberately narrow: one `cycle_events` table, every action
 * becomes one row, structured detail (symptom label) goes in a JSON
 * `data` column. Cheap to add new event kinds later without a migration.
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cycle_events (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    data         TEXT,
    occurred_at  INTEGER NOT NULL
  )`,

  // Index for the common UI query (most recent first).
  `CREATE INDEX IF NOT EXISTS idx_cycle_events_occurred_at
    ON cycle_events(occurred_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateCycle(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
