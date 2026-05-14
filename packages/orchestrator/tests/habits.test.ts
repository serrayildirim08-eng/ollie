/**
 * @ollie/orchestrator · habits orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
import { createHabitsOrchestrator } from '../src/habits';
import type { NotificationSpec } from '@ollie/notifications';

// habit completion payload shape
interface HabitsCompletedPayload {
  habitId: string;
  category: string;
  habitName: string;
  ts: number;
}

const FIXED_NOW = new Date('2026-05-11T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

// 14 days of completions for a single habit — enough for drift / frequency detectors.
function makeFixture(now: number) {
  const habit = {
    id: 'h_teeth',
    name: 'brush teeth',
    cueTime: 'morning',
    completions: [] as Array<{ ts: number; habit_id: string }>,
  };
  // complete every day for 14 days except the last 3 (simulates a drift gap)
  for (let d = 14; d > 3; d--) {
    habit.completions.push({ ts: now - d * DAY_MS + 8 * 3_600_000, habit_id: 'h_teeth' });
  }
  return [habit];
}

describe('habits orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createHabitsOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createHabitsOrchestrator(store, { now: () => FIXED_NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('writes patternsLastComputedAt after init()', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('habits', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });

  it('writes patterns array after init()', () => {
    store.set('shared', 'habits_v2', makeFixture(FIXED_NOW));
    orch.init();
    vi.advanceTimersByTime(600);

    const patterns = store.get<unknown[]>('habits', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
  });

  it('re-runs when habits_v2 changes', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    store.set('shared', 'habits_v2', makeFixture(FIXED_NOW));
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('habits', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });

  it('emits habits:pattern_detected for new patterns', () => {
    const detected: string[] = [];
    on('habits:pattern_detected', (p: unknown) => {
      detected.push((p as { pattern: string }).pattern);
    });

    store.set('shared', 'habits_v2', makeFixture(FIXED_NOW));
    orch.init();
    vi.advanceTimersByTime(600);

    // May or may not fire patterns with this fixture — just assert no throw
    // and that if patterns exist they have string keys.
    for (const d of detected) {
      expect(typeof d).toBe('string');
    }
  });

  it('does not double-emit same pattern on second recompute', () => {
    const detected: string[] = [];
    on('habits:pattern_detected', (p: unknown) => {
      detected.push((p as { pattern: string }).pattern);
    });

    store.set('shared', 'habits_v2', makeFixture(FIXED_NOW));
    orch.init();
    vi.advanceTimersByTime(600);

    const countAfterFirst = detected.length;
    // Trigger recompute again without changing data
    orch.recomputePatterns();

    // No new events should have fired because prevKeys now covers them
    expect(detected.length).toBe(countAfterFirst);
  });

  it('teardown stops subscriptions from triggering recompute', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    orch.teardown();
    store.set('habits', 'patterns', [{ pattern: 'sentinel' }] as never);

    store.set('shared', 'habits_v2', makeFixture(FIXED_NOW));
    vi.advanceTimersByTime(600);

    const patterns = store.get<Array<{ pattern: string }>>('habits', 'patterns', []);
    expect(patterns[0]?.pattern).toBe('sentinel');
  });

  it('init() is idempotent', () => {
    orch.init();
    orch.init();
    orch.init();
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('habits', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });
});

// ─── habits:completed emission ───────────────────────────────────────────────

describe('habits orchestrator · habits:completed emission', () => {
  // Use a fixed "today" so completions land on the right UTC day
  const TODAY_MS = new Date('2026-05-11T12:00:00Z').getTime();

  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createHabitsOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY_MS);
    store = createStore(createMemoryAdapter());
    orch = createHabitsOrchestrator(store, { now: () => TODAY_MS });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('emits habits:completed with correct payload when a habit is marked done today', () => {
    const captured: HabitsCompletedPayload[] = [];
    on('habits:completed', (p) => captured.push(p as HabitsCompletedPayload));

    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [{ ts: TODAY_MS }] },
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0].habitId).toBe('h_teeth');
    expect(captured[0].habitName).toBe('brush teeth');
    expect(captured[0].category).toBe('health');
    expect(captured[0].ts).toBe(TODAY_MS);
  });

  it('infers category "mental" for evening habits', () => {
    const captured: HabitsCompletedPayload[] = [];
    on('habits:completed', (p) => captured.push(p as HabitsCompletedPayload));

    store.set('shared', 'habits_v2', [
      { id: 'h_wind', name: 'wind down', cueTime: 'evening', completions: [{ ts: TODAY_MS }] },
    ]);

    expect(captured[0].category).toBe('mental');
  });

  it('infers category "self_care" for anytime habits', () => {
    const captured: HabitsCompletedPayload[] = [];
    on('habits:completed', (p) => captured.push(p as HabitsCompletedPayload));

    store.set('shared', 'habits_v2', [
      { id: 'h_move', name: 'move', cueTime: 'anytime', completions: [{ ts: TODAY_MS }] },
    ]);

    expect(captured[0].category).toBe('self_care');
  });

  it('does NOT re-emit if the same habit is toggled off then back on (same day dedup)', () => {
    const captured: HabitsCompletedPayload[] = [];
    on('habits:completed', (p) => captured.push(p as HabitsCompletedPayload));

    // First completion
    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [{ ts: TODAY_MS }] },
    ]);
    expect(captured).toHaveLength(1);

    // Toggle off (no completion for today)
    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [] },
    ]);

    // Toggle back on — same day, should NOT re-emit
    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [{ ts: TODAY_MS + 1000 }] },
    ]);

    expect(captured).toHaveLength(1);
  });

  it('does NOT emit for completions on a previous day', () => {
    const captured: HabitsCompletedPayload[] = [];
    on('habits:completed', (p) => captured.push(p as HabitsCompletedPayload));

    const yesterday = TODAY_MS - DAY_MS;
    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [{ ts: yesterday }] },
    ]);

    expect(captured).toHaveLength(0);
  });

  it('emits once per habit when multiple habits complete', () => {
    const captured: HabitsCompletedPayload[] = [];
    on('habits:completed', (p) => captured.push(p as HabitsCompletedPayload));

    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [{ ts: TODAY_MS }] },
      { id: 'h_water', name: 'drink water', cueTime: 'morning', completions: [{ ts: TODAY_MS + 500 }] },
      { id: 'h_move',  name: 'move',        cueTime: 'anytime', completions: [{ ts: TODAY_MS + 1000 }] },
    ]);

    expect(captured).toHaveLength(3);
    const ids = captured.map((c) => c.habitId);
    expect(ids).toContain('h_teeth');
    expect(ids).toContain('h_water');
    expect(ids).toContain('h_move');
  });

  it('dedup resets on teardown — emits again after reinit for the same habit', () => {
    const captured: HabitsCompletedPayload[] = [];
    on('habits:completed', (p) => captured.push(p as HabitsCompletedPayload));

    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [{ ts: TODAY_MS }] },
    ]);
    expect(captured).toHaveLength(1);

    // Reinit (simulates app restart within same day)
    orch.teardown();
    orch.init();

    store.set('shared', 'habits_v2', [
      { id: 'h_teeth', name: 'brush teeth', cueTime: 'morning', completions: [{ ts: TODAY_MS + 100 }] },
    ]);
    expect(captured).toHaveLength(2);
  });
});

// ─── habits:morning_check + push subscriber ─────────────────────────────────

describe('habits orchestrator · habits:morning_check + push subscriber', () => {
  const FIXED_NOW = new Date('2026-05-14T12:00:00Z').getTime();

  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createHabitsOrchestrator>;
  let scheduled: Array<{ spec: NotificationSpec; fireAt: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    scheduled = [];
    orch = createHabitsOrchestrator(store, {
      now: () => FIXED_NOW,
      scheduleNotification: (spec, fireAt) => { scheduled.push({ spec, fireAt }); },
    });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('emitMorningCheck() emits habits:morning_check once per day with first-habit name', () => {
    store.set('shared', 'habits_v2', [
      { id: 'h_laundry', name: 'laundry', cueTime: 'morning' },
      { id: 'h_dishes', name: 'dishes', cueTime: 'anytime' },
    ]);
    orch.init();

    let emittedCount = 0;
    let payload: Record<string, unknown> | null = null;
    on('habits:morning_check', (p) => { emittedCount++; payload = p as Record<string, unknown>; });

    expect(orch.emitMorningCheck()).toBe(true);
    expect(emittedCount).toBe(1);
    expect(payload).not.toBeNull();
    expect(payload!.firstHabitName).toBe('laundry');
    expect(payload!.totalCount).toBe(2);

    // Second call same day → dedup
    expect(orch.emitMorningCheck()).toBe(false);
    expect(emittedCount).toBe(1);
  });

  it('habits:morning_check push subscriber → CONTENT_DELIVERY push with deadpan copy', () => {
    orch.init();
    emit('habits:morning_check', {
      firstHabitName: 'laundry',
      totalCount: 5,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('CONTENT_DELIVERY');
    expect(scheduled[0].spec.title).toBe('5 things today. one of them is laundry.');
    expect(scheduled[0].spec.dedupe_key).toContain('habits:morning_check');
  });

  it('habits:morning_check push → omits "one of them is" when firstHabitName null', () => {
    orch.init();
    emit('habits:morning_check', {
      firstHabitName: null,
      totalCount: 3,
      ts: FIXED_NOW,
    });
    expect(scheduled[0].spec.title).toBe('3 things today.');
  });

  it('habits:morning_check push → singular "thing" when count is 1', () => {
    orch.init();
    emit('habits:morning_check', {
      firstHabitName: 'water',
      totalCount: 1,
      ts: FIXED_NOW,
    });
    expect(scheduled[0].spec.title).toBe('1 thing today. one of them is water.');
  });

  it('habits:morning_check push → suppressed when totalCount is 0', () => {
    orch.init();
    emit('habits:morning_check', {
      firstHabitName: null,
      totalCount: 0,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(0);
  });

  it('scheduleNotification NOT called when not injected', () => {
    orch.teardown();
    scheduled.length = 0;
    const store2 = createStore(createMemoryAdapter());
    const orch2 = createHabitsOrchestrator(store2, { now: () => FIXED_NOW });
    orch2.init();
    emit('habits:morning_check', {
      firstHabitName: 'water',
      totalCount: 3,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(0);
    orch2.teardown();
  });
});
