/**
 * Admin module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS, safe to call at every boot.
 * Lazy-singleton: the first caller starts the promise, subsequent callers
 * await the same one.
 *
 * Tables:
 *   admin_tasks    — generic checkable rows, classified by `kind`.
 *   admin_renewals — renewal reminders with optional due_date for the
 *                    soonest-due surface at the top of the screen.
 */

import { sql } from '../../storage';

const MIGRATIONS = [
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

  // Index for the most-recent-first row order on /box/admin.
  `CREATE INDEX IF NOT EXISTS idx_admin_tasks_created_at
    ON admin_tasks(created_at DESC)`,

  // Soonest-due first — the primary query for the "upcoming renewals" surface.
  `CREATE INDEX IF NOT EXISTS idx_admin_renewals_due_date
    ON admin_renewals(due_date ASC)`,

  // Fallback ordering when no due_date is set (NULLs sort separately).
  `CREATE INDEX IF NOT EXISTS idx_admin_renewals_added_at
    ON admin_renewals(added_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateAdmin(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
