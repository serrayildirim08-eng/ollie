/**
 * native/storage/migrate.ts — central SQLite migration runner.
 *
 * Before this, each module hand-rolled `CREATE TABLE IF NOT EXISTS` plus
 * ad-hoc `PRAGMA table_info` column backfills, with no record of what had run.
 * This adds one shared, versioned mechanism so incremental schema changes
 * (admin due dates, ball_state, last_transition_at, …) apply exactly once,
 * safely, and idempotently — and tables never have to "magically exist".
 *
 * Versioning model: a ledger table `_ollie_migrations(name, applied_at)`. Each
 * migration has a globally-unique, stable `name` (prefix with the module, e.g.
 * 'admin:0001_due_date'). A migration is recorded ONLY after its `up()`
 * resolves, so:
 *   - re-running is a no-op (already-applied names are skipped) — idempotent;
 *   - a failure stops the run and a later re-run RESUMES from the failed step;
 *   - declared order is preserved.
 *
 * A ledger (vs PRAGMA user_version) avoids cross-module version collisions —
 * every module can register its own migrations independently.
 *
 * Note: the production `sql` shim is a no-op in browser preview, so migrations
 * are inert there (no SQLite to migrate); they run for real under Tauri.
 */

import { sql } from './sqlite';

export interface Migration {
  /** Globally-unique, stable id. Prefix with the module: 'admin:0001_due_date'. */
  name: string;
  /** The schema change. Should itself be safe to attempt (see addColumnIfMissing). */
  up: () => Promise<void>;
}

const LEDGER = '_ollie_migrations';

interface PragmaColumnRow {
  name: string;
  [col: string]: unknown;
}

/**
 * Apply the given migrations in order, each at most once, tracked in the
 * `_ollie_migrations` ledger. Idempotent + resume-safe (see file header).
 */
export async function runMigrations(migrations: Migration[]): Promise<void> {
  await sql.execute(
    `CREATE TABLE IF NOT EXISTS ${LEDGER} (
      name        TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    )`,
  );
  const rows = await sql.select<{ name: string }>(`SELECT name FROM ${LEDGER}`);
  const done = new Set(rows.map((r) => r.name));

  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await m.up(); // throws → loop aborts; this migration is NOT recorded → re-run resumes here
    await sql.execute(`INSERT INTO ${LEDGER} (name, applied_at) VALUES (?, ?)`, [
      m.name,
      Date.now(),
    ]);
  }
}

/**
 * Idempotently add a column: ALTER only when `PRAGMA table_info` shows it's
 * missing. Safe even outside a migration and safe when a fresh-DB baseline
 * CREATE already declared the column (then it's a no-op) — so the same column
 * can live in both the baseline CREATE (for fresh installs) and an ALTER
 * migration (for existing installs) without a "duplicate column" error.
 */
export async function addColumnIfMissing(
  table: string,
  column: string,
  columnDef: string,
): Promise<void> {
  const cols = await sql.select<PragmaColumnRow>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  await sql.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
}

/** Test/diagnostic helper: names of migrations recorded as applied. */
export async function appliedMigrations(): Promise<string[]> {
  const rows = await sql.select<{ name: string }>(
    `SELECT name FROM ${LEDGER} ORDER BY applied_at ASC, name ASC`,
  );
  return rows.map((r) => r.name);
}
