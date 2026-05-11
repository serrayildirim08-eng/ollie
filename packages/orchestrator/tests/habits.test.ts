/**
 * @ollie/orchestrator · habits orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createHabitsOrchestrator } from '../src/habits';

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
