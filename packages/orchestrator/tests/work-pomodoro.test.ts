/**
 * @ollie/orchestrator · work pomodoro break tracking (Phase 3 · feature 2)
 *
 * Verifies the orchestrator derives work.pomodoro from work.focus_log
 * on cold start and recomputes it when the focus log changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers } from '@ollie/events';
import { createWorkOrchestrator } from '../src/work';
import type { FocusLogEntry, PomodoroBreakState } from '@ollie/logic/work';

// Fixed local-time clock — noon on a fixed day.
const NOW = new Date('2026-05-15T12:00:00').getTime();
const MIN = 60_000;

function block(offsetMin: number): FocusLogEntry {
  return {
    ts: NOW - offsetMin * MIN,
    duration_min: 25,
    duration_ms: 25 * MIN,
  };
}

describe('work orchestrator · pomodoro break tracking', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createWorkOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    store = createStore(createMemoryAdapter());
    orch = createWorkOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('cold start writes work.pomodoro + pomodoroLastComputedAt', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    const pomodoro = store.get<PomodoroBreakState>('work', 'pomodoro');
    expect(pomodoro).toBeDefined();
    expect(pomodoro.blocks_today).toBe(0);
    expect(pomodoro.earned_break).toBe('none');
    expect(store.get<number>('work', 'pomodoroLastComputedAt', 0)).toBe(NOW);
  });

  it('recomputes when focus_log changes — short break after 1 block', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    store.set('work', 'focus_log', [block(60)]);
    vi.advanceTimersByTime(600);

    const pomodoro = store.get<PomodoroBreakState>('work', 'pomodoro');
    expect(pomodoro.blocks_today).toBe(1);
    expect(pomodoro.earned_break).toBe('short');
    expect(pomodoro.blocks_until_long_break).toBe(3);
  });

  it('4 completed blocks → long break earned', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    store.set('work', 'focus_log', [
      block(240),
      block(180),
      block(120),
      block(60),
    ]);
    vi.advanceTimersByTime(600);

    const pomodoro = store.get<PomodoroBreakState>('work', 'pomodoro');
    expect(pomodoro.blocks_today).toBe(4);
    expect(pomodoro.earned_break).toBe('long');
    expect(pomodoro.blocks_in_cycle).toBe(0);
  });

  it('recomputePomodoro() is callable directly', () => {
    store.set('work', 'focus_log', [block(60), block(30)]);
    orch.recomputePomodoro();

    const pomodoro = store.get<PomodoroBreakState>('work', 'pomodoro');
    expect(pomodoro.blocks_today).toBe(2);
  });

  it('teardown stops further recomputes', () => {
    orch.init();
    vi.advanceTimersByTime(600);
    orch.teardown();

    store.set('work', 'focus_log', [block(60)]);
    vi.advanceTimersByTime(600);

    // pomodoro still reflects the cold-start (empty) state
    const pomodoro = store.get<PomodoroBreakState>('work', 'pomodoro');
    expect(pomodoro.blocks_today).toBe(0);
  });
});
