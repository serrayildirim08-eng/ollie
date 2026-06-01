/**
 * Habits bridge · integration test
 *
 * Proves the great-rewiring works end-to-end for habits: SQLite capture →
 * syncToStore → the habits Layer-2 watcher fires from the mirrored data.
 *
 * We back the `sql` shim with a real in-memory SQLite engine (node:sqlite),
 * write a completion via the repo (the capture path), run the bridge, then
 * init the real orchestrator. We assert two store-observable facts (no
 * @ollie/events dependency — native doesn't pull it in):
 *   1. the watcher recomputed (patternsLastComputedAt written) — it only does
 *      so by reading the mirrored shared.habits_v2 without throwing;
 *   2. scanCompletions consumed today's mirrored completion — surfaced via the
 *      orchestrator's _emittedCompletionCount() test hook (one emit per habit
 *      per UTC day). This is the watcher firing directly off mirrored data.
 */

import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const mockDb = new DatabaseSync(':memory:');

vi.mock('../../storage', () => ({
  sql: {
    async execute(query: string, params: unknown[] = []) {
      mockDb.prepare(query).run(...(params as never[]));
      return { rowsAffected: 0 };
    },
    async select<T>(query: string, params: unknown[] = []): Promise<T[]> {
      return mockDb.prepare(query).all(...(params as never[])) as T[];
    },
  },
}));

import { createStore, createMemoryAdapter } from '@ollie/store';
import { migrateHabits } from './migrate';
import { registry, completions } from './repo';
import { syncToStore } from './bridge';

const FIXED_NOW = new Date('2026-05-31T12:00:00Z').getTime();

beforeEach(async () => {
  await migrateHabits();
  mockDb.exec('DELETE FROM habits_registry');
  mockDb.exec('DELETE FROM habits_completions');
  mockDb.exec('DELETE FROM habits_events');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('habits bridge → orchestrator', () => {
  it('a completion captured in SQLite, mirrored by the bridge, drives the habits watcher', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    // ── capture path: register + complete a habit today (in SQLite) ──
    const habit = await registry.ensure('yoga');
    await completions.add(habit.id, FIXED_NOW);

    // ── bridge: mirror SQLite → the store keys the watcher reads ──
    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    // sanity: the bridge wrote the roster in the watcher's shape, with the
    // completion newest-last (scanCompletions reads completions[last].ts).
    const roster = store.get<Array<{ id: string; completions: Array<{ ts: number }> }>>(
      'shared', 'habits_v2', [],
    );
    expect(roster).toHaveLength(1);
    expect(roster[0]!.completions.at(-1)!.ts).toBe(FIXED_NOW);

    // ── watcher: init reads the mirrored roster + scans completions ──
    const { createHabitsOrchestrator } = await import('@ollie/orchestrator');
    const orch = createHabitsOrchestrator(store, { now: () => FIXED_NOW });
    orch.init();
    // Re-setting habits_v2 fires the subscription → scanCompletions runs
    // synchronously; then flush the recompute debounce.
    await syncToStore(store);
    vi.advanceTimersByTime(600);

    // 1. the watcher recomputed off mirrored data
    expect(store.get<number>('habits', 'patternsLastComputedAt', 0)).toBe(FIXED_NOW);
    // 2. scanCompletions consumed today's mirrored completion (one emit)
    expect(orch._emittedCompletionCount()).toBe(1);

    orch.teardown();
  });
});
