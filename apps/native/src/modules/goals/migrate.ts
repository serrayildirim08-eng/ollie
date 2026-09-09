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

interface PragmaColumnRow {
  name: string;
  [col: string]: unknown;
}

const MIGRATIONS = [
  // goals_registry — the canonical list of goals the user is working on.
  // `name` is stored normalised (lowercase, collapsed whitespace) and is
  // UNIQUE so we can auto-register on first mention without dupes.
  //
  // Rich-capture columns (target_date / obstacle / premortem /
  // ulysses_contract) added 2026-05-29 (goals brief). They're nullable so
  // the dump auto-register path can still create a bare-name goal. Older
  // databases are backfilled below via the PRAGMA table_info guard.
  `CREATE TABLE IF NOT EXISTS goals_registry (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    why              TEXT,
    target_date      INTEGER,
    obstacle         TEXT,
    premortem        TEXT,
    ulysses_contract TEXT,
    created_at       INTEGER NOT NULL
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

  // goals_mood_log — tiny local mood-signal log feeding the low-mood
  // delete gate (brief G4). Native has no dump archive yet, so this is the
  // only mood source canDelete() reads. Kept small (recordMoodSignal caps
  // it to the last ~50 rows / 14 days).
  `CREATE TABLE IF NOT EXISTS goals_mood_log (
    id          TEXT PRIMARY KEY,
    text        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // Indexes for the common UI queries.
  `CREATE INDEX IF NOT EXISTS idx_goals_events_logged_at
    ON goals_events(logged_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_goals_events_goal_logged_at
    ON goals_events(goal_id, logged_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_goals_mood_log_logged_at
    ON goals_mood_log(logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateGoals(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
      // Backfill rich-capture columns for databases created before the
      // 2026-05-29 schema. SQLite has no "ADD COLUMN IF NOT EXISTS" so we
      // probe with PRAGMA table_info first.
      const cols = await sql.select<PragmaColumnRow>(
        `PRAGMA table_info(goals_registry)`,
      );
      const have = new Set(cols.map((c) => c.name));
      if (!have.has('target_date')) {
        await sql.execute(`ALTER TABLE goals_registry ADD COLUMN target_date INTEGER`);
      }
      if (!have.has('obstacle')) {
        await sql.execute(`ALTER TABLE goals_registry ADD COLUMN obstacle TEXT`);
      }
      if (!have.has('premortem')) {
        await sql.execute(`ALTER TABLE goals_registry ADD COLUMN premortem TEXT`);
      }
      if (!have.has('ulysses_contract')) {
        await sql.execute(`ALTER TABLE goals_registry ADD COLUMN ulysses_contract TEXT`);
      }
    })().catch((e) => {
      // A transient SQLite failure must not brick the module for the whole
      // session — clear the memo so the next call retries.
      migrationPromise = null;
      throw e;
    });
  }
  return migrationPromise;
}
