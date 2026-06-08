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
 *
 * `brain_noticing_state` is the persisted postpone / dismiss state for the
 * cross-life selection surface (Sprint 2). Keyed by the noticing's stable id:
 *   - postponed_until_ms: a SNOOZE — the noticing is hidden until this ms, then
 *     comes back. Not lost, not permanent. Survives app restarts.
 *   - dismissed_at_ms:    a permanent DISMISS — the noticing never resurfaces.
 * The read filter (modules/brain/noticings.ts) excludes any id that is either
 * dismissed or whose snooze hasn't expired. This SUPERSEDES the old session-
 * only PatternCards dismissal for the brain surface.
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
  `CREATE TABLE IF NOT EXISTS brain_noticing_state (
    noticing_id        TEXT PRIMARY KEY,
    postponed_until_ms INTEGER,
    dismissed_at_ms    INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_brain_noticing_state_postponed
    ON brain_noticing_state(postponed_until_ms)`,
  // Append-only deferral log: every postpone is itself a deferral SIGNAL the
  // learning loop (Sprint 4) reads to see she chose to defer this KIND of
  // thing. One row per postpone (not deduped) so the loop can count + time
  // them. Distinct from a permanent dismiss (which is not a deferral).
  `CREATE TABLE IF NOT EXISTS brain_deferral_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    noticing_id  TEXT NOT NULL,
    module       TEXT,
    category     TEXT,
    deferred_at  INTEGER NOT NULL,
    until_ms     INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_brain_deferral_events_deferred_at
    ON brain_deferral_events(deferred_at DESC)`,
  // Sprint 3 — "speak in your words" copy cache. The AI-generated noticing
  // sentence is produced AT MOST ONCE per (noticing, day, language): keyed by
  // the noticing's stable id + the local day-bucket + the app language. A hit
  // means no re-call on re-render (or on a second app-open the same day). The
  // surface ALWAYS has a sentence (the trilingual fallback) even with no row.
  `CREATE TABLE IF NOT EXISTS brain_copy_cache (
    cache_key   TEXT PRIMARY KEY,
    noticing_id TEXT NOT NULL,
    lang        TEXT NOT NULL,
    day_bucket  INTEGER NOT NULL,
    text        TEXT NOT NULL,
    source      TEXT,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_brain_copy_cache_day
    ON brain_copy_cache(day_bucket)`,
  // Sprint 4 — the LEARNED per-person procrastination map. A snapshot of the
  // verdict learnBucket() produced for each bucket, recomputed on boot / after a
  // dump (NOT per render) from brain_deferral_events + brain_harm_events. Keyed
  // by bucket: a coarse domain ('groceries') OR a fine '${domain}:${item}'
  // ('groceries:milk'). The selector reads this to override the cold-start
  // defaults per-person. SILENT — nothing here surfaces as copy.
  `CREATE TABLE IF NOT EXISTS brain_learned_map (
    bucket       TEXT PRIMARY KEY,
    deferability TEXT NOT NULL,
    confidence   REAL NOT NULL,
    sample_size  INTEGER NOT NULL,
    harm_rate    REAL NOT NULL,
    computed_at  INTEGER NOT NULL
  )`,
  // Sprint 4 — USER PINS (DECISION 4): a correction that WINS over both the
  // learned verdict AND the cold-start default. One row per pinned bucket;
  // pin ∈ {'protect','ok-to-defer'}. Written by setPin() (a future settings UI
  // calls it); read into the LearnedMap.pins the resolver respects above all.
  `CREATE TABLE IF NOT EXISTS brain_pins (
    bucket  TEXT PRIMARY KEY,
    pin     TEXT NOT NULL,
    set_at  INTEGER NOT NULL
  )`,
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
