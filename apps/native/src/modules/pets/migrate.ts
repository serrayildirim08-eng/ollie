/**
 * Pets module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Single events table. `kind` distinguishes care / observation / vet /
 * feed / supplement; `data` is a JSON blob holding the kind-specific
 * fields (no JOIN, no per-kind table). Index on logged_at DESC because
 * the UI sorts every section by recency.
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS pets_events (
    id          TEXT PRIMARY KEY,
    pet_name    TEXT,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pets_events_logged_at
    ON pets_events(logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migratePets(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
