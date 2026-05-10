/**
 * @ollie/orchestrator · cycle
 *
 * Ported from window.VOID.orchestrator in void-app.html (~lines 23712–23928).
 * The only caller of @ollie/logic/cycle (+ symptoms / flags sub-exports).
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "cycle"):
 *   cycles           CycleRecord[] from detectBoundaries
 *   prediction       EWMA prediction object
 *   insights         symptom correlations (top 2)
 *   healthFlags      rule-based flags
 *   stats            deriveCycleStats output
 *   adherence        detectAdherenceIssue output
 *   fertileWindow    6-day fertile range (null when suppressed)
 *   correlations     per-tag correlation results (top 2)
 *   phaseName        current phase string (refreshed every 60s)
 *   flags            detectHealthFlags output (refreshed every 60s)
 *   currentDay       cycle day integer or null (refreshed every 60s)
 *   lastRecomputeAt  timestamp of most recent full recompute
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import * as cycle from '@ollie/logic/cycle';
import type { CycleItem, CycleRecord, HealthFlag } from '@ollie/logic/cycle';
import type { Orchestrator } from './types';

const CORRELATION_TAGS = ['cramps', 'bloating', 'headache', 'fatigue', 'mood swings'] as const;

export function createCycleOrchestrator(store: Store): Orchestrator & {
  recomputeCycle(): void;
} {
  let initialized = false;
  const unsubs: Unsubscribe[] = [];

  // ── time-dependent derived values ────────────────────────────────────────
  // Called on full recompute and on a 60s tick so phaseName/currentDay stay
  // in sync without UI components reading from logic directly.
  function recomputeCycleTime(
    cycles?: CycleRecord[],
    stats?: ReturnType<typeof cycle.deriveCycleStats>,
    items?: CycleItem[],
  ): void {
    const now = Date.now();
    const lastEdited = store.get<Record<string, number>>('cycle', 'lastEditedByCycle', {}) ?? {};
    const resolvedItems = items ?? store.get<CycleItem[]>('cycle', 'items', []);
    const symptomEvents = resolvedItems.filter(
      (i) => i && (i.action === 'symptom' || i.action === 'log'),
    );
    const cs = cycles ?? store.get<CycleRecord[]>('cycle', 'cycles', []);
    const st = stats ?? store.get<ReturnType<typeof cycle.deriveCycleStats>>('cycle', 'stats', {
      cycles_logged_count: 0, mean_length: null, sd_length: 0,
      mean_bleed: null, irregular_flag: false, last_period_start: null,
    });

    const phaseName = cycle.computePhaseForDate(cs, now);
    const flags = cycle.detectHealthFlags(cs, symptomEvents, now, lastEdited);
    const currentDay =
      st && st.last_period_start != null
        ? Math.floor((now - st.last_period_start) / 86_400_000) + 1
        : null;

    store.set('cycle', 'phaseName', phaseName);
    store.set('cycle', 'flags', flags);
    store.set('cycle', 'currentDay', currentDay);
  }

  // ── full recompute ────────────────────────────────────────────────────────
  function recomputeCycle(): void {
    const items = store.get<CycleItem[]>('cycle', 'items', []);
    const symptomEvents = items.filter(
      (i) => i && (i.action === 'symptom' || i.action === 'log'),
    );
    const prevCycles = store.get<CycleRecord[]>('cycle', 'cycles', []);
    const prevFlags = store.get<HealthFlag[]>('cycle', 'healthFlags', []);
    const prevPrediction = store.get<ReturnType<typeof cycle.predictNextPeriod> | null>(
      'cycle', 'prediction', null,
    );

    const cycles = cycle.detectBoundaries(items);
    const prediction = cycle.predictNextPeriod(cycles);
    const insights = cycle.findCorrelations(symptomEvents, cycles);
    const lastEdited = store.get<Record<string, number>>('cycle', 'lastEditedByCycle', {}) ?? {};
    const healthFlags = cycle.detectHealthFlags(cycles, symptomEvents, Date.now(), lastEdited);

    const stats = cycle.deriveCycleStats(cycles);
    const adherence = cycle.detectAdherenceIssue(cycles);
    const fertileWin = cycle.fertileWindow(cycles);
    const correlations = CORRELATION_TAGS
      .map((tag) => {
        const r = cycle.correlateSymptom(cycles, symptomEvents, tag);
        return r && r.hasPattern ? { tag, ...r } : null;
      })
      .filter(Boolean)
      .slice(0, 2);

    store.set('cycle', 'cycles', cycles);
    store.set('cycle', 'prediction', prediction);
    store.set('cycle', 'insights', insights);
    store.set('cycle', 'healthFlags', healthFlags);
    store.set('cycle', 'stats', stats);
    store.set('cycle', 'adherence', adherence);
    store.set('cycle', 'fertileWindow', fertileWin);
    store.set('cycle', 'correlations', correlations);
    store.set('cycle', 'lastRecomputeAt', Date.now());

    recomputeCycleTime(cycles, stats, items);

    // Events — only fire when values actually change.
    if (prediction.nextTs && (!prevPrediction || prevPrediction.nextTs !== prediction.nextTs)) {
      events.emit('void:prediction:updated', {
        nextPeriodTs: prediction.nextTs,
        confidence: prediction.confidence,
        explanation: prediction.explanation,
      });
    }

    const prevFlagKeys = new Set(prevFlags.map((f) => f.id));
    for (const f of healthFlags) {
      if (!prevFlagKeys.has(f.id)) {
        // Map HealthFlag severity ("low"|"medium") to the event registry shape.
        const severityMapped =
          f.severity === 'medium' ? 'watch' : ('info' as 'info' | 'watch' | 'discuss');
        events.emit('void:flag:raised', {
          key: f.id,
          severity: severityMapped,
          title: f.observation,
          evidence: f.sources ?? [],
        });
      }
    }

    // If a new cycle boundary appeared, note it in the store so any future
    // products orchestrator can subscribe (no separate event — not in registry).
    if (cycles.length > prevCycles.length) {
      store.set('cycle', 'cycleCount', cycles.length);
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('cycle', 'items', () => recomputeCycle()));
    unsubs.push(store.subscribeKey('cycle', 'lastEditedByCycle', () => recomputeCycleTime()));

    const tick = setInterval(() => recomputeCycleTime(), 60_000);
    unsubs.push(() => clearInterval(tick));

    // Initial derivations.
    recomputeCycle();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    initialized = false;
  }

  return { init, teardown, recomputeCycle };
}
