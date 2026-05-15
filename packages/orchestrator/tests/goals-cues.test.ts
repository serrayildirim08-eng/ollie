/**
 * @ollie/orchestrator · goals cue notifications + cross-dispatch
 *
 * Audit task 2 + 9 (2026-05-14): verifies the 3 goal notifications
 * (#8 weekly check-in, #9 30d-to-deadline, #10 paused-14d) plus the
 * goals:convert_to_habit cross-dispatch into shared.habits_v2.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, emit } from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import {
  createGoalsOrchestrator,
  GOALS_NOTIFICATION_COPY,
} from '../src/goals';
import { createHabitsOrchestrator } from '../src/habits';
import type { Goal } from '@ollie/logic/goals';

const DAY = 86_400_000;
// A SUNDAY noon (2026-05-17 is a Sunday).
const SUNDAY_NOON = new Date('2026-05-17T12:00:00Z').getTime();
// A MONDAY noon (2026-05-18).
const MONDAY_NOON = new Date('2026-05-18T12:00:00Z').getTime();

interface Captured {
  spec: NotificationSpec;
  fireAt: number;
}

function makeHarness(now: number) {
  const captured: Captured[] = [];
  const dispatch = (spec: NotificationSpec, fireAt: number): void => {
    captured.push({ spec, fireAt });
  };
  const store = createStore(createMemoryAdapter());
  const orch = createGoalsOrchestrator(store, {
    now: () => now,
    getConsent: () => true,
    scheduleNotification: dispatch,
  });
  return { store, orch, captured };
}

describe('goals orchestrator · notification cues', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('#8 Sunday weekly check-in fires when a goal was last reviewed >7d ago', () => {
    vi.setSystemTime(SUNDAY_NOON);
    const { store, orch, captured } = makeHarness(SUNDAY_NOON);
    const goal: Goal = {
      id: 'g1',
      title: 'ship beta',
      status: 'active',
      created_at: SUNDAY_NOON - 30 * DAY,
      last_review_ts: SUNDAY_NOON - 10 * DAY,
    };
    store.set('goals', 'items', [goal]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('goals:weekly_check_in:'));
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe(GOALS_NOTIFICATION_COPY.weekly_check_in);
    expect(hit?.spec.category).toBe('CONTENT_DELIVERY');

    orch.teardown();
  });

  it('#8 does NOT fire on a Monday', () => {
    vi.setSystemTime(MONDAY_NOON);
    const { store, orch, captured } = makeHarness(MONDAY_NOON);
    const goal: Goal = {
      id: 'g1',
      title: 'ship beta',
      status: 'active',
      created_at: MONDAY_NOON - 30 * DAY,
      last_review_ts: MONDAY_NOON - 10 * DAY,
    };
    store.set('goals', 'items', [goal]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('goals:weekly_check_in:'));
    expect(hit).toBeUndefined();
    orch.teardown();
  });

  it('#9 target_date 30 days out fires deadline_30d copy with progress %', () => {
    vi.setSystemTime(MONDAY_NOON);
    const { store, orch, captured } = makeHarness(MONDAY_NOON);
    const goal: Goal = {
      id: 'g-deadline',
      title: 'Q3 deck',
      status: 'active',
      progress: 47,
      target_date_ts: MONDAY_NOON + 30 * DAY,
    };
    store.set('goals', 'items', [goal]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key === 'goals:deadline_30d:g-deadline');
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe('goal Q3 deck target date in 30 days. progress: 47%.');
    expect(hit?.spec.category).toBe('REMINDER');
    orch.teardown();
  });

  it('#10 paused 14+ days fires paused_14d copy', () => {
    vi.setSystemTime(MONDAY_NOON);
    const { store, orch, captured } = makeHarness(MONDAY_NOON);
    const goal: Goal = {
      id: 'g-paused',
      title: 'learn french',
      status: 'paused',
      paused_at: MONDAY_NOON - 15 * DAY,
    };
    store.set('goals', 'items', [goal]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key === 'goals:paused_14d:g-paused');
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe('you paused goal learn french for 14 days. still relevant?');
    orch.teardown();
  });

  it('#10 does NOT fire when paused < 14 days', () => {
    vi.setSystemTime(MONDAY_NOON);
    const { store, orch, captured } = makeHarness(MONDAY_NOON);
    const goal: Goal = {
      id: 'g-paused-fresh',
      title: 'meditate daily',
      status: 'paused',
      paused_at: MONDAY_NOON - 5 * DAY,
    };
    store.set('goals', 'items', [goal]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('goals:paused_14d:'));
    expect(hit).toBeUndefined();
    orch.teardown();
  });

  it('cues do not double-fire on repeated scans (dedupe persists)', () => {
    vi.setSystemTime(MONDAY_NOON);
    const { store, orch, captured } = makeHarness(MONDAY_NOON);
    const goal: Goal = {
      id: 'g-paused',
      title: 'french',
      status: 'paused',
      paused_at: MONDAY_NOON - 20 * DAY,
    };
    store.set('goals', 'items', [goal]);
    orch.init();
    vi.advanceTimersByTime(600);
    orch.scanCues();
    orch.scanCues();
    const hits = captured.filter((c) => c.spec.dedupe_key.startsWith('goals:paused_14d:'));
    expect(hits.length).toBe(1);
    orch.teardown();
  });
});

describe('goals → habit cross-dispatch', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(MONDAY_NOON); });
  afterEach(() => {
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('habits orchestrator listens for goals:convert_to_habit and appends habit', () => {
    const store = createStore(createMemoryAdapter());
    // Seed a goal so the stamp side-effect can target it.
    store.set('goals', 'items', [
      { id: 'g-conv', title: 'run 5k', status: 'active' },
    ]);
    const habitsOrch = createHabitsOrchestrator(store, { now: () => MONDAY_NOON });
    habitsOrch.init();
    vi.advanceTimersByTime(600);

    emit('goals:convert_to_habit', {
      goal_id: 'g-conv',
      habit_title: 'run 5k',
      cadence: 'daily',
      ts: MONDAY_NOON,
    });

    const habits = store.get<Array<{ name: string; source_goal_id?: string; cadence?: string }>>('shared', 'habits_v2', []);
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('run 5k');
    expect(habits[0].source_goal_id).toBe('g-conv');
    expect(habits[0].cadence).toBe('daily');

    // Goal stamped with converted_to_habit_at.
    const goals = store.get<Array<{ id: string; converted_to_habit_at?: number }>>('goals', 'items', []);
    expect(goals[0].converted_to_habit_at).toBe(MONDAY_NOON);

    habitsOrch.teardown();
  });

  it('empty habit_title is a no-op', () => {
    const store = createStore(createMemoryAdapter());
    const habitsOrch = createHabitsOrchestrator(store, { now: () => MONDAY_NOON });
    habitsOrch.init();
    vi.advanceTimersByTime(600);

    emit('goals:convert_to_habit', {
      goal_id: 'g',
      habit_title: '',
      cadence: 'daily',
      ts: MONDAY_NOON,
    });

    const habits = store.get<unknown[]>('shared', 'habits_v2', []);
    expect(habits).toHaveLength(0);
    habitsOrch.teardown();
  });
});
