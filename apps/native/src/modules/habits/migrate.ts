/**
 * Habits module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot and
 * memoised via `migrationPromise` so concurrent callers share one run.
 *
 * Three tables:
 *   - habits_registry     · canonical habit list (name unique, lowercased)
 *   - habits_completions  · one row per "did the thing" event
 *   - habits_events       · streak-break notes + identity statements
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  // Registry — the canonical list of habits the user has ever performed.
  `CREATE TABLE IF NOT EXISTS habits_registry (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL
  )`,

  // Completions — append-only log of "did this habit at this time".
  `CREATE TABLE IF NOT EXISTS habits_completions (
    id            TEXT PRIMARY KEY,
    habit_id      TEXT NOT NULL,
    completed_at  INTEGER NOT NULL,
    FOREIGN KEY (habit_id) REFERENCES habits_registry(id)
  )`,

  // Events — streak breaks + identity statements, not tied to a specific
  // habit row by FK (identity statements have no habit; breaks reference
  // by name to survive habit deletion).
  `CREATE TABLE IF NOT EXISTS habits_events (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // Indexes — the common per-habit timeline query + recent-events query.
  `CREATE INDEX IF NOT EXISTS idx_habits_completions_habit_time
    ON habits_completions(habit_id, completed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_habits_events_logged_at
    ON habits_events(logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateHabits(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
