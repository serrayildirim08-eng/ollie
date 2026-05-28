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
 *                          Dedup: one emit per habitId per UTC calendar day.
 *   habits:morning_check   daily 9am local time, once per day. Payload includes
 *                          firstHabitName (or null) and totalCount.
 *
 * Push subscribers (APNs):
 *   habits:morning_check → "{N} things today. one of them is {firstHabit}."
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import { detectPatterns } from '@ollie/logic/habits';
import type { Habit, HabitCompletion } from '@ollie/logic/habits';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;
const MORNING_CHECK_HOUR = 9;

type HabitsCompletedCategory = 'health' | 'mental' | 'home' | 'work' | 'self_care';

function inferCategory(cueTime?: string): HabitsCompletedCategory {
  if (cueTime === 'morning') return 'health';
  if (cueTime === 'evening') return 'mental';
  return 'self_care';
}

export interface HabitsOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /** APNs push scheduler; no-op when omitted. */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
}

export function createHabitsOrchestrator(
  store: Store,
  opts: HabitsOrchestratorOptions = {},
): Orchestrator & {
  recomputePatterns(): void;
  emitMorningCheck(): boolean;
  /** Test-only: current size of the in-memory completion-dedup Set. */
  _emittedCompletionCount(): number;
} {
  const getNow = opts.now ?? (() => Date.now());
  const scheduleNotification = opts.scheduleNotification ?? null;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let morningTimer: ReturnType<typeof setTimeout> | null = null;

  const emittedCompletions = new Set<string>();

  function scanCompletions(): void {
    const now = getNow();
    const todayKey = new Date(now).toISOString().slice(0, 10);

    // Prune stale day-keys. `emittedCompletions` only ever needs the
    // current UTC day's keys — anything dated earlier can never dedup a
    // future emit (the dedup key embeds todayKey). Without this the Set
    // grows by one key per habit per day forever (only cleared on full
    // teardown). Keys are `${habitId}:${YYYY-MM-DD}`.
    for (const key of emittedCompletions) {
      const day = key.slice(key.lastIndexOf(':') + 1);
      if (day !== todayKey) emittedCompletions.delete(key);
    }

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

  function scheduleWithCompletionScan(): void {
    scanCompletions();
    schedule();
  }

  // ── morning_check (daily 9am) ────────────────────────────────────────────
  // Emits habits:morning_check once per UTC day. Self-arming timer fires
  // at next 9am local. Returns true if event fired.
  function emitMorningCheck(): boolean {
    const now = getNow();
    const todayKey = new Date(now).toISOString().slice(0, 10);
    const lastEmittedDay = store.get<string>('habits', '_morningCheckEmittedDay', '') ?? '';
    if (lastEmittedDay === todayKey) return false;

    const habits = store.get<Array<{ name?: string; label?: string }>>('shared', 'habits_v2', []) ?? [];
    const firstHabit = habits[0];
    const firstHabitName = typeof firstHabit?.name === 'string' && firstHabit.name.trim().length > 0
      ? firstHabit.name
      : (typeof firstHabit?.label === 'string' && firstHabit.label.trim().length > 0
        ? firstHabit.label
        : null);
    try {
      events.emit('habits:morning_check', {
        firstHabitName,
        totalCount: habits.length,
        ts: now,
      });
    } catch { /* non-fatal */ }
    store.set('habits', '_morningCheckEmittedDay', todayKey);
    return true;
  }

  function nextMorning9(now: number): number {
    const d = new Date(now);
    const target = new Date(d);
    target.setHours(MORNING_CHECK_HOUR, 0, 0, 0);
    if (target.getTime() <= now) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  function armMorningTimer(): void {
    const now = getNow();
    const fireAt = nextMorning9(now);
    const delay = Math.max(0, fireAt - now);
    morningTimer = setTimeout(() => {
      morningTimer = null;
      try { emitMorningCheck(); } catch { /* non-fatal */ }
      armMorningTimer();
    }, delay);
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

    // ── goals → habit cross-dispatch ────────────────────────────────────
    // UI fires goals:convert_to_habit when the user taps "convert to habit"
    // on a goal card. Append a new Habit into shared.habits_v2 and stamp
    // the source goal with converted_to_habit_at. Empty title = no-op.
    unsubs.push(events.on('goals:convert_to_habit', (raw) => {
      try {
        const p = (raw ?? {}) as {
          goal_id?: string;
          habit_title?: string;
          cadence?: string;
          ts?: number;
        };
        const title = typeof p.habit_title === 'string' ? p.habit_title.trim() : '';
        if (!title) return; // no-op on empty title

        const ts = typeof p.ts === 'number' ? p.ts : getNow();

        const habits = store.get<Array<Habit & { source_goal_id?: string; cadence?: string }>>(
          'shared', 'habits_v2', [],
        ) ?? [];
        const newHabit: Habit & { source_goal_id?: string; cadence?: string } = {
          id: `habit_${ts}_${Math.random().toString(36).slice(2, 8)}`,
          name: title,
          created_at: ts,
          completions: [],
          source_goal_id: p.goal_id,
          cadence: typeof p.cadence === 'string' ? p.cadence : undefined,
        };
        store.set('shared', 'habits_v2', [...habits, newHabit]);

        // Stamp the originating goal so it won't be re-converted.
        if (p.goal_id) {
          const goals = store.get<Array<{ id?: string; converted_to_habit_at?: number }>>(
            'goals', 'items', [],
          ) ?? [];
          let changed = false;
          const next = goals.map((g) => {
            if (g && g.id === p.goal_id) {
              changed = true;
              return { ...g, converted_to_habit_at: ts };
            }
            return g;
          });
          if (changed) store.set('goals', 'items', next);
        }
      } catch { /* non-fatal */ }
    }));

    // ── APNs push subscriber (body-v2 wiring) ───────────────────────────
    // habits:morning_check → "{N} things today. one of them is {first}."
    if (scheduleNotification) {
      unsubs.push(events.on('habits:morning_check', (raw) => {
        try {
          const p = (raw ?? {}) as { firstHabitName?: string | null; totalCount?: number; ts?: number };
          const total = typeof p.totalCount === 'number' ? p.totalCount : 0;
          if (total < 1) return;
          const first = typeof p.firstHabitName === 'string' && p.firstHabitName.trim().length > 0
            ? p.firstHabitName
            : null;
          const ts = typeof p.ts === 'number' ? p.ts : getNow();
          const dayKey = new Date(ts).toISOString().slice(0, 10);
          const noun = total === 1 ? 'thing' : 'things';
          const title = first
            ? `${total} ${noun} today. one of them is ${first}.`
            : `${total} ${noun} today.`;
          scheduleNotification(
            {
              title,
              category: 'CONTENT_DELIVERY',
              dedupe_key: `habits:morning_check:${dayKey}`,
              action_url: '/habits',
            },
            getNow(),
          );
        } catch { /* non-fatal */ }
      }));
    }

    // Arm the daily 9am scheduler.
    armMorningTimer();

    // Cold start — populate patterns immediately.
    schedule();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (timer) { clearTimeout(timer); timer = null; }
    if (morningTimer) { clearTimeout(morningTimer); morningTimer = null; }
    emittedCompletions.clear();
    initialized = false;
  }

  return {
    init,
    teardown,
    recomputePatterns,
    emitMorningCheck,
    _emittedCompletionCount: () => emittedCompletions.size,
  };
}
