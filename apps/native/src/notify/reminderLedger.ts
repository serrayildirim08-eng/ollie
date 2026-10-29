/**
 * reminderLedger — the one local record of WHEN each reminder fires.
 *
 * The OS notification scheduler holds the fire time but can't be read back,
 * and the task rows only carry a day (`due_date`). The home screen needs the
 * clock time ("tue 14:00 — call mom"), so every schedule is mirrored here.
 *
 * Keyed by the same stable id every delivery path uses (`reminder:<taskId>`),
 * so a re-schedule (snooze, "when?" pick) upserts the one row — idempotent,
 * never a duplicate. Rows are never shown on their own: the home screen joins
 * them onto still-open to-dos, so a completed / deleted task drops out without
 * the ledger needing a cancel hook.
 *
 * Writes are fire-and-forget: a ledger failure must never block or break the
 * reminder itself.
 */

import { sql } from '../storage';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS reminder_ledger (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    fire_at     INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_ledger_task_id
    ON reminder_ledger(task_id)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateReminderLedger(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })().catch((e) => {
      migrationPromise = null;
      throw e;
    });
  }
  return migrationPromise;
}

export interface LedgerEntry {
  readonly taskId: string;
  readonly title: string;
  readonly body: string;
  readonly fireAt: number;
}

/** Upsert the fire time for a task's reminder. Never throws. */
export function recordReminder(taskId: string, title: string, body: string, fireAt: number): void {
  void (async () => {
    await migrateReminderLedger();
    await sql.execute(
      `INSERT INTO reminder_ledger (id, task_id, title, body, fire_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, body = excluded.body,
         fire_at = excluded.fire_at, updated_at = excluded.updated_at`,
      [`reminder:${taskId}`, taskId, title, body, fireAt, Date.now()],
    );
  })().catch((err) => {
    console.warn('[reminderLedger] record failed', err);
  });
}

interface LedgerRow {
  [col: string]: unknown;
  task_id: string;
  title: string;
  body: string;
  fire_at: number;
}

/** Latest fire time per task, keyed by task id. */
export async function loadLedger(): Promise<Map<string, LedgerEntry>> {
  await migrateReminderLedger();
  const rows = await sql.select<LedgerRow>(
    `SELECT task_id, title, body, fire_at FROM reminder_ledger`,
  );
  const out = new Map<string, LedgerEntry>();
  for (const r of rows) {
    out.set(r.task_id, {
      taskId: r.task_id,
      title: r.title,
      body: r.body,
      fireAt: Number(r.fire_at),
    });
  }
  return out;
}
