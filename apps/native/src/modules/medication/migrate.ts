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

interface PragmaColumnRow {
  name: string;
  [col: string]: unknown;
}

const MIGRATIONS = [
  // Registry — one row per medication, keyed on normalised name.
  // `kind` + `schedule` added 2026-06-01 (structured-capture build):
  //   kind     — 'prescription' | 'vitamin' | 'supplement' | 'otc'
  //   schedule — JSON array of "HH:MM" 24h-local strings, e.g. ["09:00"]
  // Fresh databases get the columns here; pre-existing rows are backfilled
  // via the PRAGMA table_info guard below.
  `CREATE TABLE IF NOT EXISTS medications_registry (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'prescription',
    schedule    TEXT NOT NULL DEFAULT '[]'
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

  // Cabinet inventory — the "stock" view (the cabinet tab), one row per
  // med/supplement, grouped BY PURPOSE in the UI. Separate from the registry
  // (which answers "what do I take + when"); this answers "what do I have +
  // is it low". Keyed unique on normalised name so re-adds dedupe.
  //   purpose    — sleep | mood | pain | digestion | vitamins | other
  //   dose_label — free text ("400mg", "2000 IU") or NULL
  //   qty        — units remaining, or NULL when never counted (manual-only)
  //   low_flag   — manual "running low" override (0/1), wins over count-down
  // The append-only "taken" intake log reuses medications_events(kind='dose')
  // — no separate table; that stream is already chores-completion-log style.
  `CREATE TABLE IF NOT EXISTS medication_cabinet (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    purpose     TEXT NOT NULL DEFAULT 'other',
    dose_label  TEXT,
    qty         INTEGER,
    low_flag    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )`,

  // Newest-first cabinet order.
  `CREATE INDEX IF NOT EXISTS idx_medication_cabinet_created_at
    ON medication_cabinet(created_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateMedication(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
      // Backfill kind + schedule for databases created before the
      // 2026-06-01 structured-capture schema. SQLite has no
      // "ADD COLUMN IF NOT EXISTS" so we probe table_info first. Both
      // columns are additive with safe defaults — existing rows keep
      // their data and gain kind='prescription', schedule='[]'.
      const cols = await sql.select<PragmaColumnRow>(
        `PRAGMA table_info(medications_registry)`,
      );
      const have = new Set(cols.map((c) => c.name));
      if (!have.has('kind')) {
        await sql.execute(
          `ALTER TABLE medications_registry ADD COLUMN kind TEXT NOT NULL DEFAULT 'prescription'`,
        );
      }
      if (!have.has('schedule')) {
        await sql.execute(
          `ALTER TABLE medications_registry ADD COLUMN schedule TEXT NOT NULL DEFAULT '[]'`,
        );
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
