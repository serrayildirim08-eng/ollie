/**
 * @ollie/orchestrator · admin orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
import { createAdminOrchestrator } from '../src/admin';
import type { AdminTask } from '@ollie/logic/admin';
import type { AdminPattern, PhoneTaskItem } from '../src/admin';

// Fixed wall-clock: 2026-05-09T12:00:00Z
const NOW = new Date('2026-05-09T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

describe('admin orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createAdminOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createAdminOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('writes patternsLastComputedAt on init', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();
    const ts = store.get<number>('admin', 'patternsLastComputedAt', 0);
    expect(ts).toBe(NOW);
  });

  it('detects stale-ball and populates patterns slice', () => {
    // Task in THEIRS state for 20 days (> default 14d threshold)
    const tasks: AdminTask[] = [
      {
        id: 't1',
        label: 'send contract',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns!.some((p) => p.signal === 'admin_stale_ball')).toBe(true);
  });

  it('stamps a canonical hyphenated pattern id derived from signal', () => {
    const tasks: AdminTask[] = [
      {
        id: 't1',
        label: 'send contract',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const stale = patterns.find((p) => p.signal === 'admin_stale_ball');
    expect(stale).toBeDefined();
    // UI keys dismiss state on `pattern`, not `signal`.
    expect(stale!.pattern).toBe('stale-ball');
    // Every pattern object carries a non-empty pattern id.
    expect(patterns.every((p) => typeof p.pattern === 'string' && p.pattern.length > 0)).toBe(true);
  });

  it('gives distinct stale-ball notices distinct pattern identities', () => {
    // Two stale tasks → two notices that must NOT collapse to one dismiss key.
    const tasks: AdminTask[] = [
      { id: 'ta', label: 'send A', ball_state: 'waiting', last_transition_at: NOW - 20 * DAY_MS },
      { id: 'tb', label: 'send B', ball_state: 'waiting', last_transition_at: NOW - 25 * DAY_MS },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const stale = patterns.filter((p) => p.signal === 'admin_stale_ball');
    expect(stale).toHaveLength(2);
    // Same pattern label, distinct discriminator → distinct dismiss keys.
    expect(stale[0].pattern).toBe('stale-ball');
    expect(stale[1].pattern).toBe('stale-ball');
    expect(stale[0].task_id).not.toBe(stale[1].task_id);
  });

  it('emits admin:stale_ball for a new stale-ball pattern', () => {
    const emitted: Array<{ task_id: string; kind: string }> = [];
    const unsub = on('admin:stale_ball', (p) => {
      emitted.push(p as { task_id: string; kind: string });
    });

    const tasks: AdminTask[] = [
      {
        id: 't2',
        label: 'review draft',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();
    unsub();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].task_id).toBe('t2');
    expect(emitted[0].kind).toBe('untouched');
  });

  it('does not re-emit for a pattern already in the store', () => {
    // Pre-seed the patterns slice so the stale_ball entry is already known.
    const existing: AdminPattern[] = [
      {
        signal: 'admin_stale_ball',
        pattern: 'stale-ball',
        task_id: 't3',
        kind: 'untouched',
        days_overdue: 20,
        copy: 'already known',
        copy_es: '',
        sources: [],
        ts: NOW - DAY_MS,
      },
    ];
    store.set('admin', 'patterns', existing);

    const tasks: AdminTask[] = [
      {
        id: 't3',
        label: 'old task',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);

    const emitted: unknown[] = [];
    const unsub = on('admin:stale_ball', (p) => emitted.push(p));
    orch.init();
    unsub();

    expect(emitted).toHaveLength(0);
  });

  it('detects last-5pct and emits admin:last_5pct', () => {
    const emitted: Array<{ task_id: string; days_since_done: number }> = [];
    const unsub = on('admin:last_5pct', (p) => {
      emitted.push(p as { task_id: string; days_since_done: number });
    });

    const tasks: AdminTask[] = [
      {
        id: 't4',
        label: 'submit form',
        state: 'done',
        done_at: NOW - 7 * DAY_MS,
        // closed_at intentionally absent
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();
    unsub();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].task_id).toBe('t4');
    expect(emitted[0].days_since_done).toBe(7);
  });

  it('appends an admin:phone_task_detected signal to admin.phoneTasks', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();

    emit('admin:phone_task_detected', { verb: 'call', ts: NOW });

    const cluster = store.get<PhoneTaskItem[]>('admin', 'phoneTasks', []) ?? [];
    expect(cluster).toHaveLength(1);
    expect(cluster[0].verb).toBe('call');
    expect(cluster[0].id).toBe(`call:${NOW}`);
  });

  it('phoneTasks cluster is idempotent on a repeated verb+ts', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();

    emit('admin:phone_task_detected', { verb: 'call', ts: NOW });
    emit('admin:phone_task_detected', { verb: 'call', ts: NOW });

    expect(store.get('admin', 'phoneTasks', [])).toHaveLength(1);
  });

  it('teardown stops subscriptions and prevents recompute', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();
    orch.teardown();

    // Sentinel: clear patterns after teardown
    store.set('admin', 'patterns', [] as AdminPattern[]);

    // Mutate tasks — should NOT trigger a recompute
    store.set('admin', 'tasks', [
      {
        id: 't5',
        label: 'should-not-fire',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ] as AdminTask[]);

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []);
    expect(patterns).toHaveLength(0);
  });
});
