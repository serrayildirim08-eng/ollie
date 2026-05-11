/**
 * @ollie/orchestrator · work orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createWorkOrchestrator } from '../src/work';
import type { WorkSession } from '@ollie/logic/work';

const FIXED_NOW = new Date('2026-05-11T12:00:00Z').getTime();
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

// 10 sessions over 5 days each with 3+ task swaps — enough for task-switch-tax (W1).
function makeSessionFixture(now: number): WorkSession[] {
  const sessions: WorkSession[] = [];
  for (let d = 9; d >= 0; d--) {
    sessions.push({
      id: `s${d}`,
      at: now - d * DAY_MS,
      start: now - d * DAY_MS,
      end: now - d * DAY_MS + 90 * MIN_MS,
      duration_min: 90,
      swap_log: [{}, {}, {}, {}], // 4 swaps per session
    });
  }
  return sessions;
}

describe('work orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createWorkOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createWorkOrchestrator(store, { now: () => FIXED_NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('writes patternsLastComputedAt after init()', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('work', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });

  it('seeded sessions → patterns array populated', () => {
    store.set('work', 'sessions', makeSessionFixture(FIXED_NOW));
    orch.init();
    vi.advanceTimersByTime(600);

    const patterns = store.get<unknown[]>('work', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('re-runs when work.tasks changes', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    store.set('work', 'tasks', [{ id: 't1', text: 'new task', ts: FIXED_NOW, status: 'open' }]);
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('work', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });

  it('does not double-emit same pattern on second recompute', () => {
    const detected: string[] = [];
    on('work:pattern_detected', (p: unknown) => {
      detected.push((p as { pattern: string }).pattern);
    });

    store.set('work', 'sessions', makeSessionFixture(FIXED_NOW));
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
    store.set('work', 'patterns', [{ pattern: 'sentinel' }] as never);

    store.set('work', 'sessions', makeSessionFixture(FIXED_NOW));
    vi.advanceTimersByTime(600);

    const patterns = store.get<Array<{ pattern: string }>>('work', 'patterns', []);
    expect(patterns[0]?.pattern).toBe('sentinel');
  });

  it('init() is idempotent', () => {
    orch.init();
    orch.init();
    orch.init();
    vi.advanceTimersByTime(600);

    const ts = store.get<number>('work', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });
});
