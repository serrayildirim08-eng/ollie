/**
 * apps/native · modules/dump/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The dump Layer-2 watcher (packages/orchestrator/src/dump.ts — nightly
 * resurface + anniversary buckets) reads the store keys below; native archives
 * every dump into SQLite (dump/archive.ts → dump_archive) and never wrote the
 * store. This bridge mirrors the archive into the shapes the watcher reads.
 * It is load-bearing for the WHOLE cross-module layer: `dump.items` is also
 * read by the finance (doom-buying), admin and goals orchestrators, so this
 * single mirror lights up several modules at once.
 *
 * Store keys written:
 *   dump.items      — StoredEntry[] ({ id, ts, text, ... }); the load-bearing
 *                     one. The dump resurfacer + finance doom-buying read it.
 *   journal.entries — StoredEntry[] the resurfacer merges with dump.items
 *                     (dedup by ts). We mirror the same rows so either path
 *                     surfaces them.
 *   shared.actionLog — read-merge/append ({ ts, rawText, undone }). The goals
 *                     low-mood / obstacle / sunk-cost detectors fold this into
 *                     their dump history. Other modules ALSO write actionLog,
 *                     so we merge-by-ts and never overwrite.
 *                     PRIVACY: `actionLog` is partitioned to RAM-only on disk
 *                     (SENSITIVE_BLOB_FIELDS in @ollie/store) so the raw dump
 *                     text it carries never lands in plaintext localStorage —
 *                     its durable copy is the SQLCipher dump archive, which is
 *                     exactly what this bridge rebuilds it from on every boot.
 *
 * OUTPUT (never touched): the dump detector writes `journal.patterns` /
 * `journal.patternsLastComputedAt` — usePatterns('dump') maps 'dump' → the
 * 'journal' namespace, so the Box stays <PatternCards module="dump" />.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { dumpArchive } from '../../dump/archive';

/** StoredEntry shape the journal resurfacer + cross-module readers expect. */
interface StoredEntry {
  id?: string;
  ts: number;
  text: string;
  mood?: string | null;
  modules?: string[];
}

/** A shared.actionLog row — merged across every module that appends one. */
interface ActionLogEntry {
  ts: number;
  rawText?: string;
  undone?: boolean;
  [extra: string]: unknown;
}

export async function syncToStore(store: Store): Promise<void> {
  const rows = await dumpArchive.list(); // most-recent-first

  // ── dump.items + journal.entries: ascending by ts (resurfacer sorts, but
  //    keep it tidy + deterministic for readers that don't). ──────────────
  const items: StoredEntry[] = rows
    .map((r) => ({
      id: r.id,
      ts: r.ts,
      text: r.text,
      mood: r.mood,
      modules: r.modules,
    }))
    .sort((a, b) => a.ts - b.ts);

  store.set('dump', 'items', items);
  store.set('journal', 'entries', items);

  // ── shared.actionLog: READ-MERGE / APPEND (never overwrite) ──────────────
  // Other modules' bridges also write shared.actionLog, so we merge our dump
  // rows in by ts: keep every existing entry, add any dump row whose ts isn't
  // already present, and preserve the `undone` flag if an existing row had it.
  const existing = (store.get<ActionLogEntry[]>('shared', 'actionLog', []) ?? []).filter(
    (e): e is ActionLogEntry => !!e && typeof e.ts === 'number',
  );
  const seenTs = new Set(existing.map((e) => e.ts));
  const additions: ActionLogEntry[] = [];
  for (const r of items) {
    if (seenTs.has(r.ts)) continue;
    seenTs.add(r.ts);
    additions.push({ ts: r.ts, rawText: r.text, undone: false });
  }
  if (additions.length > 0) {
    const merged = [...existing, ...additions].sort((a, b) => a.ts - b.ts);
    store.set('shared', 'actionLog', merged);
  }
}
