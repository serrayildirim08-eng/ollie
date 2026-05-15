/**
 * @ollie/orchestrator · patterns
 *
 * Cross-module pattern sub-orchestrator. The only caller of
 * @ollie/logic/patterns detectPatterns. Reads the full state
 * (cycle + sleep + finance + dump) and writes derived cross-module
 * patterns to shared.patterns.
 *
 * Derived keys written (namespace: "shared"):
 *   patterns               PatternResult[] from detectPatterns
 *   patternsLastComputedAt timestamp of most recent recompute
 *
 * Subscriptions (upstream changes that trigger a throttled recompute):
 *   cycle.cycles           → schedule recompute
 *   cycle.items            → schedule recompute (symptom events)
 *   sleep.records          → schedule recompute
 *   finance.records        → schedule recompute
 *   dump.items             → schedule recompute
 *
 * Module-pattern sink (consolidation of the 6 orphaned `*:pattern_detected`
 * events — goals/sleep/work/finance/habits/grocery):
 *   Each module's own pattern detector emits `<module>:pattern_detected`
 *   when it first sees a pattern. Those events had zero consumers — the UI
 *   recomputed patterns itself, so the events fell on the floor and a
 *   notification opportunity was lost. This orchestrator is the single,
 *   consistent consumer: it appends a quiet card to `shared.moduleInsights`
 *   and (when scheduleNotification is injected) raises one PATTERN_ALERT
 *   push per pattern. Mirrors body-correlations' `pattern:detected` →
 *   APNs idiom, kept module-scoped here so the body correlation payload
 *   (correlation_name/copy) and the module payload (pattern/confidence)
 *   don't collide on one event name.
 *
 * Derived key written for the sink:
 *   shared.moduleInsights  ModuleInsight[]  (capped, newest-last)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import { detectPatterns } from '@ollie/logic/patterns';
import type {
  PatternResult,
  SleepSession,
  FinanceTransaction,
  DumpEntry,
} from '@ollie/logic/patterns';
import type { CycleRecord, SymptomEvent } from '@ollie/logic/cycle';
import type { Orchestrator } from './types';

const DEFAULT_THROTTLE_MS = 2_000;

/** The 6 module pattern events this orchestrator consolidates. */
const MODULE_PATTERN_EVENTS = [
  'goals:pattern_detected',
  'sleep:pattern_detected',
  'work:pattern_detected',
  'finance:pattern_detected',
  'habits:pattern_detected',
  'grocery:pattern_detected',
] as const;

/** Max insight cards kept in shared.moduleInsights (newest-last). */
const MODULE_INSIGHTS_CAP = 50;

/** A quiet, surfaced module pattern — read by the insights UI layer. */
export interface ModuleInsight {
  /** Source module id, derived from the event name. */
  module: string;
  /** The pattern key the module's detector produced. */
  pattern: string;
  /** Detector confidence, when the module supplied one. */
  confidence?: string;
  /** Sample size behind the pattern, when supplied. */
  sample_n?: number;
  /** Detection timestamp. */
  ts: number;
}

export function createPatternsOrchestrator(
  store: Store,
  {
    now: nowFn,
    throttleMs,
    scheduleNotification,
  }: {
    now?: () => number;
    throttleMs?: number;
    /**
     * APNs push scheduler — injected by the app boot layer. Omit in tests
     * and contexts without APNs. When omitted the module-pattern sink
     * still writes shared.moduleInsights; only the push is skipped.
     */
    scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
  } = {},
): Orchestrator & { recompute(): void } {
  const getNow = nowFn ?? (() => Date.now());
  const THROTTLE_MS = throttleMs ?? DEFAULT_THROTTLE_MS;
  const pushNotification = scheduleNotification ?? null;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRunAt = 0;

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Convert a sleep record's night_of ('YYYY-MM-DD') to a noon-epoch ts. */
  function nightOfToTs(nightOf: unknown): number | null {
    if (typeof nightOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(nightOf)) return null;
    const d = new Date(nightOf + 'T12:00:00');
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function getCycles(): CycleRecord[] {
    return store.get<CycleRecord[]>('cycle', 'cycles', []) ?? [];
  }

  function getSymptomEvents(): SymptomEvent[] {
    const items = store.get<Array<{ ts?: number; action?: string; text?: string }>>('cycle', 'items', []) ?? [];
    return items
      .filter((i) => i && typeof i.ts === 'number' && (i.action === 'symptom' || i.action === 'log'))
      .map((i) => ({ ts: i.ts as number, text: i.text ?? '' }));
  }

  function getSleepSessions(): SleepSession[] {
    const records = store.get<Array<{ night_of?: string; tst_min?: number; is_skipped?: boolean }>>('sleep', 'records', []) ?? [];
    return records
      .filter((r) => r && !r.is_skipped && typeof r.tst_min === 'number' && isFinite(r.tst_min))
      .map((r) => {
        const ts = nightOfToTs(r.night_of);
        return ts != null ? { ts, tstMinutes: r.tst_min as number } : null;
      })
      .filter((s): s is SleepSession => s != null);
  }

  function getTransactions(): FinanceTransaction[] {
    const records = store.get<Array<{
      ts?: number;
      event_date?: string;
      direction?: string;
      amount?: number;
      category?: string;
      category_l1?: string;
    }>>('finance', 'records', []) ?? [];
    const out: FinanceTransaction[] = [];
    for (const r of records) {
      if (!r || r.direction !== 'expense' || typeof r.amount !== 'number' || !isFinite(r.amount)) continue;
      const ts = typeof r.ts === 'number'
        ? r.ts
        : (typeof r.event_date === 'string' ? (nightOfToTs(r.event_date) ?? null) : null);
      if (ts == null) continue;
      out.push({ ts, amount: r.amount, category: r.category ?? r.category_l1 });
    }
    return out;
  }

  function getDumps(): DumpEntry[] {
    const items = store.get<Array<{ ts?: number; text?: string; rawText?: string }>>('dump', 'items', []) ?? [];
    return items
      .filter((d) => d && typeof d.ts === 'number')
      .map((d) => ({ ts: d.ts as number, rawText: d.rawText ?? d.text, text: d.text ?? d.rawText }));
  }

  function getLastEditedByCycle(): Record<number, number> {
    return store.get<Record<number, number>>('cycle', 'lastEditedByCycle', {}) ?? {};
  }

  // ── recompute ─────────────────────────────────────────────────────────────

  function recompute(): void {
    try {
      const now = getNow();
      lastRunAt = now;

      const cycles = getCycles();
      const symptomEvents = getSymptomEvents();
      const sleepSessions = getSleepSessions();
      const transactions = getTransactions();
      const dumps = getDumps();
      const lastEditedByCycle = getLastEditedByCycle();

      const patterns: PatternResult[] = detectPatterns({
        cycles,
        symptomEvents,
        sleepSessions,
        transactions,
        dumps,
        lastEditedByCycle,
        now,
      });

      store.set('shared', 'patterns', patterns);
      store.set('shared', 'patternsLastComputedAt', now);
    } catch (e) {
      console.error('[orchestrator/patterns] recompute failed:', e);
    }
  }

  // ── module-pattern sink (6 orphaned *:pattern_detected events) ────────────

  /**
   * Handle one `<module>:pattern_detected` event: append a card to
   * shared.moduleInsights (deduped per module+pattern) and, when a
   * scheduler is wired, raise one PATTERN_ALERT push.
   */
  function onModulePattern(eventName: string, raw: unknown): void {
    try {
      const p = (raw ?? {}) as {
        pattern?: unknown;
        confidence?: unknown;
        sample_n?: unknown;
        ts?: unknown;
      };
      if (typeof p.pattern !== 'string' || p.pattern.length === 0) return;

      const module = eventName.split(':')[0] ?? eventName;
      const ts = typeof p.ts === 'number' ? p.ts : getNow();
      const confidence = typeof p.confidence === 'string' ? p.confidence : undefined;
      const sample_n = typeof p.sample_n === 'number' ? p.sample_n : undefined;

      const prev = store.get<ModuleInsight[]>('shared', 'moduleInsights', []) ?? [];
      // Dedup: one card per module+pattern. The module's own detector
      // only emits on first detection, but a teardown/re-init replays
      // cold-start patterns — this guard keeps the list stable.
      if (prev.some((c) => c.module === module && c.pattern === p.pattern)) return;

      const next = [...prev, { module, pattern: p.pattern, confidence, sample_n, ts }];
      // Cap newest-last so the UI can render a bounded recent list.
      store.set(
        'shared',
        'moduleInsights',
        next.length > MODULE_INSIGHTS_CAP ? next.slice(-MODULE_INSIGHTS_CAP) : next,
      );

      if (pushNotification) {
        const label = p.pattern.replace(/_/g, ' ');
        pushNotification(
          {
            title: `${module}: noticed a pattern — ${label}.`,
            category: 'PATTERN_ALERT',
            // One push per module+pattern, ever — the pattern is a
            // standing observation, not a recurring deadline.
            dedupe_key: `pattern:${module}:${p.pattern}`,
            action_url: `/${module}`,
          },
          ts,
        );
      }
    } catch (e) {
      console.error('[orchestrator/patterns] module-pattern sink failed:', e);
    }
  }

  // ── throttled schedule ────────────────────────────────────────────────────

  function schedule(): void {
    if (timer) return; // already pending
    const now = getNow();
    const elapsed = now - lastRunAt;
    const delay = elapsed >= THROTTLE_MS ? 0 : THROTTLE_MS - elapsed;
    timer = setTimeout(() => {
      timer = null;
      recompute();
    }, delay);
  }

  // ── init / teardown ──────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('cycle', 'cycles', schedule));
    unsubs.push(store.subscribeKey('cycle', 'items', schedule));
    unsubs.push(store.subscribeKey('sleep', 'records', schedule));
    unsubs.push(store.subscribeKey('finance', 'records', schedule));
    unsubs.push(store.subscribeKey('dump', 'items', schedule));

    // Module-pattern sink — single consistent consumer for the 6
    // previously-orphaned `<module>:pattern_detected` events.
    for (const eventName of MODULE_PATTERN_EVENTS) {
      unsubs.push(
        events.on(eventName, (raw: unknown) => onModulePattern(eventName, raw)),
      );
    }

    // Cold start — run immediately.
    recompute();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    if (timer) { clearTimeout(timer); timer = null; }
    initialized = false;
  }

  return { init, teardown, recompute };
}
