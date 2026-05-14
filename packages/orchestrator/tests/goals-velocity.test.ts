/**
 * @ollie/orchestrator · goals velocity detector (audit task 15, 2026-05-14)
 *
 * Verifies:
 *  - Empty goals → no emit
 *  - Sub-threshold sample (<3 per category) → no emit
 *  - Mixed completion → correct per-category velocity stats
 *  - 2x gap → notification dispatched with velocity_gap copy
 *  - Dedupe key prevents double-fire same ISO week
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers } from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import {
  createGoalsOrchestrator,
  GOALS_NOTIFICATION_COPY,
  VELOCITY_GAP_THRESHOLD,
} from '../src/goals';
import {
  computeVelocityByCategory,
  detectGoalVelocityByCategory,
} from '@ollie/logic/goals';
import type { Goal } from '@ollie/logic/goals';

const DAY = 86_400_000;
// Fixed ts in a Tuesday so weekly_check_in doesn't fire and noise the harness.
const NOW = new Date('2026-05-12T12:00:00Z').getTime();

interface Captured {
  spec: NotificationSpec;
  fireAt: number;
}

function makeHarness(now: number = NOW) {
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

function goal(over: Partial<Goal>): Goal {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'g',
    status: 'active',
    created_at: NOW - 30 * DAY,
    ...over,
  };
}

describe('goals velocity · pure detector', () => {
  it('returns empty when no goals', () => {
    const out = computeVelocityByCategory({ goals: [], now: NOW }, { now: NOW });
    expect(out).toEqual([]);
  });

  it('skips categories with <3 goals (sub-threshold sample)', () => {
    const goals: Goal[] = [
      goal({ id: '1', category: 'learning', status: 'done', status_at: NOW - 1 * DAY }),
      goal({ id: '2', category: 'learning', status: 'active' }),
      goal({ id: '3', category: 'career', status: 'done', status_at: NOW - 5 * DAY }),
    ];
    const out = computeVelocityByCategory({ goals, now: NOW }, { now: NOW });
    expect(out).toEqual([]);
  });

  it('computes mixed completion correctly per category', () => {
    const goals: Goal[] = [
      // learning: 3 goals, 2 done. 10d + 20d avg = 15d.
      goal({ id: 'l1', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 20 * DAY }),
      goal({ id: 'l2', category: 'learning', created_at: NOW - 60 * DAY, status: 'done', status_at: NOW - 40 * DAY }),
      goal({ id: 'l3', category: 'learning', created_at: NOW - 10 * DAY, status: 'active' }),
      // career: 4 goals, 1 done. avg 5d.
      goal({ id: 'c1', category: 'career', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 25 * DAY }),
      goal({ id: 'c2', category: 'career', created_at: NOW - 20 * DAY, status: 'active' }),
      goal({ id: 'c3', category: 'career', created_at: NOW - 15 * DAY, status: 'paused' }),
      goal({ id: 'c4', category: 'career', created_at: NOW - 5 * DAY, status: 'active' }),
      // uncategorized: should be ignored entirely.
      goal({ id: 'u1', created_at: NOW - 10 * DAY, status: 'done', status_at: NOW - 5 * DAY }),
    ];
    const out = computeVelocityByCategory({ goals, now: NOW }, { now: NOW });
    // learning has higher velocity → sorted first.
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      category: 'learning',
      total: 3,
      completed: 2,
      velocity: 0.67,
      avg_days_to_complete: 15,
    });
    expect(out[1]).toEqual({
      category: 'career',
      total: 4,
      completed: 1,
      velocity: 0.25,
      avg_days_to_complete: 5,
    });
  });

  it('emits pattern signals with top/bottom + velocity_gap on detector entrypoint', () => {
    const goals: Goal[] = [
      goal({ id: 'l1', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 25 * DAY }),
      goal({ id: 'l2', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 20 * DAY }),
      goal({ id: 'l3', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 10 * DAY }),
      goal({ id: 'c1', category: 'career', created_at: NOW - 30 * DAY, status: 'active' }),
      goal({ id: 'c2', category: 'career', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 1 * DAY }),
      goal({ id: 'c3', category: 'career', created_at: NOW - 30 * DAY, status: 'active' }),
    ];
    const out = detectGoalVelocityByCategory({ goals, now: NOW }, { now: NOW });
    expect(out).not.toBeNull();
    expect(out).toHaveLength(2);
    const top = out![0];
    expect(top.signal).toBe('goals_velocity_pattern');
    expect(top.category).toBe('learning');
    expect(top.velocity).toBe(1);
    expect(top.top_category).toBe('learning');
    expect(top.bottom_category).toBe('career');
    // gap = 1.0 / 0.33 = ~3.03
    expect(top.velocity_gap).toBeGreaterThanOrEqual(VELOCITY_GAP_THRESHOLD);
  });

  it('respects consent=false', () => {
    const goals: Goal[] = [
      goal({ id: 'l1', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 1 * DAY }),
      goal({ id: 'l2', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 1 * DAY }),
      goal({ id: 'l3', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 1 * DAY }),
    ];
    const out = detectGoalVelocityByCategory({ goals, now: NOW }, { now: NOW, consent: false });
    expect(out).toBeNull();
  });
});

describe('goals velocity · orchestrator notification', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => {
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('no goals → no velocity notification', () => {
    const { store, orch, captured } = makeHarness();
    store.set('goals', 'items', []);
    orch.init();
    vi.advanceTimersByTime(600);
    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('goals:velocity_'));
    expect(hit).toBeUndefined();
    orch.teardown();
  });

  it('sub-threshold (<3 per cat) → no notification', () => {
    const { store, orch, captured } = makeHarness();
    store.set('goals', 'items', [
      goal({ id: '1', category: 'learning', status: 'done', status_at: NOW - 1 * DAY }),
      goal({ id: '2', category: 'career', status: 'done', status_at: NOW - 1 * DAY }),
    ]);
    orch.init();
    vi.advanceTimersByTime(600);
    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('goals:velocity_'));
    expect(hit).toBeUndefined();
    orch.teardown();
  });

  it('2x gap → notification dispatched with velocity_gap copy', () => {
    const { store, orch, captured } = makeHarness();
    // learning: 3/3 done (velocity 1.0)
    // career:   1/3 done (velocity 0.33) → gap ~3.03 > 2
    store.set('goals', 'items', [
      goal({ id: 'l1', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 5 * DAY }),
      goal({ id: 'l2', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 6 * DAY }),
      goal({ id: 'l3', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 7 * DAY }),
      goal({ id: 'c1', category: 'career', created_at: NOW - 30 * DAY, status: 'active' }),
      goal({ id: 'c2', category: 'career', created_at: NOW - 30 * DAY, status: 'active' }),
      goal({ id: 'c3', category: 'career', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 2 * DAY }),
    ]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('goals:velocity_learning_career_'));
    expect(hit).toBeDefined();
    expect(hit?.spec.category).toBe('PATTERN_ALERT');
    expect(hit?.spec.title).toContain('learning goals finish');
    expect(hit?.spec.title).toContain('career');
    expect(hit?.spec.title.toLowerCase()).toContain('flagging');
    orch.teardown();
  });

  it('dedupe prevents double-fire on repeated scans same week', () => {
    const { store, orch, captured } = makeHarness();
    store.set('goals', 'items', [
      goal({ id: 'l1', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 5 * DAY }),
      goal({ id: 'l2', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 6 * DAY }),
      goal({ id: 'l3', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 7 * DAY }),
      goal({ id: 'c1', category: 'career', created_at: NOW - 30 * DAY, status: 'active' }),
      goal({ id: 'c2', category: 'career', created_at: NOW - 30 * DAY, status: 'active' }),
      goal({ id: 'c3', category: 'career', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 2 * DAY }),
    ]);
    orch.init();
    vi.advanceTimersByTime(600);
    orch.scanCues();
    orch.scanCues();
    const hits = captured.filter((c) => c.spec.dedupe_key.startsWith('goals:velocity_'));
    expect(hits.length).toBe(1);
    orch.teardown();
  });

  it('gap < threshold → no notification', () => {
    const { store, orch, captured } = makeHarness();
    // learning: 3/3 done; career: 3/3 done → gap = 1
    store.set('goals', 'items', [
      goal({ id: 'l1', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 5 * DAY }),
      goal({ id: 'l2', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 6 * DAY }),
      goal({ id: 'l3', category: 'learning', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 7 * DAY }),
      goal({ id: 'c1', category: 'career', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 5 * DAY }),
      goal({ id: 'c2', category: 'career', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 6 * DAY }),
      goal({ id: 'c3', category: 'career', created_at: NOW - 30 * DAY, status: 'done', status_at: NOW - 7 * DAY }),
    ]);
    orch.init();
    vi.advanceTimersByTime(600);
    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('goals:velocity_'));
    expect(hit).toBeUndefined();
    orch.teardown();
  });
});

describe('goals velocity · expected copy template', () => {
  it('velocity_gap template matches "X goals finish Nx faster than Y. flagging."', () => {
    const copy = GOALS_NOTIFICATION_COPY.velocity_gap('learning', 'career', 2);
    expect(copy).toBe('learning goals finish 2x faster than career. flagging.');
  });
});
