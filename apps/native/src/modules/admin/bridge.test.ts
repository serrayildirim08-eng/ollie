/**
 * Admin module · bridge (SQLite → @ollie/store) test
 *
 * Proves the great-rewiring end to end for admin: mirrored SQLite
 * `admin_tasks` rows → syncToStore writes `admin.tasks` (logic shape) → the
 * real admin orchestrator recomputes → the A12 last-5% watcher fires.
 *
 * A12 was chosen because it depends ONLY on fields the native capture actually
 * stores + the bridge derives (state='done' + done_at from a completed row).
 * If it fires, the SQLite→store mirror is correct.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createAdminOrchestrator } from '@ollie/orchestrator';

// ─── mocks (must precede imports of the unit under test) ───────────────────────

vi.mock('./migrate', () => ({
  migrateAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  tasks: { list: vi.fn() },
}));

import { tasks as tasksRepo } from './repo';
import { syncToStore } from './bridge';
import type { AdminTask } from './types';

const mockTasksList = vi.mocked(tasksRepo.list);

const DAY_MS = 86_400_000;
const FIXED_NOW = new Date('2026-05-13T12:00:00Z').getTime();

/**
 * One admin task completed 10 days ago (> the 5-day A12 gap) plus an open one.
 * repo.tasks.list returns most-recent-first.
 */
function makeTasks(): AdminTask[] {
  return [
    { id: 'a1', kind: 'task', text: 'mail the tax form', data: { kind: 'task' }, done: true, ballState: 'done', lastTransitionAt: FIXED_NOW - 10 * DAY_MS, createdAt: FIXED_NOW - 10 * DAY_MS },
    { id: 'a2', kind: 'phone', text: 'call the dentist', data: { kind: 'phone' }, done: false, ballState: 'mine', lastTransitionAt: FIXED_NOW - 2 * DAY_MS, createdAt: FIXED_NOW - 2 * DAY_MS },
  ];
}

describe('admin bridge → orchestrator (great rewiring)', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createAdminOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createAdminOrchestrator(store, { now: () => FIXED_NOW });
    mockTasksList.mockResolvedValue(makeTasks());
  });

  afterEach(() => {
    orch.teardown();
  });

  it('mirrors SQLite admin_tasks into admin.tasks + seeds phoneTasks', async () => {
    await syncToStore(store);
    const tasks = store.get<Array<{ id: string; state?: string; done_at?: number }>>('admin', 'tasks', []);
    expect(tasks.length).toBe(2);
    const done = tasks.find((t) => t.id === 'a1');
    expect(done?.state).toBe('done');
    expect(typeof done?.done_at).toBe('number');
    // phone-kind row seeded into the handle-by-phone cluster
    const phone = store.get<Array<{ verb: string }>>('admin', 'phoneTasks', []);
    expect(phone.some((p) => p.verb === 'call the dentist')).toBe(true);
  });

  it('the last-5% watcher fires once admin.tasks is mirrored', async () => {
    // Before the bridge runs, the watcher has nothing to chew on.
    orch.init();
    const before = store.get<Array<{ signal: string }>>('admin', 'patterns', []);
    expect(before.some((p) => p.signal === 'admin_last_5pct')).toBe(false);

    // Mirror SQLite → store. The init() subscription on admin.tasks fires a
    // debounced (500ms) recompute on the store.set; wait for it to flush.
    await syncToStore(store);
    await vi.waitFor(() => {
      const after = store.get<Array<{ signal: string }>>('admin', 'patterns', []);
      expect(after.some((p) => p.signal === 'admin_last_5pct')).toBe(true);
    });
  });
});
