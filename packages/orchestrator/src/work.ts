/**
 * @ollie/orchestrator · work
 *
 * Fires W0-W17 work detectors on boot and whenever relevant store keys
 * change. UI reads `work.patterns` — it never calls logic directly.
 *
 * Derived keys written (namespace: "work"):
 *   patterns               AnyWorkPattern[] from detectPatterns
 *   patternsLastComputedAt timestamp of most recent recompute
 *
 * Subscriptions:
 *   work.tasks             → schedule recompute
 *   work.sessions          → schedule recompute
 *   work.meetings          → schedule recompute
 *   work.shutdown_log      → schedule recompute
 *   work.triage_days       → schedule recompute
 *   work.estimation_log    → schedule recompute
 *   work.crash_log         → schedule recompute
 *   work.tab_reports       → schedule recompute
 *   work.notification_tax_log → schedule recompute
 *   work.multitask_log     → schedule recompute
 *   work.rsd_anchor_log    → schedule recompute
 *   sleep.records          → schedule recompute (sleep pacing)
 *   void:braindump:submitted event → schedule recompute (work items, v≥2 guard)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import { detectPatterns } from '@ollie/logic/work';
import type { AnyWorkPattern, WorkState } from '@ollie/logic/work';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;

export function createWorkOrchestrator(
  store: Store,
  { now: nowFn }: { now?: () => number } = {},
): Orchestrator & { recomputePatterns(): void } {
  const getNow = nowFn ?? (() => Date.now());

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function recomputePatterns(): void {
    try {
      const now = getNow();

      const workState: WorkState = {
        tasks:                store.get('work', 'tasks', []) ?? [],
        sessions:             store.get('work', 'sessions', []) ?? [],
        meetings:             store.get('work', 'meetings', []) ?? [],
        recurring_meetings:   store.get('work', 'recurring_meetings', []) ?? [],
        shutdown_log:         store.get('work', 'shutdown_log', []) ?? [],
        triage_days:          store.get('work', 'triage_days', []) ?? [],
        estimation_log:       store.get('work', 'estimation_log', []) ?? [],
        meeting_buffer:       store.get('work', 'meeting_buffer', undefined) ?? undefined,
        one_more_thing_log:   store.get('work', 'one_more_thing_log', []) ?? [],
        crash_log:            store.get('work', 'crash_log', []) ?? [],
        tab_reports:          store.get('work', 'tab_reports', []) ?? [],
        notification_tax_log: store.get('work', 'notification_tax_log', []) ?? [],
        multitask_log:        store.get('work', 'multitask_log', []) ?? [],
        rsd_anchor_log:       store.get('work', 'rsd_anchor_log', []) ?? [],
      };

      const sleepRecords = store.get<Array<{ hours?: number }>>('sleep', 'records', []) ?? [];
      const lastSleep = sleepRecords.length > 0 ? sleepRecords[sleepRecords.length - 1] : null;
      const sleepHours = typeof lastSleep?.hours === 'number' ? lastSleep.hours : null;

      const prev = store.get<AnyWorkPattern[]>('work', 'patterns', []) ?? [];
      const prevKeys = new Set(
        (Array.isArray(prev) ? prev : []).map((p) => p?.pattern).filter(Boolean),
      );

      const patterns = detectPatterns(workState, {
        consent: true,
        now,
        sleep: sleepHours !== null ? { hours: sleepHours } : null,
      });

      store.set('work', 'patterns', patterns);
      store.set('work', 'patternsLastComputedAt', now);

      // Credibility audit NC2: hyperfocus = a single sustained session
      // ≥ 3h (180 min) inside the focus log within the last 24h. Emit
      // once per session id; cross-module router routes to body
      // fatigue-warning surface.
      try {
        const focusLog = store.get<Array<{ ts?: number; duration_ms?: number }>>('work', 'focus_log', []) ?? [];
        const cutoff = now - 24 * 3600_000;
        const seenIds = new Set(store.get<string[]>('work', '_hyperfocusEmittedIds', []) ?? []);
        const fresh: string[] = [];
        for (const s of focusLog) {
          if (!s?.ts || !s.duration_ms) continue;
          if (s.ts < cutoff) continue;
          const minutes = s.duration_ms / 60_000;
          if (minutes < 180) continue;
          const id = `${s.ts}`;
          if (seenIds.has(id)) continue;
          events.emit('work:hyperfocus_detected', { minutes: Math.round(minutes), ts: s.ts });
          fresh.push(id);
        }
        if (fresh.length) {
          store.set('work', '_hyperfocusEmittedIds', [...seenIds, ...fresh]);
        }
      } catch { /* non-fatal */ }

      if (Array.isArray(patterns)) {
        for (const p of patterns) {
          if (p?.pattern && !prevKeys.has(p.pattern)) {
            events.emit('work:pattern_detected', {
              pattern: p.pattern,
              confidence: (p as { confidence?: string }).confidence ?? 'low',
              sample_n: (p as { sample_n?: number }).sample_n ?? 0,
              ts: now,
            });
          }
        }
      }
    } catch (e) {
      console.error('[orchestrator/work] recompute failed:', e);
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recomputePatterns(); }, DEBOUNCE_MS);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('work', 'tasks', schedule));
    unsubs.push(store.subscribeKey('work', 'sessions', schedule));
    unsubs.push(store.subscribeKey('work', 'meetings', schedule));
    unsubs.push(store.subscribeKey('work', 'shutdown_log', schedule));
    unsubs.push(store.subscribeKey('work', 'triage_days', schedule));
    unsubs.push(store.subscribeKey('work', 'estimation_log', schedule));
    unsubs.push(store.subscribeKey('work', 'crash_log', schedule));
    unsubs.push(store.subscribeKey('work', 'tab_reports', schedule));
    unsubs.push(store.subscribeKey('work', 'notification_tax_log', schedule));
    unsubs.push(store.subscribeKey('work', 'multitask_log', schedule));
    unsubs.push(store.subscribeKey('work', 'rsd_anchor_log', schedule));
    unsubs.push(store.subscribeKey('sleep', 'records', schedule));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string }> };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'work');
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
