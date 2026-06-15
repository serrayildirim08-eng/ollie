/**
 * apps/native · modules/dispatch.ts
 *
 * Single entry point that takes a RouterOutput and dispatches each fragment
 * to the right module handler. Returns a DispatchOutput the journal feed
 * (JournalNoticed) renders.
 *
 * Crisis short-circuit: if RouterOutput.crisis is set, NO module handlers
 * run. The schema guarantees crisis takes priority; we honour that here so
 * a sensitive fragment can never silently land in finance/admin while the
 * crisis screen is being shown.
 *
 * Failure-soft: each handler invocation is wrapped in try/catch. One bad
 * handler can never crash the whole dump — the offending fragment surfaces
 * an `ok: false` note instead.
 */

import type { Fragment, HandlerResult, Module, RouterOutput } from '../router/schema';
import type { DispatchEntry, DispatchOutput } from './types';
import { stubHandlers } from './stubs';
import { store } from '../store';
import { runAllSyncs } from '../bridge';
import { recomputeBrain } from './brain';
import { recordMoodFromDump } from '../bridge/mood';

export interface DispatchOptions {
  /**
   * Override the handler registry — primarily for tests that want to
   * substitute spies, or future migrations where modules graduate from
   * stubs to real implementations one at a time.
   */
  handlers?: Partial<Record<Module, { apply(f: Fragment): Promise<HandlerResult> }>>;
}

export async function dispatchRouterOutput(
  output: RouterOutput,
  opts: DispatchOptions = {},
): Promise<DispatchOutput> {
  // Crisis short-circuit per RouterOutput schema.
  if (output.crisis) {
    return { entries: [], crisisSkipped: true };
  }

  const handlers = { ...stubHandlers, ...(opts.handlers ?? {}) };
  const entries: DispatchEntry[] = [];

  // Sequential is fine here — module handlers are local + cheap. We avoid
  // Promise.all so the journal feed sees results in original fragment order
  // even when individual handlers take different times (later: real DB writes).
  for (const fragment of output.fragments) {
    const handler = handlers[fragment.module];
    if (!handler) {
      // No native handler for a module the worker routed to. `stubHandlers` is
      // typed Record<Module,…> so this can't be a missing native handler — it
      // means the worker's module list drifted ahead of the native Module type
      // (separate packages, kept in sync by hand; audit #22). Log LOUDLY so the
      // drift is observable instead of a silent drop. The raw dump text is still
      // archived by DumpScreen, so the content itself is not lost.
      console.error(
        `[dispatch] worker↔native module drift: no handler for "${fragment.module}" — fragment NOT routed (raw dump still archived)`,
      );
      entries.push({
        fragment,
        result: { ok: false, note: `no handler for ${fragment.module}` },
      });
      continue;
    }
    // Draft-first (audit #9): a grey-zone fragment (0.60–0.79 → needsConfirm)
    // is NOT written here. We hold it as a draft; the confirm card applies it
    // on "keep" via applyFragment(). High-confidence (≥0.80) fragments fall
    // through and write immediately (the low-friction path); <0.60 already
    // demoted to dump_only by the worker and is not needsConfirm.
    if (fragment.needsConfirm) {
      entries.push({
        fragment,
        result: { ok: true, note: 'draft — awaiting confirm', draft: true, needsConfirm: true },
      });
      continue;
    }
    try {
      const result = await handler.apply(fragment);
      entries.push({ fragment, result });
    } catch (err) {
      entries.push({
        fragment,
        result: { ok: false, note: handlerErrorNote(fragment.module, err) },
      });
    }
  }

  // The great rewiring: handlers just wrote freshly-captured data into the
  // module SQLite repos. Mirror it into the @ollie/store keys the Layer-2
  // watchers read so a dump's effects can be noticed this cycle. Also tag the
  // dump's mood (feeds goals' low-mood delete lock + finance doom-buying — see
  // bridge/mood.ts).
  //
  // We sync ALL modules, not just the ones this dump touched. Tempting as it is
  // to scope to `output.fragments`, scoping silently re-opens the "great
  // disconnect": in-app capture UIs write SQLite WITHOUT mirroring to the store
  // (e.g. FocusTimer → work/repo.ts addFocus does insertEvent only — no store
  // write, no event). Their bridge.syncToStore runs ONLY here + at boot, so the
  // all-modules sweep is what mirrors an in-app focus session on the *next* dump
  // of any kind; the work watcher (woken by the always-mirrored dump.items) then
  // sees it. A grocery-only scoped sync would leave work.focus_log stale → work
  // cues go dark until a work-touching dump or reboot. The sweep is cheap anyway:
  // store.set no-ops on deep-equal values, so unchanged modules cause zero
  // watcher churn. Speed comes from making this NON-BLOCKING below, not from
  // narrowing it.
  //
  // Non-blocking: fire-and-forget so the dump ack/UI never waits on the mirror.
  // Both are fully isolated — runAllSyncs resolves-not-rejects and mood is
  // try/caught — so neither can reject the floated promise. Trade-off: a watcher
  // may tick before the mirror lands; acceptable because each module's own
  // subscribed keys still fire on its next change, and the boot sync already
  // populated all foreign keys once.
  void Promise.all([
    runAllSyncs(store),
    recordMoodFromDump(store, output.originalDump).catch((err) => {

      console.error('[bridge] recordMoodFromDump failed (non-fatal):', err);
    }),
  ])
    // The silent-observer brain reads the just-mirrored store keys (and this
    // dump bumped today's capture load + maybe its mood tag), so recompute
    // harm + capacity AFTER the sync. Best-effort; never blocks the ack.
    .then(() => recomputeBrain(store))
    .catch((err) => {

      console.error('[bridge] post-dispatch sync failed (non-fatal):', err);
    });

  return { entries, crisisSkipped: false };
}

/**
 * Apply ONE fragment that was held as a draft (audit #9). Called when the user
 * taps "keep" on a grey-zone confirm card. Runs the module handler (the write
 * that dispatchRouterOutput deferred), then mirrors to the store + recomputes
 * the brain — same fire-and-forget, non-blocking sweep as a normal dump, minus
 * the mood re-tag (there is no fresh dump text here).
 */
export async function applyFragment(
  fragment: Fragment,
  opts: DispatchOptions = {},
): Promise<HandlerResult> {
  const handlers = { ...stubHandlers, ...(opts.handlers ?? {}) };
  const handler = handlers[fragment.module];
  if (!handler) return { ok: false, note: `no handler for ${fragment.module}` };

  let result: HandlerResult;
  try {
    result = await handler.apply(fragment);
  } catch (err) {
    return { ok: false, note: handlerErrorNote(fragment.module, err) };
  }

  void runAllSyncs(store)
    .then(() => recomputeBrain(store))
    .catch((err) => {
      console.error('[bridge] post-confirm sync failed (non-fatal):', err);
    });

  return result;
}

function handlerErrorNote(module: Module, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  // Truncate for UI safety — full detail still lives in the throw stack.
  const trimmed = detail.length > 120 ? `${detail.slice(0, 120)}…` : detail;
  return `${module} handler failed: ${trimmed}`;
}
