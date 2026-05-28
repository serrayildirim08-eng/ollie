/**
 * Medication module · schema migration.
 *
 * Two tables: `medications_registry` (one row per medication, unique on
 * normalised name) and `medications_events` (the log — doses, misses,
 * side-effect notes). Indexed for the common UI queries:
 *   - newest events first (logged_at DESC)
 *   - newest events per medication (med_id, logged_at DESC)
 *
 * CREATE TABLE IF NOT EXISTS is safe at every boot; the promise is cached
 * so concurrent first-callers share a single migration run.
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  // Registry — one row per medication, keyed on normalised name.
  `CREATE TABLE IF NOT EXISTS medications_registry (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL
  )`,

  // Events — every dose / missed / side-effect lands here.
  `CREATE TABLE IF NOT EXISTS medications_events (
    id          TEXT PRIMARY KEY,
    med_id      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL,
    FOREIGN KEY (med_id) REFERENCES medications_registry(id)
  )`,

  // Newest-first scan (today / recent surfaces).
  `CREATE INDEX IF NOT EXISTS idx_medications_events_logged_at
    ON medications_events(logged_at DESC)`,

  // Per-medication newest-first (last-dose lookups).
  `CREATE INDEX IF NOT EXISTS idx_medications_events_med_logged
    ON medications_events(med_id, logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateMedication(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
