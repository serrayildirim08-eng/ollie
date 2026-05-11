/**
 * @ollie/router · cross-module event router
 *
 * Sprint 3 · D2. Single registry of cross-module wires. Each rule reads
 * an event from the bus and dispatches a derived event into a different
 * module — usually re-emitting a friendlier event on the bus, sometimes
 * writing a "reflect" record to a target module's store slice so the
 * receiving module can render it in its UI.
 *
 * What this is NOT:
 *   - A replacement for orchestrators. Modules that own state still
 *     subscribe directly (e.g. burhan listens to its own source events).
 *   - A side-effecting business-logic layer. Rules transform + dispatch.
 *     They do not run detectors, do not call @ollie/logic.
 *
 * Debug-only lineage: every dispatched event writes a row to
 * `shared._eventLineage` (capped at LINEAGE_CAP entries) so a future
 * debug surface can show "this admin reflect came from finance bill due
 * 3 hours ago".
 */

import type { Store } from '@ollie/store';
import type { EventBus, Unsubscribe } from './types';

export interface CrossModuleRule {
  /** Source event name (must be registered in @ollie/events). */
  source: string;
  /** Target event name to re-emit, or null when the rule only reflects. */
  target: string | null;
  /** Short description — surfaced in the debug lineage view. */
  action: string;
  /**
   * Optional transform: source payload → target payload. Defaults to
   * passthrough plus a `_source_event` / `_source_ts` annotation.
   */
  transform?: (sourcePayload: unknown) => Record<string, unknown> | null;
  /**
   * Optional ttl in ms — drop dispatch if `now - source.ts > ttl`.
   * Used for time-sensitive flows like spending spikes.
   */
  ttlMs?: number;
  /**
   * Optional reflect: write to store on dispatch. The function receives
   * the target payload and returns a single { module, key, value } write
   * (additive — we read existing array and append).
   */
  reflect?: (targetPayload: Record<string, unknown>) => {
    module: string;
    key: string;
    entry: Record<string, unknown>;
  } | null;
}

export interface CrossModuleLineageEntry {
  source: string;
  target: string | null;
  action: string;
  source_ts: number;
  dispatched_at: number;
}

const LINEAGE_CAP = 200;

export const CROSS_MODULE_RULES: CrossModuleRule[] = [
  // ─── finance reminder → admin reflect ─────────────────────────────────
  {
    source: 'finance:reminder_set',
    target: 'admin:reflect_upcoming',
    action: 'reflect finance reminder in admin upcoming',
    transform: (p) => {
      const r = (p ?? {}) as { pattern_id?: string; due_at?: number; kind?: string; message?: string; ts?: number };
      if (typeof r.due_at !== 'number') return null;
      return {
        source_event: 'finance:reminder_set',
        source_module: 'finance',
        kind: r.kind ?? 'bill',
        due_at: r.due_at,
        message: r.message ?? '',
        ts: r.ts ?? Date.now(),
        pattern_id: r.pattern_id,
      };
    },
    reflect: (p) => ({
      module: 'admin',
      key: 'reflected',
      entry: {
        id: `reflect:${p.source_event}:${p.pattern_id ?? p.due_at}`,
        ...p,
      },
    }),
  },

  // ─── sleep pacing breach → habits + work ──────────────────────────────
  {
    source: 'sleep:pacing_breach_detected',
    target: 'habits:reduce_motion_on',
    action: 'sleep pacing breach reduces motion in habits',
    transform: (p) => {
      const r = (p ?? {}) as { severity?: string; ts?: number };
      return { reason: `sleep pacing breach (${r.severity ?? 'info'})`, ts: r.ts ?? Date.now() };
    },
  },
  {
    source: 'sleep:pacing_breach_detected',
    target: 'work:suggest_break',
    action: 'sleep pacing breach suggests work break',
    transform: (p) => {
      const r = (p ?? {}) as { severity?: string; ts?: number };
      return { reason: `sleep pacing breach (${r.severity ?? 'info'})`, ts: r.ts ?? Date.now() };
    },
  },

  // ─── finance spending spike → body rest check ─────────────────────────
  {
    source: 'finance:spending_spike_detected',
    target: 'body:suggest_rest_check',
    action: 'spending spike → body rest check',
    transform: (p) => {
      const r = (p ?? {}) as { amount?: number; ratio?: number; ts?: number };
      return { reason: `spending spike (${(r.ratio ?? 0).toFixed(1)}× baseline)`, ts: r.ts ?? Date.now() };
    },
    ttlMs: 24 * 60 * 60 * 1000,
  },

  // ─── habits interest hijack → work pause ──────────────────────────────
  {
    source: 'habits:interest_capture_detected',
    target: 'work:suggest_pause_marked_missed',
    action: 'interest hijack suggests pause on missed work',
    transform: (p) => {
      const r = (p ?? {}) as { ts?: number };
      return { reason: 'interest hijack detected', ts: r.ts ?? Date.now() };
    },
  },

  // ─── body hydration drop → habits surface water ───────────────────────
  {
    source: 'body:hydration_drop_detected',
    target: 'habits:surface_water_habit',
    action: 'hydration drop surfaces water habit',
    transform: (p) => {
      const r = (p ?? {}) as { drop_pct?: number; ts?: number };
      return { reason: `hydration drop ${(r.drop_pct ?? 0).toFixed(0)}%`, ts: r.ts ?? Date.now() };
    },
  },
];

export interface CrossModuleRouter {
  init(): void;
  teardown(): void;
  /** All dispatched events since boot, oldest first. Capped at LINEAGE_CAP. */
  lineage(): CrossModuleLineageEntry[];
  /** For tests / debug — fire a rule manually. */
  fire(source: string, payload: unknown): void;
}

export interface CrossModuleRouterOptions {
  rules?: CrossModuleRule[];
  now?: () => number;
}

export function createCrossModuleRouter(
  store: Store,
  bus: EventBus,
  opts: CrossModuleRouterOptions = {},
): CrossModuleRouter {
  const nowFn = opts.now ?? (() => Date.now());
  const rules = opts.rules ?? CROSS_MODULE_RULES;
  let initialized = false;
  const unsubs: Unsubscribe[] = [];

  function appendLineage(entry: CrossModuleLineageEntry): void {
    const lineage = store.get<CrossModuleLineageEntry[]>('shared', '_eventLineage', []) ?? [];
    const next = [...lineage, entry];
    if (next.length > LINEAGE_CAP) next.splice(0, next.length - LINEAGE_CAP);
    store.set('shared', '_eventLineage', next);
  }

  function lineage(): CrossModuleLineageEntry[] {
    return store.get<CrossModuleLineageEntry[]>('shared', '_eventLineage', []) ?? [];
  }

  function dispatch(rule: CrossModuleRule, sourcePayload: unknown): void {
    const sourceTs = (() => {
      const p = (sourcePayload ?? {}) as { ts?: number };
      return typeof p.ts === 'number' ? p.ts : nowFn();
    })();

    if (rule.ttlMs != null && nowFn() - sourceTs > rule.ttlMs) return;

    const target = rule.transform
      ? rule.transform(sourcePayload)
      : { ...(sourcePayload as object), _source_event: rule.source, _source_ts: sourceTs };
    if (target == null) return;

    if (rule.target) {
      try { bus.emit(rule.target, target); } catch { /* non-fatal */ }
    }

    if (rule.reflect) {
      try {
        const write = rule.reflect(target);
        if (write) {
          const existing = store.get<unknown[]>(write.module, write.key, []) ?? [];
          // Dedupe by `id` if present.
          const entryId = (write.entry as { id?: string }).id;
          if (entryId) {
            const filtered = (existing as Array<{ id?: string }>).filter((e) => e?.id !== entryId);
            store.set(write.module, write.key, [...filtered, write.entry]);
          } else {
            store.set(write.module, write.key, [...existing, write.entry]);
          }
        }
      } catch { /* non-fatal */ }
    }

    appendLineage({
      source: rule.source,
      target: rule.target,
      action: rule.action,
      source_ts: sourceTs,
      dispatched_at: nowFn(),
    });
  }

  function fire(source: string, payload: unknown): void {
    for (const rule of rules) {
      if (rule.source === source) dispatch(rule, payload);
    }
  }

  function init(): void {
    if (initialized) return;
    initialized = true;
    const uniqueSources = new Set(rules.map((r) => r.source));
    for (const source of uniqueSources) {
      unsubs.push(
        bus.on(source, (payload: unknown) => {
          for (const rule of rules) {
            if (rule.source === source) dispatch(rule, payload);
          }
        }),
      );
    }
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => {
      try { fn(); } catch { /* ignore */ }
    });
    initialized = false;
  }

  return { init, teardown, lineage, fire };
}
