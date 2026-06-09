/**
 * @ollie/orchestrator · matter-routing (WORK-VISION Phase 2)
 *
 * Store-bound wrapper around the pure Phase-2 routing heuristics in
 * @ollie/logic/work. Batches dumps, routes each into a matter (or marks
 * it loose), and writes the results back into the work store slice. NO
 * AI / LLM call anywhere — the whole layer is free deterministic
 * arithmetic.
 *
 * Spec: design/clean-slate-2026-05-18-v2/WORK-VISION.md — Phase 2.
 *
 * ─── Where work dumps come from ──────────────────────────────────────
 * Brain-dump routing (orchestrator/braindump-dispatch.ts) lands routed
 * Actions in module slices:
 *   - module 'work'  → work.tasks[]    ({ id, title, created_at })
 *                    → work.meetings[] ({ id, title, start_at, … })
 *   - module 'dump'  → dump.items[]    ({ id, text, ts })
 * The matter router treats both as routable note text. work.tasks /
 * work.meetings carry a `title`; dump.items carries `text`. Each row's
 * id is the dump_id; its slice is the source_slice.
 *
 * Routing is BATCH and is NOT run at dump time — `routeNow()` (or the
 * debounced reaction to a `void:braindump:submitted` event) processes
 * the accumulated backlog. Routing never interrupts the user.
 *
 * ─── Store keys written (namespace "work") ───────────────────────────
 *   matters              Matter[]              — Phase 1 containers; dump
 *                                                refs appended as routes land.
 *   matter_loose_dumps   LooseDumpRef[]         — dumps with no match yet;
 *                                                the quiet "loose / unsorted"
 *                                                area. Self-drains: a loose
 *                                                dump is removed once a later
 *                                                pass routes it.
 *   matter_suggestions   NewMatterSuggestion[]  — recurring-unknown-name
 *                                                "is this a matter?" nudges.
 *   matter_routed_ids    string[]               — dump ids already routed to a
 *                                                matter (clear/guess); dedupe
 *                                                guard so re-runs are idempotent.
 *   matterRoutingLastRunAt number               — wall-clock of last pass.
 *
 * The Phase-1 `work.matters` slice is the SAME slice the matter-detail /
 * matter-list screens read. This orchestrator only ever APPENDS dump
 * refs to existing matters — it never creates a matter (matters are
 * created only by user-confirmed Phase 2 suggestions, a UI action).
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  routeDumpBatch,
  attachDumpRef,
  isMatter,
} from '@ollie/logic/work';
import type {
  Matter,
  RoutableDump,
  MatterDumpRef,
  MatterLinkOrigin,
} from '@ollie/logic/work';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 750;

/**
 * A dump held in the quiet loose/unsorted area. Mirrors RoutableDump
 * minus nothing — it is a RoutableDump plus the timestamp it was parked,
 * so the UI can show "unsorted since …" and the next pass can re-try it.
 */
export interface LooseDumpRef {
  dump_id: string;
  source_slice: string;
  text: string;
  /** ms timestamp the dump was originally captured. */
  ts: number;
  /** ms timestamp this dump was parked as loose. */
  parked_at: number;
}

export interface MatterRoutingOptions {
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

// ─── Source-slice readers ─────────────────────────────────────────────

interface WorkTaskRow { id?: string; title?: string; created_at?: number }
interface WorkMeetingRow { id?: string | null; title?: string; start_at?: number }
interface DumpItemRow { id?: string; text?: string; ts?: number }

/**
 * Collect every routable dump currently in the store. Pulls from the
 * three slices brain-dump routing writes into. Rows missing an id or
 * text are skipped defensively (persisted data may predate the schema).
 */
export function collectRoutableDumps(store: Store): RoutableDump[] {
  const out: RoutableDump[] = [];

  const tasks = store.get<WorkTaskRow[]>('work', 'tasks', []) ?? [];
  for (const t of tasks) {
    if (typeof t?.id !== 'string' || typeof t.title !== 'string') continue;
    out.push({
      dump_id: t.id,
      source_slice: 'work',
      text: t.title,
      ts: typeof t.created_at === 'number' ? t.created_at : 0,
    });
  }

  const meetings = store.get<WorkMeetingRow[]>('work', 'meetings', []) ?? [];
  for (const m of meetings) {
    if (typeof m?.id !== 'string' || typeof m.title !== 'string') continue;
    out.push({
      dump_id: m.id,
      source_slice: 'work',
      text: m.title,
      ts: typeof m.start_at === 'number' ? m.start_at : 0,
    });
  }

  const items = store.get<DumpItemRow[]>('dump', 'items', []) ?? [];
  for (const d of items) {
    if (typeof d?.id !== 'string' || typeof d.text !== 'string') continue;
    out.push({
      dump_id: d.id,
      source_slice: 'dump',
      text: d.text,
      ts: typeof d.ts === 'number' ? d.ts : 0,
    });
  }

  return out;
}

// ─── Core pass ────────────────────────────────────────────────────────

export interface MatterRoutingPassResult {
  /** dumps newly filed into a matter this pass (clear + guess). */
  filed: number;
  /** dumps newly clear-matched. */
  clear: number;
  /** dumps newly filed as a marked guess. */
  guess: number;
  /** dumps currently sitting loose after this pass. */
  loose: number;
  /** new-matter suggestions after this pass. */
  suggestions: number;
}

/**
 * Run one batch routing pass over the whole dump backlog. Pure-ish: the
 * only I/O is store reads + the final store writes; all routing logic
 * is the pure @ollie/logic/work layer.
 *
 * Idempotent: a dump already in `work.matter_routed_ids` is skipped, so
 * re-running the pass never double-files. The loose list is recomputed
 * from scratch each pass (it self-drains — a loose dump that now routes
 * simply isn't re-added).
 */
export function runMatterRoutingPass(
  store: Store,
  now: number,
): MatterRoutingPassResult {
  const rawMatters = store.get<unknown[]>('work', 'matters', []) ?? [];
  const matters: Matter[] = Array.isArray(rawMatters)
    ? rawMatters.filter(isMatter)
    : [];

  const allDumps = collectRoutableDumps(store);

  const routedIds = new Set(
    store.get<string[]>('work', 'matter_routed_ids', []) ?? [],
  );

  // Only route dumps not already filed into a matter. Loose dumps are
  // re-routed every pass on purpose — that is how the loose area drains.
  const pending = allDumps.filter((d) => !routedIds.has(d.dump_id));

  if (pending.length === 0 && matters.length === 0) {
    // Nothing to do and nowhere to file — leave state untouched.
    store.set('work', 'matterRoutingLastRunAt', now);
    return { filed: 0, clear: 0, guess: 0, loose: 0, suggestions: 0 };
  }

  const { routes, suggestions } = routeDumpBatch(pending, matters);

  // Index matters by id for in-place ref appends.
  const matterById = new Map<string, Matter>();
  for (const m of matters) matterById.set(m.id, m);

  const newlyRouted: string[] = [];
  const looseRefs: LooseDumpRef[] = [];
  let clear = 0;
  let guess = 0;

  // pending dumps keyed for loose-ref construction.
  const pendingById = new Map<string, RoutableDump>();
  for (const d of pending) pendingById.set(d.dump_id, d);

  for (const r of routes) {
    if (r.outcome === 'loose' || r.matter_id === null) {
      const src = pendingById.get(r.dump_id);
      if (src) {
        looseRefs.push({
          dump_id: src.dump_id,
          source_slice: src.source_slice,
          text: src.text,
          ts: src.ts,
          parked_at: now,
        });
      }
      continue;
    }

    const matter = matterById.get(r.matter_id);
    if (!matter) {
      // Matter vanished between read and apply — park as loose.
      const src = pendingById.get(r.dump_id);
      if (src) {
        looseRefs.push({
          dump_id: src.dump_id,
          source_slice: src.source_slice,
          text: src.text,
          ts: src.ts,
          parked_at: now,
        });
      }
      continue;
    }

    const origin: MatterLinkOrigin = r.outcome === 'clear' ? 'clear' : 'guess';
    const ref: MatterDumpRef = {
      dump_id: r.dump_id,
      source_slice: r.source_slice,
      origin,
      routed_at: now,
      score: r.score,
    };
    matterById.set(matter.id, attachDumpRef(matter, ref));
    newlyRouted.push(r.dump_id);
    if (origin === 'clear') clear += 1;
    else guess += 1;
  }

  // Persist: matters (with new refs), loose list (fully recomputed),
  // suggestions, the routed-id dedupe set, and the run timestamp.
  if (newlyRouted.length > 0) {
    const updated = matters.map((m) => matterById.get(m.id) ?? m);
    store.set('work', 'matters', updated);
    store.set('work', 'matter_routed_ids', [...routedIds, ...newlyRouted]);
  }
  store.set('work', 'matter_loose_dumps', looseRefs);
  store.set('work', 'matter_suggestions', suggestions);
  store.set('work', 'matterRoutingLastRunAt', now);

  if (newlyRouted.length > 0 || suggestions.length > 0) {
    try {
      events.emit('work:matters_routed', {
        filed: newlyRouted.length,
        loose: looseRefs.length,
        suggestions: suggestions.length,
        ts: now,
      });
    } catch { /* never throw from a routing pass */ }
  }

  return {
    filed: newlyRouted.length,
    clear,
    guess,
    loose: looseRefs.length,
    suggestions: suggestions.length,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────

/**
 * Create the matter-routing orchestrator.
 *
 * Subscriptions (all debounced — routing is batch, never per-dump):
 *   work.tasks      → schedule pass   (brain-dump work tasks land here)
 *   work.meetings   → schedule pass   (brain-dump work meetings)
 *   dump.items      → schedule pass   (generic brain dumps)
 *   work.matters    → schedule pass   (a newly-confirmed matter can now
 *                     adopt loose dumps — re-route the backlog)
 *   void:braindump:submitted event → schedule pass
 *
 * `routeNow()` runs a pass immediately (used by tests / explicit triggers).
 */
export function createMatterRoutingOrchestrator(
  store: Store,
  opts: MatterRoutingOptions = {},
): Orchestrator & { routeNow(): MatterRoutingPassResult } {
  const getNow = opts.now ?? (() => Date.now());

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function routeNow(): MatterRoutingPassResult {
    try {
      return runMatterRoutingPass(store, getNow());
    } catch (e) {
      console.error('[orchestrator/matter-routing] pass failed:', e);
      return { filed: 0, clear: 0, guess: 0, loose: 0, suggestions: 0 };
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; routeNow(); }, DEBOUNCE_MS);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('work', 'tasks', schedule));
    unsubs.push(store.subscribeKey('work', 'meetings', schedule));
    unsubs.push(store.subscribeKey('dump', 'items', schedule));
    unsubs.push(store.subscribeKey('work', 'matters', schedule));

    unsubs.push(
      events.on('void:braindump:submitted', () => { schedule(); }),
    );

    // Cold start — drain the existing backlog once.
    schedule();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (timer) { clearTimeout(timer); timer = null; }
    initialized = false;
  }

  return { init, teardown, routeNow };
}
