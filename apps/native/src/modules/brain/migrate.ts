/**
 * Brain module · schema migration.
 *
 * One-shot CREATE TABLE IF NOT EXISTS — safe to call at every app boot.
 * Promised once per session so concurrent callers share a single run.
 *
 * `brain_harm_events` is the persisted output of the harm-of-deferral
 * detector (packages/logic/src/brain/harm.ts): the automatic record of when
 * letting something slide caused real harm (a spoiled pantry item, a late
 * bill, a missed deadline). It is the brain's key learning fuel.
 *
 * The primary key is the detector's stable id (`{harmKind}:{refKind}:{refId}`)
 * so re-detecting the same lapse is an idempotent INSERT OR IGNORE — one
 * spoilage is never double-counted. This is OBSERVATION, not blame: nothing
 * here is surfaced to the user as shame.
 */

import { sql } from '../../storage';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS brain_harm_events (
    id           TEXT PRIMARY KEY,
    ref_kind     TEXT NOT NULL,
    ref_id       TEXT NOT NULL,
    harm_kind    TEXT NOT NULL,
    detected_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_brain_harm_events_detected_at
    ON brain_harm_events(detected_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateBrain(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) {
        await sql.execute(stmt);
      }
    })();
  }
  return migrationPromise;
}
