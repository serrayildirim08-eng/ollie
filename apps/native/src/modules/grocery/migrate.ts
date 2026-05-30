/**
 * Grocery module · schema migration.
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
  // pantry_items — what you have at home. `added_at` IS the aging clock;
  // `archived_at_ms` (added 2026-05-30 for the shelf-life aging surface) is
  // null while the row is live and set when the row leaves the active list
  // — either via auto-archive at shelfLife × 2.0 or the user marking gone.
  `CREATE TABLE IF NOT EXISTS grocery_pantry (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    quantity        REAL,
    unit            TEXT,
    added_at        INTEGER NOT NULL,
    low_flag        INTEGER NOT NULL DEFAULT 0,
    archived_at_ms  INTEGER
  )`,

  // shopping_list — what you need to buy.
  `CREATE TABLE IF NOT EXISTS grocery_shopping (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    quantity    REAL,
    unit        TEXT,
    added_at    INTEGER NOT NULL
  )`,

  // grocery_purchase_log — append-only restock history, used by the
  // local @ollie/cadence layer to learn "you buy X every ~N days".
  // Intentionally distinct from the cloud `grocery_purchase_history`
  // table (cloud sync side); this one stays local and never syncs.
  `CREATE TABLE IF NOT EXISTS grocery_purchase_log (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    logged_at   INTEGER NOT NULL
  )`,

  // cook_history — local mirror of the cloud cook_history events written by
  // the /cook-history worker. Used by the Feed Me view's "made recently"
  // strip so the user sees their own cooking without a round-trip on every
  // mount. Cloud row is the source of truth for the learning signal; this
  // table is a UI cache, no encryption, no sync. JSON ingredients column
  // is a serialised RecipeIngredient[] (just `name` + `canonical` actually
  // round-trip — we don't surface qty/unit in the strip).
  `CREATE TABLE IF NOT EXISTS grocery_cook_history (
    id           TEXT PRIMARY KEY,
    recipe_name  TEXT NOT NULL,
    ingredients  TEXT,
    cooked_at_ms INTEGER NOT NULL
  )`,

  // Index for the common UI query (most recent first).
  `CREATE INDEX IF NOT EXISTS idx_grocery_pantry_added_at
    ON grocery_pantry(added_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_grocery_shopping_added_at
    ON grocery_shopping(added_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_grocery_purchase_log_name_ts
    ON grocery_purchase_log(name, logged_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_grocery_cook_history_cooked_at
    ON grocery_cook_history(cooked_at_ms DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateGrocery(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }

      // ── pantry aging backfill (2026-05-30) ──────────────────────────────
      // The shelf-life × {1, 1.5, 2}× aging surface needs an `archived_at_ms`
      // column on grocery_pantry. The existing `added_at` column is already
      // ms-since-epoch (see repo.ts: "All times are ms-since-epoch integers"),
      // so we reuse it as the row's "added at" clock rather than duplicating
      // the field. `pantry.touch()` resets THIS column.
      //
      // SQLite has no "ADD COLUMN IF NOT EXISTS"; we probe with
      // PRAGMA table_info first so the migration is idempotent for users
      // already on the older schema. New tables created above already have
      // the column shape — the ALTER is the backfill path only.
      const cols = await sql.select<PragmaColumnRow>(
        `PRAGMA table_info(grocery_pantry)`,
      );
      const have = new Set(cols.map((c) => c.name));
      if (!have.has('archived_at_ms')) {
        await sql.execute(
          `ALTER TABLE grocery_pantry ADD COLUMN archived_at_ms INTEGER`,
        );
      }
      // Partial index — only archived rows. The active-list query (the hot
      // path) is unchanged and continues to use idx_grocery_pantry_added_at.
      await sql.execute(
        `CREATE INDEX IF NOT EXISTS idx_grocery_pantry_archived_at_ms
           ON grocery_pantry(archived_at_ms DESC)
           WHERE archived_at_ms IS NOT NULL`,
      );
    })();
  }
  return migrationPromise;
}
