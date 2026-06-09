/**
 * Goals bridge · integration test
 *
 * Proves the great-rewiring works end-to-end for goals: SQLite capture →
 * syncToStore → the goals Layer-2 watcher computes a pattern from the
 * mirrored data.
 *
 * We back the `sql` shim with a real in-memory SQLite engine, create goals
 * via the repo (the capture path — note `create` enforces the 5-goal cap, so
 * we insert the 6th directly to simulate a pre-cap registry), run the bridge,
 * then init the real orchestrator and assert `detectActiveCap` fired — which
 * it can only do by reading the `goals.items` shape (status:'active') the
 * bridge wrote.
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
import { migrateGoals } from './migrate';
import { syncToStore } from './bridge';

const FIXED_NOW = new Date('2026-05-31T12:00:00Z').getTime();
const DAY = 86_400_000;

beforeEach(async () => {
  await migrateGoals();
  mockDb.exec('DELETE FROM goals_registry');
  mockDb.exec('DELETE FROM goals_events');
  mockDb.exec('DELETE FROM goals_mood_log');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('goals bridge → orchestrator', () => {
  it('6 goals captured in SQLite, mirrored by the bridge, make the watcher detect the active-cap pattern', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    // ── capture path: 6 goal rows in SQLite (insert direct to bypass the
    //    runtime create-cap; the registry can legitimately hold ≥6 if rows
    //    predate the cap, which is exactly what the detector exists to flag) ──
    for (let i = 0; i < 6; i++) {
      mockDb
        .prepare(`INSERT INTO goals_registry (id, name, why, created_at) VALUES (?, ?, ?, ?)`)
        .run(`g${i}`, `goal ${i}`, null, FIXED_NOW - (i + 1) * DAY);
    }

    // ── bridge: mirror SQLite → goals.* store keys ──
    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    // sanity: bridge wrote items in the watcher's shape (status:'active')
    const items = store.get<Array<{ id: string; status: string }>>('goals', 'items', []);
    expect(items).toHaveLength(6);
    expect(items.every((g) => g.status === 'active')).toBe(true);

    // ── watcher: it should compute the active-cap pattern off mirrored data ──
    const { createGoalsOrchestrator } = await import('@ollie/orchestrator');
    const orch = createGoalsOrchestrator(store, { now: () => FIXED_NOW, getConsent: () => true });
    orch.init();
    vi.advanceTimersByTime(600);

    const patterns = store.get<Array<{ pattern?: string }>>('goals', 'patterns', []);
    expect(patterns.some((p) => p?.pattern === 'goals_active_cap_exceeded')).toBe(true);

    orch.teardown();
  });
});
