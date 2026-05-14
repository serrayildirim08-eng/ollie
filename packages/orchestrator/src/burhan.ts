/**
 * @ollie/orchestrator · burhan
 *
 * Sprint 3 · D1. The only writer of `burhan.events`.
 *
 * Constitutional rule (brand book): "Burhan never decays based on user
 * behavior." This orchestrator only APPENDS. It does not subscribe to
 * a "decay tick", a "miss" event, or anything that could shrink the tree.
 *
 * Listens to:
 *   cycle:period_logged              → flower
 *   finance:subscription_cancelled   → fruit
 *   admin:appointment_completed      → leaf  (or canopy_fruit if kind=doctor)
 *   finance:bill_paid_on_time        → gold_leaf
 *   body:doctor_visit_completed      → canopy_fruit
 *   habits:completed                 → leaf
 *   burhan:add_*                     → matching element (manual / cross-wire)
 *
 * Writes:
 *   burhan.events       BurhanEvent[]   append-only
 *   burhan.lastAddedAt  number          ts of most recent add
 *
 * Emits:
 *   burhan:element_added              every time the tree grows
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  addEvent,
  elementTypeFor,
  type BurhanElementType,
  type BurhanEvent,
  type BurhanState,
} from '@ollie/logic/burhan';
import type { Orchestrator } from './types';

const SOURCE_EVENTS = [
  'cycle:period_logged',
  'finance:subscription_cancelled',
  'admin:appointment_completed',
  'finance:bill_paid_on_time',
  'body:doctor_visit_completed',
  'habits:completed',
  'burhan:add_leaf',
  'burhan:add_gold_leaf',
  'burhan:add_fruit',
  'burhan:add_flower',
  'burhan:add_canopy_fruit',
] as const;

type SourceEvent = (typeof SOURCE_EVENTS)[number];

export interface BurhanOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
}

export function createBurhanOrchestrator(
  store: Store,
  opts: BurhanOrchestratorOptions = {},
): Orchestrator & { handle(eventName: string, payload: unknown): void } {
  const nowFn = opts.now ?? (() => Date.now());
  let initialized = false;
  const unsubs: Unsubscribe[] = [];

  function getState(): BurhanState {
    return store.get<BurhanState>('burhan', 'state', { events: [] }) ?? { events: [] };
  }

  function deriveType(
    eventName: SourceEvent,
    payload: { kind?: string } | null | undefined,
  ): BurhanElementType | null {
    // admin appointments with kind=doctor → canopy_fruit
    if (eventName === 'admin:appointment_completed' && payload?.kind === 'doctor') {
      return 'canopy_fruit';
    }
    return elementTypeFor(eventName);
  }

  function append(ev: BurhanEvent): void {
    const next = addEvent(getState(), ev);
    // addEvent dedupes by id — only write + emit if state actually changed.
    const prevLen = getState().events.length;
    if (next.events.length === prevLen) return;
    store.set('burhan', 'state', next);
    store.set('burhan', 'lastAddedAt', ev.ts);
    try {
      events.emit('burhan:element_added', {
        id: ev.id,
        type: ev.type,
        source_module: ev.source_module,
        source_event_id: ev.source_event_id,
        ts: ev.ts,
      });
    } catch {
      /* non-fatal */
    }
  }

  function handle(eventName: string, rawPayload: unknown): void {
    if (!SOURCE_EVENTS.includes(eventName as SourceEvent)) return;
    const payload = (rawPayload ?? {}) as {
      ts?: number;
      source_event_id?: string;
      kind?: string;
    };
    const type = deriveType(eventName as SourceEvent, payload);
    if (!type) return;
    const ts = typeof payload.ts === 'number' ? payload.ts : nowFn();
    const sourceEventId =
      typeof payload.source_event_id === 'string' && payload.source_event_id
        ? payload.source_event_id
        : `${eventName}:${ts}`;
    const id = `burhan:${eventName}:${sourceEventId}`;
    const sourceModule = eventName.split(':')[0] ?? 'unknown';
    append({ id, type, ts, source_module: sourceModule, source_event_id: sourceEventId });
  }

  function init(): void {
    if (initialized) return;
    initialized = true;
    for (const name of SOURCE_EVENTS) {
      unsubs.push(events.on(name, (p) => handle(name, p)));
    }
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => {
      try { fn(); } catch { /* ignore */ }
    });
    initialized = false;
  }

  return { init, teardown, handle };
}
