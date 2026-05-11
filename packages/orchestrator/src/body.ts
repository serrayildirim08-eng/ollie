/**
 * @ollie/orchestrator · body
 *
 * Ported from window.VOID.orchestrator.body in void-app.html (~lines 24259–24385).
 * The only caller of @ollie/logic/body detectPatterns.
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "body"):
 *   patterns               AnyBodyPattern[] from detectPatterns
 *   patternsLastComputedAt timestamp of most recent recompute
 *
 * Subscriptions:
 *   body.water_log         → schedule recompute
 *   body.supplements       → schedule recompute
 *   body.episodes          → schedule recompute
 *   shared.actionLog       → schedule recompute (dump undo path)
 *   cycle.cycles           → schedule recompute (phase coupling)
 *   sleep.records          → schedule recompute (sleep debt lag)
 *   void:braindump:submitted event → schedule recompute (body items only, v≥2 guard)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import { detectPatterns } from '@ollie/logic/body';
import type { AnyBodyPattern, CyclePhaseRange, SleepRecord, WaterEntry, SupplementLogEntry } from '@ollie/logic/body';
import { computePhaseForDate } from '@ollie/logic/cycle';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;

export function createBodyOrchestrator(
  store: Store,
  { now: nowFn }: { now?: () => number } = {},
): Orchestrator & { recomputePatterns(): void } {
  const getNow = nowFn ?? (() => Date.now());

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Build a step-function phase array from cycle.cycles covering the past
  // 90 days. Used by detectSymptomPhaseCoupling.
  function buildCyclePhases(cycles: unknown[], fromTs: number, toTs: number): CyclePhaseRange[] {
    if (!Array.isArray(cycles) || cycles.length === 0) return [];
    const out: CyclePhaseRange[] = [];
    let curStart = fromTs;
    let curName: string | null = null;
    for (let t = fromTs; t <= toTs; t += 86_400_000) {
      let phase: string | null = null;
      try { phase = computePhaseForDate(cycles as Parameters<typeof computePhaseForDate>[0], t); } catch { phase = null; }
      if (curName === null) { curName = phase; curStart = t; continue; }
      if (phase !== curName) {
        if (curName) out.push({ start: curStart, end: t - 86_400_000, name: curName });
        curName = phase; curStart = t;
      }
    }
    if (curName) out.push({ start: curStart, end: toTs, name: curName });
    return out;
  }

  function recomputePatterns(): void {
    try {
      const now = getNow();

      const actionLog = store.get<Array<{ ts: number; rawText?: string; undone?: boolean }>>('shared', 'actionLog', []) ?? [];
      const waterLog = store.get<WaterEntry[]>('body', 'water_log', []) ?? [];
      const supplementLog = store.get<SupplementLogEntry[]>('body', 'supplements', []) ?? [];
      const sleepRecords = store.get<SleepRecord[]>('sleep', 'records', []) ?? [];
      const rawCycles = store.get<unknown[]>('cycle', 'cycles', []) ?? [];

      const dumps = actionLog
        .filter((e) => e && !e.undone && typeof e.ts === 'number' && typeof e.rawText === 'string')
        .map((e) => ({ ts: e.ts, rawText: e.rawText as string }));

      const cyclePhases = buildCyclePhases(rawCycles, now - 90 * 86_400_000, now);

      const prev = store.get<AnyBodyPattern[]>('body', 'patterns', []) ?? [];
      const prevKeys = new Set(
        (Array.isArray(prev) ? prev : []).map((p) => p?.pattern).filter(Boolean),
      );

      const patterns = detectPatterns(
        { dumps, waterLog, supplementLog, sleepRecords, cyclePhases, now },
      );

      store.set('body', 'patterns', patterns);
      store.set('body', 'patternsLastComputedAt', now);

      // Credibility audit NC2: hydration drop. WaterEntry is either a
      // bare ts number or `{ ts, glasses? }` — normalize then compare.
      try {
        const target = store.get<number>('body', 'water_target', 8) ?? 8;
        const dayMs = 86_400_000;
        const todayStart = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
        const entryTs = (w: WaterEntry): number => typeof w === 'number' ? w : (w?.ts ?? 0);
        const todayCount = waterLog.filter((w) => { const t = entryTs(w); return t >= todayStart && t < todayStart + dayMs; }).length;
        const last7Start = todayStart - 7 * dayMs;
        const last7Count = waterLog.filter((w) => { const t = entryTs(w); return t >= last7Start && t < todayStart; }).length;
        const baselineDaily = last7Count / 7;
        const minutesIntoDay = Math.max(1, (now - todayStart) / 60_000);
        const projectedToday = todayCount * (1440 / minutesIntoDay);
        const dropPct = baselineDaily > 0 ? Math.max(0, (1 - projectedToday / baselineDaily) * 100) : 0;
        const lastEmit = store.get<number>('body', '_hydrationEmittedAt', 0) ?? 0;
        if (baselineDaily >= 2 && dropPct >= 30 && projectedToday < target && now - lastEmit > 24 * 3600_000) {
          events.emit('body:hydration_drop_detected', { drop_pct: Math.round(dropPct), ts: now });
          store.set('body', '_hydrationEmittedAt', now);
        }
      } catch { /* non-fatal */ }

      if (Array.isArray(patterns)) {
        for (const p of patterns) {
          if (p?.pattern && !prevKeys.has(p.pattern)) {
            events.emit('body:pattern_detected', {
              pattern: p.pattern,
              confidence: (p as { confidence?: string }).confidence ?? 'low',
              sample_n: (p as { sample_n?: number }).sample_n ?? 0,
              ts: now,
            });
          }
        }
      }
    } catch (e) {
      console.error('[orchestrator/body] recompute failed:', e);
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recomputePatterns(); }, DEBOUNCE_MS);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('body', 'water_log', schedule));
    unsubs.push(store.subscribeKey('body', 'supplements', schedule));
    unsubs.push(store.subscribeKey('body', 'episodes', schedule));
    unsubs.push(store.subscribeKey('shared', 'actionLog', schedule));
    unsubs.push(store.subscribeKey('cycle', 'cycles', schedule));
    unsubs.push(store.subscribeKey('sleep', 'records', schedule));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string }> };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'body');
            if (myItems.length > 0) schedule();
            return;
          }
          schedule();
        } catch {
          schedule();
        }
      }),
    );

    // Cold start — populate patterns immediately.
    schedule();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (timer) { clearTimeout(timer); timer = null; }
    initialized = false;
  }

  return { init, teardown, recomputePatterns };
}
