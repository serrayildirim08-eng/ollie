/**
 * apps/native · modules/mood/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The native app captures mood into SQLite (mood/repo.ts, table
 * `mood_events`) and never writes the @ollie/store keys any Layer-2 mood
 * reader expects. This mirrors the rows into a single store key so those
 * readers see real input.
 *
 * Mapping (SQLite → store key):
 *   every mood_events row → mood.logs  (one flat array, newest-first
 *     preserved as { id, kind, ts, ...data })
 *
 * Kept deliberately simple (one key). Never throws — a sync-on-boot before
 * any capture must not crash the bridge.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { events as moodEvents } from './repo';
import { migrateMood } from './migrate';

/** One mirrored mood log entry: identity + time + the action-specific data. */
interface MoodLogEntry {
  id: string;
  kind: string;
  ts: number;
  [field: string]: unknown;
}

export async function syncToStore(store: Store): Promise<void> {
  try {
    // Capture writes through migrateMood(); ensure the table exists before we
    // read so a sync-on-boot before any capture can't throw on a missing table.
    await migrateMood();

    const all = await moodEvents.list(); // newest-first

    const logs: MoodLogEntry[] = all.map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      ts: ev.loggedAt,
      ...ev.data,
    }));

    store.set('mood', 'logs', logs);
  } catch (err) {
    // Best-effort mirror — never let a sync failure surface to the caller.
    console.error('[mood] syncToStore failed', err);
  }
}
