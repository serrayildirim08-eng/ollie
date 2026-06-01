/**
 * Admin module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS, safe to call at every boot.
 * Lazy-singleton: the first caller starts the promise, subsequent callers
 * await the same one.
 *
 * Tables:
 *   admin_tasks                — generic checkable rows, classified by `kind`.
 *   admin_renewals             — renewal reminders with optional due_date for the
 *                                soonest-due surface at the top of the screen.
 *   admin_recurring_decisions  — "cancel netflix?" / "want to cancel chatgpt"
 *                                decisions the user needs to act on. Separate
 *                                table (not a kind on admin_tasks) so the snooze
 *                                + decision columns don't pollute the tasks schema.
 */

import { sql } from '../../storage';

interface PragmaColumnRow {
  name: string;
  [col: string]: unknown;
}

const CREATE_STATEMENTS = [
  // admin_tasks — generic todo / phone / appointment / paperwork / decision.
  `CREATE TABLE IF NOT EXISTS admin_tasks (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    text        TEXT NOT NULL,
    data        TEXT,
    done        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )`,

  // admin_renewals — first-class because of the due_date sort.
  `CREATE TABLE IF NOT EXISTS admin_renewals (
    id            TEXT PRIMARY KEY,
    renewal_type  TEXT NOT NULL,
    due_date      TEXT,
    added_at      INTEGER NOT NULL
  )`,

  // admin_recurring_decisions — subscription / service decisions from brain dump.
  // `decision` is set when the user acts (cancel / keep / later).
  // `snooze_until_ms` is set on "later" — listOpen filters out rows where
  // snooze_until_ms > now so they re-surface automatically after 7 days.
  `CREATE TABLE IF NOT EXISTS admin_recurring_decisions (
    id               TEXT PRIMARY KEY,
    what             TEXT NOT NULL,
    decision         TEXT,
    snooze_until_ms  INTEGER,
    created_at       INTEGER NOT NULL
  )`,

  // Index for the most-recent-first row order on /box/admin.
  `CREATE INDEX IF NOT EXISTS idx_admin_tasks_created_at
    ON admin_tasks(created_at DESC)`,

  // Soonest-due first — the primary query for the "upcoming renewals" surface.
  `CREATE INDEX IF NOT EXISTS idx_admin_renewals_due_date
    ON admin_renewals(due_date ASC)`,

  // Fallback ordering when no due_date is set (NULLs sort separately).
  `CREATE INDEX IF NOT EXISTS idx_admin_renewals_added_at
    ON admin_renewals(added_at DESC)`,

  // Most-recently-added decisions first.
  `CREATE INDEX IF NOT EXISTS idx_admin_recurring_decisions_created_at
    ON admin_recurring_decisions(created_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateAdmin(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of CREATE_STATEMENTS) {
        await sql.execute(stmt);
      }
      // Backfill: admin_recurring_decisions may exist without snooze_until_ms
      // if the table was created before this migration added the column.
      const cols = await sql.select<PragmaColumnRow>(
        `PRAGMA table_info(admin_recurring_decisions)`,
      );
      const have = new Set(cols.map((c) => c.name));
      if (!have.has('snooze_until_ms')) {
        await sql.execute(
          `ALTER TABLE admin_recurring_decisions ADD COLUMN snooze_until_ms INTEGER`,
        );
      }
      if (!have.has('decision')) {
        await sql.execute(
          `ALTER TABLE admin_recurring_decisions ADD COLUMN decision TEXT`,
        );
      }
    })();
  }
  return migrationPromise;
}
