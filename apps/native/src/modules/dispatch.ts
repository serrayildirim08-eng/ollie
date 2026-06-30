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
import { recordCoregulationFromDump } from '../bridge/coregulation';
import { sweepDatelessLadders } from '../notify/datelessLadder';
import { emitEvent } from '@ollie/orchestrator';

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
  // Items actually applied this dump — feeds the void:braindump:submitted event
  // (audit S8 · gap 1) so the per-module orchestrator dump handlers (sleep /
  // finance text re-parse, work / goals / habits / body / admin / dump
  // recompute) fire. Drafts (needsConfirm) + no-handler fragments are excluded:
  // nothing was written for them, so they aren't "submitted" work yet.
  const submittedItems: Array<{
    module: Module;
    text: string;
    intent: string;
    confidence: number;
  }> = [];

  // Sequential is fine here — module handlers are local + cheap. We avoid
  // Promise.all so the journal feed sees results in original fragment order
  // even when individual handlers take different times (later: real DB writes).
  for (const fragment of output.fragments) {
    const handler = handlers[fragment.module];
    if (!handler) {
      // No native handler for a module the worker routed to. `stubHandlers` is
      // typed Record<Module,…> so this can't be a missing native handler — it
      // means the worker's module list drifted ahead of the native Module type
      // (separate packages, kept in sync by hand; audit #22). The raw dump text
      // is still archived by DumpScreen, so the content itself is not lost, but
      // the fragment is silently dropped — so we must SURFACE the drift, not bury
      // it in a lone console.error nobody greps for (audit #130).
      reportNoHandlerDrift(fragment.module);
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
      if (result.ok) {
        const intent = (fragment.payload as { action?: unknown } | undefined)?.action;
        submittedItems.push({
          module: fragment.module,
          text: fragment.text,
          intent: typeof intent === 'string' ? intent : fragment.module,
          confidence: fragment.confidence,
        });
      }
    } catch (err) {
      entries.push({
        fragment,
        result: { ok: false, note: handlerErrorNote(fragment.module, err) },
      });
    }
  }

  // ── audit S8 · gap 1 — emit void:braindump:submitted ─────────────────────
  // The per-module orchestrators (sleep / finance / work / goals / habits /
  // body / admin / dump / cycle) subscribe to this event to re-parse or
  // recompute on a fresh dump. apps/native never emitted it, so ~9 dump
  // handlers stayed dark — a dump's sleep/finance free text was never
  // re-parsed by the watchers, and the others only re-ran on the store-key
  // mirror below. We emit the registry's v:2 shape AFTER the handlers wrote
  // (so a watcher that reads store sees fresh data once the mirror lands).
  // Idempotent for subscribers: every handler debounces / dedupes. Emitted
  // even with empty items (still a valid "a dump happened, re-look" signal);
  // the crisis short-circuit above returns before this point, so a crisis
  // dump never emits.
  try {
    emitEvent('void:braindump:submitted', {
      v: 2,
      items: submittedItems,
      raw: output.originalDump ?? '',
      ts: typeof output.timestamp === 'number' ? output.timestamp : Date.now(),
      idempotency_key: output.dumpId ?? `dump:${Date.now()}`,
      route_path: 'native:dispatch',
    });
  } catch {
    // Bus emit is best-effort — never break dispatch on a subscriber fault.
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
  // Audit S8 · gap 3 — append this dump's co-regulation signal (sentiment +
  // whether a pet was present) to pets.coregulation_log. The pets bridge
  // read-merges that key but never writes it; this is the "dump pet-mention
  // flow" it expects. Synchronous + self-try/caught — runs before the async
  // mirror so the pets watcher (which the mirror wakes) sees the new entry.
  recordCoregulationFromDump(store, output);

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
    // Advance date-less reminder ladders (a fresh task may have just registered
    // one; an existing one may have crossed a tier). Best-effort, non-blocking.
    .then(() => sweepDatelessLadders(store))
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

  // A confirmed draft is a real write — notify the per-module dump handlers
  // the same way a normal dump does (audit S8 · gap 1) so e.g. a confirmed
  // sleep/finance fragment gets re-parsed by its watcher, not just mirrored.
  if (result.ok) {
    try {
      const intent = (fragment.payload as { action?: unknown } | undefined)?.action;
      emitEvent('void:braindump:submitted', {
        v: 2,
        items: [{
          module: fragment.module,
          text: fragment.text,
          intent: typeof intent === 'string' ? intent : fragment.module,
          confidence: fragment.confidence,
        }],
        raw: fragment.text,
        ts: Date.now(),
        idempotency_key: `confirm:${fragment.module}:${Date.now()}`,
        route_path: 'native:confirm',
      });
    } catch {
      /* best-effort */
    }
  }

  void runAllSyncs(store)
    .then(() => recomputeBrain(store))
    .then(() => sweepDatelessLadders(store))
    .catch((err) => {
      console.error('[bridge] post-confirm sync failed (non-fatal):', err);
    });

  return result;
}

/**
 * Surface a worker↔native module drift (audit #130). A fragment routed to a
 * module with no native handler is dropped; without telemetry that drop is
 * invisible until a user notices their dump "did nothing". We:
 *   1. log a structured `metric` line (same JSON convention as dump_roundtrip /
 *      screen_render) so it's greppable in device logs + ingestible by the
 *      telemetry tail, AND
 *   2. drop a Sentry breadcrumb when a Sentry SDK is present on the runtime
 *      global (guarded — apps/native ships Sentry via tunnel config at runtime,
 *      so the SDK may or may not be installed; never throw if it isn't).
 * Carries the module name only — never fragment text — to keep dump content out
 * of telemetry. Exported for the dispatch test that pins this branch.
 */
export function reportNoHandlerDrift(module: string): void {
  const ts = Date.now();
  console.error(
    JSON.stringify({
      metric: 'dispatch_no_handler',
      module,
      ts,
      detail: `worker↔native module drift: no handler for "${module}" — fragment NOT routed (raw dump still archived)`,
    }),
  );
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis;
    const sentry = g?.Sentry;
    if (sentry && typeof sentry.addBreadcrumb === 'function') {
      sentry.addBreadcrumb({
        category: 'dispatch',
        level: 'error',
        message: 'no_handler module drift',
        data: { module, ts },
      });
    }
  } catch {
    /* telemetry is best-effort — never break dispatch on a breadcrumb failure */
  }
}

function handlerErrorNote(module: Module, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  // Truncate for UI safety — full detail still lives in the throw stack.
  const trimmed = detail.length > 120 ? `${detail.slice(0, 120)}…` : detail;
  return `${module} handler failed: ${trimmed}`;
}
