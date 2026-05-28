/**
 * Sleep module · schema migration.
 *
 * One table — `sleep_events` — holds all four kinds (sleep / wind_down /
 * dream / insomnia). Kind-specific fields ride in `data` as JSON so the
 * column list stays narrow and we don't have to migrate every time the
 * router learns a new sub-shape.
 *
 * Promised once per session so concurrent callers share a single run.
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  // One row per sleep event. `kind` discriminates the JSON in `data`.
  // `occurred_at` is the timestamp the UI sorts/groups by — for kind='sleep'
  // we prefer the wake date when known, else the logged time (handler enforces).
  `CREATE TABLE IF NOT EXISTS sleep_events (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    data         TEXT NOT NULL,
    occurred_at  INTEGER NOT NULL
  )`,

  // The dominant query is "most recent first" — by kind or across all kinds.
  `CREATE INDEX IF NOT EXISTS idx_sleep_events_occurred_at
    ON sleep_events(occurred_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateSleep(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
