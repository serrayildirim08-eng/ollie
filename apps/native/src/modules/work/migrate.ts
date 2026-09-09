/**
 * Work module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * Tables:
 *   work_tasks            — todo + deadline rows (checkable)
 *   work_events           — append-only focus / meeting / distraction log
 *   work_scheduled_blocks — future booked deep-work blocks (1h-before cue)
 *   work_handoff_notes    — "asked Burhan to send the file" hand-off memory
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

  // work_scheduled_blocks — future booked deep-work blocks. The work
  // orchestrator's cue scan reads these (mirrored into work.scheduled_blocks)
  // and fires the "deep work ahead" reminder ~1h before start_ts.
  `CREATE TABLE IF NOT EXISTS work_scheduled_blocks (
    id           TEXT PRIMARY KEY,
    label        TEXT,
    start_ts     INTEGER NOT NULL,
    duration_min INTEGER,
    cancelled_at INTEGER,
    created_at   INTEGER NOT NULL
  )`,

  // work_handoff_notes — a thing handed to someone (or future-you),
  // remembered against an optional project until resolved.
  `CREATE TABLE IF NOT EXISTS work_handoff_notes (
    id          TEXT PRIMARY KEY,
    text        TEXT NOT NULL,
    project     TEXT,
    resolved_at INTEGER,
    ts          INTEGER NOT NULL
  )`,

  // Recency indexes for the common UI queries.
  `CREATE INDEX IF NOT EXISTS idx_work_tasks_created_at
    ON work_tasks(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_work_events_logged_at
    ON work_events(logged_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_work_scheduled_blocks_start_ts
    ON work_scheduled_blocks(start_ts ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_work_handoff_notes_ts
    ON work_handoff_notes(ts DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateWork(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
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
