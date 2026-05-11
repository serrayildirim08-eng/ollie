/**
 * @ollie/orchestrator · dump (journal)
 *
 * Boots on app load. The only caller of @ollie/logic/journal resurface +
 * search functions. UI reads derived keys from the store — it never calls
 * logic directly.
 *
 * Derived keys written (namespace: "journal"):
 *   patterns                JournalPattern[]  resurface + search-related
 *   patternsLastComputedAt  number            wall-clock ts of last run
 *
 * Events emitted:
 *   journal:entries_added  — when new entries land (dump.items grew)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  resurface,
  resurfaceAnniversaries,
} from '@ollie/logic/journal';
import type {
  StoredEntry,
  ResurfaceBuckets,
  AnniversaryBucket,
} from '@ollie/logic/journal';
import type { Orchestrator } from './types';

export interface JournalPattern {
  kind: 'resurface' | 'anniversary';
  bucket: string;
  entries: StoredEntry[];
  computedAt: number;
}

export interface DumpOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
}

export function createDumpOrchestrator(
  store: Store,
  opts: DumpOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
  let initialized = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubs: Unsubscribe[] = [];

  /** Count of dump items at last recompute — used to detect new entries. */
  let lastItemCount = 0;

  // ── helpers ──────────────────────────────────────────────────────────────

  function getDumpItems(): StoredEntry[] {
    return store.get<StoredEntry[]>('dump', 'items', []) ?? [];
  }

  function getJournalEntries(): StoredEntry[] {
    return store.get<StoredEntry[]>('journal', 'entries', []) ?? [];
  }

  // ── recompute ─────────────────────────────────────────────────────────────

  function recomputePatterns(): void {
    const now = nowFn();

    // Merge dump items + journal entries; deduplicate by ts.
    const dumpItems = getDumpItems();
    const journalEntries = getJournalEntries();
    const seenTs = new Set<number>();
    const allEntries: StoredEntry[] = [];
    for (const e of [...dumpItems, ...journalEntries]) {
      if (typeof e?.ts !== 'number') continue;
      if (seenTs.has(e.ts)) continue;
      seenTs.add(e.ts);
      allEntries.push(e);
    }
    allEntries.sort((a, b) => a.ts - b.ts);

    const patterns: JournalPattern[] = [];

    // Resurface buckets
    const buckets: ResurfaceBuckets = resurface(allEntries, now);
    for (const [bucket, entries] of Object.entries(buckets) as [string, StoredEntry[]][]) {
      if (entries.length > 0) {
        patterns.push({ kind: 'resurface', bucket, entries, computedAt: now });
      }
    }

    // Anniversary buckets (recent 2 years only for performance)
    const anniversaries: AnniversaryBucket[] = resurfaceAnniversaries(allEntries, now);
    for (const ab of anniversaries) {
      if (ab.entries.length > 0) {
        patterns.push({
          kind: 'anniversary',
          bucket: `anniversary-${ab.offsetDays}d`,
          entries: ab.entries,
          computedAt: now,
        });
      }
    }

    store.set('journal', 'patterns', patterns);
    store.set('journal', 'patternsLastComputedAt', now);

    // Detect new entries landing
    const currentCount = dumpItems.length;
    if (currentCount > lastItemCount && lastItemCount >= 0) {
      const newCount = currentCount - lastItemCount;
      events.emit('journal:entries_added', {
        dump_ts: now,
        count: newCount,
        extractor: 'orchestrator',
      });
    }
    lastItemCount = currentCount;
  }

  // ── debounce ──────────────────────────────────────────────────────────────

  function schedule(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      recomputePatterns();
    }, 500);
  }

  // ── braindump handler ─────────────────────────────────────────────────────

  function onBraindump(): void {
    schedule();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('dump', 'items', () => schedule()));
    unsubs.push(store.subscribeKey('journal', 'entries', () => schedule()));
    unsubs.push(events.on('void:braindump:submitted', onBraindump));

    // Set lastItemCount from initial state before first run so init doesn't
    // fire journal:entries_added for pre-existing data.
    lastItemCount = getDumpItems().length;

    recomputePatterns();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    initialized = false;
  }

  return { init, teardown };
}
