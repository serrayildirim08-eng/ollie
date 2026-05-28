/**
 * Work module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Two tables:
 *   work_tasks   — todo + deadline rows (checkable)
 *   work_events  — append-only focus / meeting / distraction log
 *
 * Tauri's plugin-sql exposes plain SQLite; the browser-preview shim no-ops
 * which is fine (the in-memory shim doesn't persist anyway).
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  // work_tasks — checkable to-dos + deadlines.
  `CREATE TABLE IF NOT EXISTS work_tasks (
    id          TEXT PRIMARY KEY,
    text        TEXT NOT NULL,
    project     TEXT,
    kind        TEXT NOT NULL,
    due_date    TEXT,
    done        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )`,

  // work_events — append-only log; `data` is JSON shaped per `kind`.
  `CREATE TABLE IF NOT EXISTS work_events (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // Recency indexes for the common UI queries.
  `CREATE INDEX IF NOT EXISTS idx_work_tasks_created_at
    ON work_tasks(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_work_events_logged_at
    ON work_events(logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateWork(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
