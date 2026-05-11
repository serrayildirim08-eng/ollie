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
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
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

export function createPatternsOrchestrator(
  store: Store,
  { now: nowFn, throttleMs }: { now?: () => number; throttleMs?: number } = {},
): Orchestrator & { recompute(): void } {
  const getNow = nowFn ?? (() => Date.now());
  const THROTTLE_MS = throttleMs ?? DEFAULT_THROTTLE_MS;

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
