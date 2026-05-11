/**
 * @ollie/orchestrator · goals orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createGoalsOrchestrator } from '../src/goals';
import type { Goal } from '@ollie/logic/goals';

const FIXED_NOW = new Date('2026-05-11T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

// 6 active goals — exceeds the 5-goal cap → detectActiveCap should fire.
function makeCapFixture(): Goal[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `g${i}`,
    title: `goal ${i}`,
    status: 'active',
    created_at: FIXED_NOW - (i + 1) * DAY_MS,
  }));
}

describe('goals orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createGoalsOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createGoalsOrchestrator(store, { now: () => FIXED_NOW, getConsent: () => true });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('writes patternsLastComputedAt after init()', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('goals', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });

  it('6 active goals → active-cap pattern detected', () => {
    store.set('goals', 'items', makeCapFixture());
    orch.init();
    vi.advanceTimersByTime(600);

    const patterns = store.get<Array<{ pattern: string }>>('goals', 'patterns', []);
    const capPattern = patterns.find((p) => p?.pattern === 'goals_active_cap_exceeded');
    expect(capPattern).toBeDefined();
  });

  it('re-runs when goals.sessions changes', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    store.set('goals', 'sessions', [{ goal_id: 'g0', type: 'thinking', ts: FIXED_NOW }]);
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('goals', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });

  it('does not double-emit same pattern on second recompute', () => {
    const detected: string[] = [];
    on('goals:pattern_detected', (p: unknown) => {
      detected.push((p as { pattern: string }).pattern);
    });

    store.set('goals', 'items', makeCapFixture());
    orch.init();
    vi.advanceTimersByTime(600);

    const countAfterFirst = detected.length;
    orch.recomputePatterns();

    expect(detected.length).toBe(countAfterFirst);
  });

  it('teardown stops subscriptions from triggering recompute', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    orch.teardown();
    store.set('goals', 'patterns', [{ pattern: 'sentinel' }] as never);

    store.set('goals', 'items', makeCapFixture());
    vi.advanceTimersByTime(600);

    const patterns = store.get<Array<{ pattern: string }>>('goals', 'patterns', []);
    expect(patterns[0]?.pattern).toBe('sentinel');
  });

  it('consent=false still writes empty patterns without crashing', () => {
    const orchNoConsent = createGoalsOrchestrator(store, {
      now: () => FIXED_NOW,
      getConsent: () => false,
    });
    store.set('goals', 'items', makeCapFixture());
    orchNoConsent.init();
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('goals', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
    orchNoConsent.teardown();
  });

  it('init() is idempotent', () => {
    orch.init();
    orch.init();
    orch.init();
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('goals', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });
});
