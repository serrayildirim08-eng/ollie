/**
 * apps/native · dump/archive.ts  —  the dump persistence layer
 *
 * The audit (FEATURE_AUDIT_2026-05-31 §MISSING) found the native app
 * DISCARDS every dump's raw text: nothing writes `dump.items` / `journal.entries`,
 * so the journal resurfacer + every cross-module consumer (admin, finance,
 * goals, sleep all read `dump.items`) runs on permanently-empty input.
 *
 * This module is the fix: a lightweight append-only SQLite archive of every
 * dump. The DumpScreen records each routed dump here (raw text + routing +
 * mood tag); modules/dump/bridge.ts then mirrors the archive into the
 * `dump.items` + `journal.entries` store keys the watchers read.
 *
 * Privacy: the dump text is the user's own raw thought. It already lives in
 * the module repos (grocery item, admin task, …) post-routing; the archive is
 * the unrouted superset. It stays local (SQLite) — no cloud write here.
 *
 * ADHD-safety: a dump is never lost. record() is best-effort and swallows its
 * own errors so a failed archive write can never break the dump flow.
 */

import { sql } from '../storage';

// ── schema ──────────────────────────────────────────────────────────────────

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS dump_archive (
    id          TEXT PRIMARY KEY,
    text        TEXT NOT NULL,
    modules     TEXT NOT NULL DEFAULT '[]',
    mood        TEXT,
    logged_at   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dump_archive_logged_at
    ON dump_archive(logged_at DESC)`,
];

let migrationPromise: Promise<void> | null = null;

export function migrateDumpArchive(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const stmt of MIGRATIONS) await sql.execute(stmt);
    })();
  }
  return migrationPromise;
}

// ── types ─────────────────────────────────────────────────────────────────

export type DumpMood = 'low' | 'neutral' | 'high';

/** One archived dump row, parsed out of SQLite. */
export interface DumpArchiveEntry {
  id: string;
  text: string;
  /** Module ids the dump routed to (e.g. ['grocery', 'finance']). */
  modules: string[];
  /** Mood tag, when the mood signal flow attached one. */
  mood: DumpMood | null;
  /** ms since epoch. */
  ts: number;
}

interface DumpArchiveRow {
  id: string;
  text: string;
  modules: string;
  mood: string | null;
  logged_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── repo ────────────────────────────────────────────────────────────────────

export const dumpArchive = {
  /**
   * Append one dump. `id` defaults to the router's dumpId when supplied so the
   * archive row lines up with downstream references; falls back to a fresh id.
   * Best-effort: never throws (the dump flow must not break on a log failure).
   */
  async record(input: {
    id?: string;
    text: string;
    modules?: string[];
    mood?: DumpMood | null;
    ts?: number;
  }): Promise<void> {
    try {
      const text = (input.text ?? '').trim();
      if (!text) return; // nothing to archive (image-only / empty dump)
      await migrateDumpArchive();
      const id = input.id && input.id.length > 0 ? input.id : newId();
      const ts = typeof input.ts === 'number' ? input.ts : Date.now();
      const modules = JSON.stringify(input.modules ?? []);
      const mood = input.mood ?? null;
      // INSERT OR REPLACE so a re-record under the same dumpId (e.g. a mood
      // tag arriving after the initial archive) updates rather than duplicates.
      await sql.execute(
        `INSERT OR REPLACE INTO dump_archive (id, text, modules, mood, logged_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, text, modules, mood, ts],
      );
    } catch {
      /* never break the dump flow on an archive failure */
    }
  },

  /**
   * Whether the user has ever dumped. Cheap (LIMIT 1) — used by the home
   * screen to decide if the first-run guide should show. A read failure
   * returns true (assume not-first-run) so a transient DB error never makes a
   * returning user look brand-new.
   */
  async hasAny(): Promise<boolean> {
    try {
      await migrateDumpArchive();
      const rows = await sql.select<{ one: number }>(
        `SELECT 1 AS one FROM dump_archive LIMIT 1`,
      );
      return rows.length > 0;
    } catch {
      return true;
    }
  },

  /** All archived dumps, most recent first. */
  async list(): Promise<DumpArchiveEntry[]> {
    try {
      await migrateDumpArchive();
      const rows = await sql.select<DumpArchiveRow>(
        `SELECT id, text, modules, mood, logged_at
         FROM dump_archive
         ORDER BY logged_at DESC`,
      );
      return rows.map(rowToEntry);
    } catch {
      return [];
    }
  },
};

function rowToEntry(r: DumpArchiveRow): DumpArchiveEntry {
  let modules: string[] = [];
  try {
    const parsed = JSON.parse(r.modules) as unknown;
    if (Array.isArray(parsed)) modules = parsed.filter((m): m is string => typeof m === 'string');
  } catch {
    /* tolerate corrupt JSON — empty modules */
  }
  const mood =
    r.mood === 'low' || r.mood === 'neutral' || r.mood === 'high' ? r.mood : null;
  return { id: r.id, text: r.text, modules, mood, ts: r.logged_at };
}
