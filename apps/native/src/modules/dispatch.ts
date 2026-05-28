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

  return { entries, crisisSkipped: false };
}

function handlerErrorNote(module: Module, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  // Truncate for UI safety — full detail still lives in the throw stack.
  const trimmed = detail.length > 120 ? `${detail.slice(0, 120)}…` : detail;
  return `${module} handler failed: ${trimmed}`;
}
