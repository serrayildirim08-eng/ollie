/**
 * @ollie/orchestrator · habits
 *
 * Fires all 16 habit detectors on boot and whenever relevant store keys
 * change. UI reads `habits.patterns` — it never calls logic directly.
 *
 * Derived keys written (namespace: "habits"):
 *   patterns               AnyHabitsResult[] from detectPatterns
 *   patternsLastComputedAt timestamp of most recent recompute
 *
 * Subscriptions:
 *   shared.habits_v2       → schedule recompute + scan completions
 *   shared.actionLog       → schedule recompute
 *   sleep.records          → schedule recompute (sleep-habit coupling)
 *   cycle.cycles           → schedule recompute (luteal collapse)
 *   goals.items            → schedule recompute (keystone anchor)
 *   work.sessions          → schedule recompute (hyperfocus spillover)
 *   void:braindump:submitted event → schedule recompute (habits items, v≥2 guard)
 *
 * Emits:
 *   habits:completed       when a habit is marked done for the first time today
 *                          Dedup: one emit per habitId per calendar day (UTC date string).
 *                          Toggling off then back on within the same day does NOT re-emit.
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import { detectPatterns } from '@ollie/logic/habits';
import type { AnyHabitsResult, Habit, HabitCompletion } from '@ollie/logic/habits';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;

type HabitsCompletedCategory = 'health' | 'mental' | 'home' | 'work' | 'self_care';

// Best-effort mapping from cueTime to category.
// Habits can add a `category` field in future; for now we infer from cueTime.
function inferCategory(cueTime?: string): HabitsCompletedCategory {
  if (cueTime === 'morning') return 'health';
  if (cueTime === 'evening') return 'mental';
  return 'self_care';
}

export function createHabitsOrchestrator(
  store: Store,
  { now: nowFn }: { now?: () => number } = {},
): Orchestrator & { recomputePatterns(): void } {
  const getNow = nowFn ?? (() => Date.now());

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Dedup set: "habitId:YYYY-MM-DD" entries that have already emitted habits:completed.
  // Cleared on teardown so tests are isolated.
  const emittedCompletions = new Set<string>();

  function scanCompletions(): void {
    const now = getNow();
    const todayKey = new Date(now).toISOString().slice(0, 10);
    const habitsRaw = store.get<Array<Habit & { cueTime?: string }>>('shared', 'habits_v2', []) ?? [];

    for (const h of habitsRaw) {
      if (!h?.id || !Array.isArray(h.completions)) continue;
      const last = h.completions[h.completions.length - 1] as { ts?: number } | undefined;
      if (!last || typeof last.ts !== 'number') continue;

      const completionDay = new Date(last.ts).toISOString().slice(0, 10);
      if (completionDay !== todayKey) continue;

      const dedupKey = `${h.id}:${todayKey}`;
      if (emittedCompletions.has(dedupKey)) continue;

      emittedCompletions.add(dedupKey);
      events.emit('habits:completed', {
        habitId: h.id,
        category: inferCategory(h.cueTime),
        habitName: typeof h.name === 'string' ? h.name : '',
        ts: last.ts,
      });
    }
  }

  function recomputePatterns(): void {
    try {
      const now = getNow();

      const habitsRaw = store.get<Habit[]>('shared', 'habits_v2', []) ?? [];
      const actionLog = store.get<Array<{ ts: number; rawText?: string; undone?: boolean }>>('shared', 'actionLog', []) ?? [];
      const sleepRecords = store.get<Array<{ ts?: number; night_of?: string; tst_min?: number; hours?: number; is_skipped?: boolean }>>('sleep', 'records', []) ?? [];
      const rawCycles = store.get<unknown[]>('cycle', 'cycles', []) ?? [];
      const goals = store.get<Array<{ created_at?: number; title?: string }>>('goals', 'items', []) ?? [];
      const workSessions = store.get<Array<{ session_at?: number; ts?: number; reply?: string }>>('work', 'sessions', []) ?? [];

      // Flatten completions from embedded habit objects into a flat array
      const completions: HabitCompletion[] = [];
      for (const h of habitsRaw) {
        if (Array.isArray(h.completions)) {
          for (const c of h.completions) {
            completions.push({ ...c, habit_id: h.id });
          }
        }
      }

      const dumps = actionLog
        .filter((e) => e && !e.undone && typeof e.ts === 'number')
        .map((e) => ({ ts: e.ts, rawText: e.rawText ?? '' }));

      const prev = store.get<Array<Record<string, unknown>>>('habits', 'patterns', []) ?? [];
      const prevKeys = new Set(
        (Array.isArray(prev) ? prev : []).map((p) => {
          return String(p?.pattern ?? '');
        }).filter(Boolean),
      );

      const patterns = detectPatterns(
        {
          now,
          habits: habitsRaw,
          completions,
          dumps,
          sleepRecords,
          cyclePhases: rawCycles as never,
          goals,
          workCrashLog: workSessions as never,
        },
      );

      store.set('habits', 'patterns', patterns);
      store.set('habits', 'patternsLastComputedAt', now);

      // flat(Infinity) on the recursive AnyHabitsResult type causes TS deep-
      // instantiation errors; cast to unknown[] first to avoid it.
      const flat = Array.isArray(patterns) ? (patterns as unknown[]).flat(Infinity) : [];
      for (const p of flat) {
        const item = p as { pattern?: string; confidence?: string; sample_n?: number };
        if (item?.pattern && !prevKeys.has(item.pattern)) {
          events.emit('habits:pattern_detected', {
            pattern: item.pattern,
            confidence: item.confidence ?? 'low',
            sample_n: item.sample_n ?? 0,
            ts: now,
          });
        }
      }
    } catch (e) {
      console.error('[orchestrator/habits] recompute failed:', e);
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recomputePatterns(); }, DEBOUNCE_MS);
  }

  // Called synchronously on each habits_v2 change so completion events
  // fire as quickly as the store write lands (no debounce delay).
  function scheduleWithCompletionScan(): void {
    scanCompletions();
    schedule();
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('shared', 'habits_v2', scheduleWithCompletionScan));
    unsubs.push(store.subscribeKey('shared', 'actionLog', schedule));
    unsubs.push(store.subscribeKey('sleep', 'records', schedule));
    unsubs.push(store.subscribeKey('cycle', 'cycles', schedule));
    unsubs.push(store.subscribeKey('goals', 'items', schedule));
    unsubs.push(store.subscribeKey('work', 'sessions', schedule));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string }> };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'habits');
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
    emittedCompletions.clear();
    initialized = false;
  }

  return { init, teardown, recomputePatterns };
}
