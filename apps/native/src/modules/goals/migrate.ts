/**
 * Goals module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Tauri's plugin-sql exposes plain SQLite; the browser-preview shim no-ops
 * which is fine (the in-memory shim doesn't persist anyway).
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  // goals_registry — the canonical list of goals the user is working on.
  // `name` is stored normalised (lowercase, collapsed whitespace) and is
  // UNIQUE so we can auto-register on first mention without dupes.
  `CREATE TABLE IF NOT EXISTS goals_registry (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    why         TEXT,
    created_at  INTEGER NOT NULL
  )`,

  // goals_events — append-only log of progress / milestone / obstacle notes.
  // `goal_id` is nullable: events whose goal the router didn't name still
  // land here so the UI can surface them as "unassigned notes".
  `CREATE TABLE IF NOT EXISTS goals_events (
    id          TEXT PRIMARY KEY,
    goal_id     TEXT,
    kind        TEXT NOT NULL,
    text        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // Indexes for the common UI queries.
  `CREATE INDEX IF NOT EXISTS idx_goals_events_logged_at
    ON goals_events(logged_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_goals_events_goal_logged_at
    ON goals_events(goal_id, logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateGoals(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
