/**
 * @ollie/orchestrator · braindump-dispatch
 *
 * Public dispatcher API. Wraps dissection.extract() + writes each
 * routed Action into the right store slice. Lives here (not in
 * @ollie/logic) so the logic package stays pure (no store dep).
 *
 * Audit-task 1 (2026-05-14): the work + goals routes used to land
 * in <module>.items. They now populate work.tasks, work.meetings,
 * goals.items[] with proper schema, so the existing W-* and G-*
 * pattern detectors actually see the data.
 *
 * The store-write semantics intentionally mirror
 * apps/web/src/hooks/applyRoute.ts; if you change one, update both.
 */

import type { Store } from '@ollie/store';
import { extract } from '@ollie/logic/dissection';
import type { Action, Route } from '@ollie/logic/dissection';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export interface RouteBrainDumpResult {
  isAnswer: boolean;
  actions: Action[];
  modulesHit: string[];
}

/**
 * routeBrainDump — extract + apply.
 *
 * Question text → no writes, isAnswer: true.
 * Empty list → no-op.
 *
 * @param text   raw user input
 * @param store  app store (apps/web or memory adapter in tests)
 * @param now    injected clock for tests; defaults to Date.now()
 */
export function routeBrainDump(
  text: string,
  store: Store,
  now: number = Date.now(),
): RouteBrainDumpResult {
  const route: Route = extract(text);

  if (!Array.isArray(route)) {
    return { isAnswer: true, actions: [], modulesHit: [] };
  }

  const modulesHit = new Set<string>();
  for (const action of route) {
    modulesHit.add(action.module);
    dispatchAction(action, store, now);
  }

  return {
    isAnswer: false,
    actions: route,
    modulesHit: [...modulesHit],
  };
}

/** Write a single routed Action to the appropriate store slice. */
export function dispatchAction(
  action: Action,
  store: Store,
  now: number = Date.now(),
): void {
  const { module, action: kind, data } = action;
  const ts = now;

  // ── grocery ──────────────────────────────────────────────────────────
  if (module === 'grocery' && kind === 'add') {
    store.update<Array<{ id: string; name: string; ts: number; checked: boolean }>>(
      'grocery',
      'items',
      (cur) => [...(cur ?? []), { id: newId(), name: data, ts, checked: false }],
    );
    return;
  }
  if (module === 'grocery' && kind === 'log') {
    store.update<Array<{ id: string; name: string; ts: number; boughtTs: number }>>(
      'grocery',
      'pantry',
      (cur) => [...(cur ?? []), { id: newId(), name: data, ts, boughtTs: ts }],
    );
    return;
  }

  // ── cycle ────────────────────────────────────────────────────────────
  if (module === 'cycle') {
    store.update<Array<{ ts: number; action: string; text: string }>>(
      'cycle',
      'items',
      (cur) => [...(cur ?? []), { ts, action: kind, text: data }],
    );
    return;
  }

  // ── work ────────────────────────────────────────────────────────────
  if (module === 'work') {
    const lower = data.toLowerCase();
    // Turkish "ı" breaks \b word boundaries; use a tolerant lookbehind-free
    // check that catches "meeting" + Turkish "toplantı"/"toplanti" anywhere.
    if (/\bmeeting\b/i.test(lower) || /toplant[ıi]/i.test(lower)) {
      store.update<
        Array<{ id: string; title: string; start_at: number; end_at: number }>
      >('work', 'meetings', (cur) => [
        ...(cur ?? []),
        { id: newId(), title: data, start_at: ts, end_at: ts + 30 * 60_000 },
      ]);
      return;
    }
    // deadline / project / focus / generic task → tasks
    store.update<Array<{ id: string; title: string; created_at: number }>>(
      'work',
      'tasks',
      (cur) => [...(cur ?? []), { id: newId(), title: data, created_at: ts }],
    );
    return;
  }

  // ── goals ───────────────────────────────────────────────────────────
  if (module === 'goals') {
    store.update<
      Array<{ id: string; title: string; created_at: number; status: string }>
    >('goals', 'items', (cur) => [
      ...(cur ?? []),
      { id: newId(), title: data, created_at: ts, status: 'active' },
    ]);
    return;
  }

  // ── body ────────────────────────────────────────────────────────────
  if (module === 'body') {
    const lower = data.toLowerCase();
    if (/glass|water|içtim|drank|drunk|hydrat/i.test(lower)) {
      store.update<Array<{ ts: number }>>(
        'body',
        'water_log',
        (cur) => [...(cur ?? []), { ts }],
      );
      return;
    }
    if (/vitamin|supplement|d3|magnesium|omega|zinc|iron|b12|probiotic|tablet|capsule/i.test(lower)) {
      store.update<Array<{ id: string; text: string; ts: number }>>(
        'body',
        'supplements',
        (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
      );
      return;
    }
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'body',
      'items',
      (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
    );
    return;
  }

  // ── astrology → dump ────────────────────────────────────────────────
  if (module === 'astrology') {
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'dump',
      'items',
      (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
    );
    return;
  }

  // ── default: <module>.items generic shape
  store.update<Array<{ id: string; text: string; ts: number }>>(
    module,
    'items',
    (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
  );
}
