/**
 * Chores module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Lazy-singleton: the first caller starts the promise, subsequent callers
 * await the same one (mirrors grocery/admin migrate).
 *
 * Tables:
 *   chores             — the registry: name + kind (one_off|recurring) +
 *                        cadence_days + last_done_at + done + created_at.
 *   chore_completion   — append-only completion log, keyed by normalised name.
 *                        This is the cadence source of truth ("how often do I
 *                        actually do this chore"), exactly like
 *                        grocery_purchase_log. The registry only holds the
 *                        latest state, so we can't recover cadence from it.
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS chores (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL,
    cadence_days  INTEGER,
    last_done_at  INTEGER,
    done          INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS chore_completion (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    completed_at  INTEGER NOT NULL
  )`,

  // Most-recent-first registry order on /box/chores.
  `CREATE INDEX IF NOT EXISTS idx_chores_created_at
    ON chores(created_at DESC)`,

  // Unique name index so the upsert (dedupe by normalised name) is O(1) and
  // a name can only ever own one registry row.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_chores_name
    ON chores(name)`,

  // Cadence reads scan the completion log per name, newest first.
  `CREATE INDEX IF NOT EXISTS idx_chore_completion_name_ts
    ON chore_completion(name, completed_at DESC)`,
];

/** Additive column migrations. SQLite has no "ADD COLUMN IF NOT EXISTS", so we
 *  run each ALTER and swallow the "duplicate column" error on re-boot — the
 *  table already carries the column on a device that's migrated once. */
const ADD_COLUMNS: string[] = [
  // weekdays: JSON array of local weekday ints [0=Sun..6=Sat] for
  // weekday-anchored recurring chores ("laundry on wednesdays"). NULL for
  // one-offs + interval chores. Pre-existing rows read back as null.
  `ALTER TABLE chores ADD COLUMN weekdays TEXT`,
];

function isDuplicateColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /duplicate column name/i.test(msg);
}

let migrationPromise: Promise<void> | null = null;

export function migrateChores(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
      for (const stmt of ADD_COLUMNS) {
        try {
          await sql.execute(stmt);
        } catch (e) {
          if (!isDuplicateColumnError(e)) throw e;
        }
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

/** Test-only: clear the memoised migration promise so a fresh in-memory DB
 *  re-runs the CREATE statements. No-op cost in production. */
export function _resetChoresMigration(): void {
  migrationPromise = null;
}
