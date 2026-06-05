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
      entries.push({
        fragment,
        result: { ok: false, note: `no handler for ${fragment.module}` },
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
  ]).catch((err) => {
     
    console.error('[bridge] post-dispatch sync failed (non-fatal):', err);
  });

  return { entries, crisisSkipped: false };
}

function handlerErrorNote(module: Module, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  // Truncate for UI safety — full detail still lives in the throw stack.
  const trimmed = detail.length > 120 ? `${detail.slice(0, 120)}…` : detail;
  return `${module} handler failed: ${trimmed}`;
}
