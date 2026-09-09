/**
 * @ollie/orchestrator · chores
 *
 * The chores Layer-2 watcher. Boots on app load. Reads the mirrored chores
 * registry (`chores.registry`, written by apps/native modules/chores/bridge)
 * and, for each RECURRING chore whose cadence clock has rolled over, emits a
 * calm model-C OFFER card into `chores.patterns`:
 *
 *   "vacuuming's due (usually every ~7 days) — add to today?"
 *
 * Accepting the offer marks the chore done (which resets its clock) via the
 * brain's `mark_chore_done` action — the native brain pipeline (noticings →
 * copy → executeAction) reads the card's attached offer facts and dispatches.
 *
 * Derived keys written (namespace: "chores"):
 *   patterns                ChorePattern[]  one card per due recurring chore
 *   patternsLastComputedAt  number          wall-clock ts of last run
 *
 * This file has zero DB — the bridge mirrors SQLite → store.registry; we only
 * read the store + write derived keys, mirroring the grocery/admin watchers.
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import type { Orchestrator } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One chore registry row, as mirrored by the native bridge. */
export interface ChoreRecord {
  id: string;
  name: string;
  kind: 'one_off' | 'recurring';
  /** Interval cadence in days; null for one-offs + weekday-anchored chores. */
  cadenceDays: number | null;
  /** Local weekdays [0=Sun..6=Sat] for weekday-anchored recurring chores; null
   *  otherwise. Weekday chores AUTO-appear on today's list silently, so the
   *  watcher emits NO offer card for them (see isRecordDue). */
  weekdays?: number[] | null;
  /** ms-since-epoch of the most recent completion; null until first done. */
  lastDoneAt: number | null;
  done: boolean;
  createdAt: number;
}

/**
 * One offer card written under `chores.patterns`. The shape matches what the
 * native brain gatherer (noticings.ts) reads: `pattern` (stable dedup key),
 * `copy` (the sentence), `category`, plus the offer facts the action layer
 * consumes (`actionKind` + `choreId`). `urgencyAt` rides the next-due ts so the
 * brain selector can rank it.
 */
export interface ChorePattern {
  signal: string;
  pattern: string;
  category: string;
  copy: string;
  actionKind: 'mark_chore_done';
  /** The chore row id the offer acts on (→ executeAction marks it done). */
  choreId: string;
  /** The chore name — carried for copy + traceability. */
  choreName: string;
  urgencyAt: number;
  ts: number;
}

export interface ChoresOrchestratorOptions {
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Does this recurring chore warrant a brain OFFER card?
 *
 * Only INTERVAL chores do. Weekday-anchored chores ("laundry on wednesdays")
 * auto-appear on today's list silently — surfacing a "add to today?" offer for
 * them would double up, so they're excluded here.
 *
 * An interval chore is due once it's been ≥ cadenceDays since last done (or it
 * has never been done).
 */
export function isRecordDue(c: ChoreRecord, now: number): boolean {
  if (c.kind !== 'recurring') return false;
  // Weekday-anchored → auto-added silently, never offered.
  if (c.weekdays != null && c.weekdays.length > 0) return false;
  if (c.cadenceDays == null || c.cadenceDays <= 0) return false;
  if (c.lastDoneAt == null) return true;
  return now >= c.lastDoneAt + c.cadenceDays * DAY_MS;
}

/** The next-due ts for a recurring chore (its `urgencyAt`). */
function nextDueTs(c: ChoreRecord, now: number): number {
  if (c.lastDoneAt == null || c.cadenceDays == null) return now;
  return c.lastDoneAt + c.cadenceDays * DAY_MS;
}

/** Build the calm offer sentence. "vacuuming's due (usually every ~7 days) —
 *  add to today?" — lowercase, factual, one question, no shame. */
export function buildChoreDueCopy(name: string, cadenceDays: number): string {
  const every = Math.max(1, Math.round(cadenceDays));
  const everyLabel = `${every} day${every === 1 ? '' : 's'}`;
  return `${name}'s due (usually every ~${everyLabel}) — add to today?`;
}

export function createChoresOrchestrator(
  store: Store,
  opts: ChoresOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
  let initialized = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubs: Unsubscribe[] = [];

  function getRegistry(): ChoreRecord[] {
    return store.get<ChoreRecord[]>('chores', 'registry', []) ?? [];
  }

  function recomputePatterns(): void {
    const now = nowFn();
    const registry = getRegistry();

    const next: ChorePattern[] = [];
    for (const c of registry) {
      if (!c || typeof c.id !== 'string') continue;
      if (!isRecordDue(c, now)) continue;
      const cadenceDays = c.cadenceDays ?? 7;
      next.push({
        signal: 'chore_due_offer',
        pattern: `chore-due:${c.id}`,
        category: 'chore_due',
        copy: buildChoreDueCopy(c.name, cadenceDays),
        actionKind: 'mark_chore_done',
        choreId: c.id,
        choreName: c.name,
        urgencyAt: nextDueTs(c, now),
        ts: now,
      });
    }

    store.set('chores', 'patterns', next);
    store.set('chores', 'patternsLastComputedAt', now);
  }

  function schedule(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        recomputePatterns();
      } catch (err) {
        // A recompute failure must never crash the orchestrator.
        console.error('[chores] recompute failed (non-fatal):', err);
      }
    }, 50);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;
    // Recompute whenever the mirrored registry changes (a dump added/marked a
    // chore, or the boot sync landed).
    unsubs.push(store.subscribeKey('chores', 'registry', () => schedule()));
    // Compute once on boot so a chore that went due while the app was closed
    // surfaces immediately.
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
