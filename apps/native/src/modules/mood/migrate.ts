/**
 * Mood module · schema migration.
 *
 * Event-log shape: one `mood_events` table with a JSON `data` column for
 * action-specific payload (mood label + valence, energy level, self-talk
 * statement, …). This keeps us out of the migrate-per-action treadmill the
 * router would otherwise force.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 */

import { sql } from '../../storage/sqlite';

const MIGRATIONS = [
  // mood_events — every logged mood moment (mood / energy / self-talk).
  `CREATE TABLE IF NOT EXISTS mood_events (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // Index for the common UI query (most recent first + today filters).
  `CREATE INDEX IF NOT EXISTS idx_mood_events_logged_at
    ON mood_events(logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateMood(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
