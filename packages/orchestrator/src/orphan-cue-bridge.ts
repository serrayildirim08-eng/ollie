/**
 * @ollie/orchestrator · orphan-cue telemetry bridge
 *
 * Audit #3: a cluster of cross-module cue events were emitted with ZERO
 * consumers — they fell straight on the floor. Each one represents a real
 * state change a module worked to detect (a pet care gap, a duplicate
 * grocery buy, a recurring-charge candidate, medication adherence drift,
 * journal entries landing, a notification delivered). Deleting the emits
 * would throw that signal away; turning every one into a push is a
 * product decision that is not this hygiene pass's to make.
 *
 * The middle path the audit explicitly allows — a TELEMETRY BRIDGE. This
 * sub-orchestrator subscribes to those cues and records each into a
 * capped `shared._cueTelemetry` ring buffer. That gives every orphan cue
 * a genuine, deterministic consumer (so the registry no longer documents
 * dead events), makes the cue stream inspectable for debugging + the B2B
 * analytics roll-up, and carries zero notification/product risk.
 *
 * It is folded into `createOrchestrator` so it cannot be silently
 * un-wired — same reasoning as the body-weekly / body-correlation passes.
 *
 * Pure: store writes + event reads only. No I/O, no APNs.
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { Orchestrator } from './types';

/** Ring-buffer cap — last N cue records kept in shared._cueTelemetry. */
export const CUE_TELEMETRY_CAP = 200;

/**
 * The orphan cue events this bridge consumes. Each was emitted with no
 * listener before this bridge existed. Keep this list in sync with the
 * registry entries flagged in audit #3.
 */
export const BRIDGED_CUE_EVENTS = [
  'pets:care_gap_detected',
  'grocery:duplicate_detected',
  'grocery:auto_added',
  'finance:recurring_candidate_detected',
  'medication:adherence_drift',
  'journal:entries_added',
  'notifications:delivered',
] as const;

export type BridgedCueEvent = (typeof BRIDGED_CUE_EVENTS)[number];

/** One recorded cue. `payload` is the raw event payload, unmodified. */
export interface CueTelemetryEntry {
  event: BridgedCueEvent;
  /** Recorded-at epoch ms. Falls back to the wall clock when the payload
   *  carries no `ts`. */
  ts: number;
  payload: Record<string, unknown>;
}

export interface OrphanCueBridgeOptions {
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Append a cue entry to the capped `shared._cueTelemetry` ring buffer.
 * Exported for direct unit testing.
 */
export function appendCueTelemetry(
  store: Store,
  entry: CueTelemetryEntry,
  cap: number = CUE_TELEMETRY_CAP,
): void {
  const existing = store.get<CueTelemetryEntry[]>('shared', '_cueTelemetry', []) ?? [];
  const next = Array.isArray(existing) ? [...existing, entry] : [entry];
  if (next.length > cap) next.splice(0, next.length - cap);
  store.set('shared', '_cueTelemetry', next);
}

export function createOrphanCueBridge(
  store: Store,
  opts: OrphanCueBridgeOptions = {},
): Orchestrator {
  const getNow = opts.now ?? (() => Date.now());
  let initialized = false;
  const unsubs: Unsubscribe[] = [];

  function record(event: BridgedCueEvent, raw: unknown): void {
    try {
      const payload =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const tsRaw = payload.ts;
      const ts = typeof tsRaw === 'number' && Number.isFinite(tsRaw) ? tsRaw : getNow();
      appendCueTelemetry(store, { event, ts, payload });
    } catch {
      /* non-fatal — telemetry must never break a cue emitter */
    }
  }

  function init(): void {
    if (initialized) return;
    initialized = true;
    for (const event of BRIDGED_CUE_EVENTS) {
      unsubs.push(events.on(event, (raw: unknown) => record(event, raw)));
    }
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => {
      try { fn(); } catch { /* ignore */ }
    });
    initialized = false;
  }

  return { init, teardown };
}
