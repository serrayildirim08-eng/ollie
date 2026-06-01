/**
 * Work module · bridge (SQLite → @ollie/store) test
 *
 * Proves the great-rewiring end to end for work — the audit's load-bearing
 * fix: mirrored SQLite `work_events` (focus_session rows) → syncToStore writes
 * `work.focus_log` → the real work orchestrator recomputes → a focus_log-driven
 * watcher fires.
 *
 * recomputePomodoro was chosen because it reads work.focus_log directly and is
 * fully deterministic (no review-gate, no 8h-session requirement the native
 * 15/25/45/90 modes can't reach). If `blocks_today` reflects the mirrored
 * SQLite focus sessions, the SQLite→store mirror that revives the ~14 work
 * detectors is correct.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createWorkOrchestrator } from '@ollie/orchestrator';

// ─── mocks (must precede imports of the unit under test) ───────────────────────

vi.mock('./migrate', () => ({
  migrateWork: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  events: { list: vi.fn() },
  tasks: { list: vi.fn() },
}));

import { events as eventsRepo, tasks as tasksRepo } from './repo';
import { syncToStore } from './bridge';
import type { WorkEvent } from './types';

const mockEventsList = vi.mocked(eventsRepo.list);
const mockTasksList = vi.mocked(tasksRepo.list);

// A fixed local noon so all three sessions land in the same calendar day.
const FIXED_NOW = new Date('2026-05-13T12:00:00').getTime();
const MIN = 60_000;

/**
 * Three completed 25-min focus sessions earlier today. repo.events.list
 * returns newest-first; the bridge reverses to oldest-first. Each is a full
 * 25-min block (duration_ms = mode*60_000), so all count as completed under
 * the 0.9 pomodoro completion ratio.
 */
function makeFocusEvents(): WorkEvent[] {
  return [
    { id: 'f3', kind: 'focus_session', loggedAt: FIXED_NOW - 30 * MIN, data: { kind: 'focus_session', durationMin: 25, project: null } },
    { id: 'f2', kind: 'focus_session', loggedAt: FIXED_NOW - 90 * MIN, data: { kind: 'focus_session', durationMin: 25, project: null } },
    { id: 'f1', kind: 'focus_session', loggedAt: FIXED_NOW - 150 * MIN, data: { kind: 'focus_session', durationMin: 25, project: null } },
  ];
}

describe('work bridge → orchestrator (great rewiring)', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createWorkOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createWorkOrchestrator(store, { now: () => FIXED_NOW });
    mockEventsList.mockResolvedValue(makeFocusEvents());
    mockTasksList.mockResolvedValue([]);
  });

  afterEach(() => {
    orch.teardown();
    vi.useRealTimers();
  });

  it('mirrors SQLite focus_session rows into work.focus_log (oldest-first)', async () => {
    await syncToStore(store);
    const log = store.get<Array<{ ts: number; duration_min: number; duration_ms: number }>>(
      'work',
      'focus_log',
      [],
    );
    expect(log.length).toBe(3);
    // oldest-first ordering
    expect(log[0].ts < log[2].ts).toBe(true);
    expect(log.every((e) => e.duration_min === 25 && e.duration_ms === 25 * MIN)).toBe(true);
  });

  it('the pomodoro watcher counts today\'s blocks once focus_log is mirrored', async () => {
    // Before the bridge runs, the watcher has nothing to chew on.
    orch.recomputePomodoro();
    const before = store.get<{ blocks_today: number }>('work', 'pomodoro', { blocks_today: 0 });
    expect(before.blocks_today).toBe(0);

    // Mirror SQLite → store, then recompute.
    await syncToStore(store);
    orch.recomputePomodoro();

    const after = store.get<{ blocks_today: number; earned_break: string }>(
      'work',
      'pomodoro',
      { blocks_today: 0, earned_break: 'none' },
    );
    expect(after.blocks_today).toBe(3);
    expect(after.earned_break).not.toBe('none');
  });
});
