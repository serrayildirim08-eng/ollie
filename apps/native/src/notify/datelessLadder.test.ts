/**
 * datelessLadder · unit tests
 *
 * Coverage:
 *   1. tierFireAt — growing-gap math (+1d, +3d, +7d, +30d cumulative)
 *   2. startDatelessLadder — schedules tier 0, persists state, idempotent,
 *      no-op for a DATED task
 *   3. sweep — advances tiers as their fire time passes; arms the next tier's
 *      OS notification; idempotent (re-run same clock = no extra schedule)
 *   4. sweep cancel-on-complete — a task that left listOpen drops its entry +
 *      emits 'ollie-cancel-notif' for every tier
 *   5. cancelLadder — emits cancel for all tiers + forgets state
 *   6. go-dark — sweep skips entirely and does NOT advance the tier
 *   7. archive offer — surfaced once after the full ladder elapses, then the
 *      entry stops being tracked
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import type { Store } from '@ollie/store';

// ─── mocks ───────────────────────────────────────────────────────────────────

// scheduleAt: record (fireAt, payload, id) tuples instead of touching the OS.
const scheduleAtMock = vi.fn();
vi.mock('./systemNotify', () => ({
  scheduleAt: (at: number, payload: unknown, id: string) => scheduleAtMock(at, payload, id),
}));

// Tauri event bridge → observe cancel emits.
const emitMock = vi.fn((_event: string, _payload?: unknown) => Promise.resolve());
vi.mock('@tauri-apps/api/event', () => ({
  emit: (event: string, payload?: unknown) => emitMock(event, payload),
}));

// go-dark read.
let darkToday = false;
vi.mock('../modules/partner/repo', () => ({
  partnerRepo: {
    load: () => Promise.resolve({}),
    isDarkToday: () => darkToday,
  },
}));

// admin + work repos — only listOpen + their migrate matter to the sweep.
let adminOpenIds: string[] = [];
let workOpenIds: string[] = [];
vi.mock('../modules/admin/migrate', () => ({ migrateAdmin: () => Promise.resolve() }));
vi.mock('../modules/work/migrate', () => ({ migrateWork: () => Promise.resolve() }));
vi.mock('../modules/admin/repo', () => ({
  tasks: { listOpen: () => Promise.resolve(adminOpenIds.map((id) => ({ id }))) },
}));
vi.mock('../modules/work/repo', () => ({
  tasks: { listOpen: () => Promise.resolve(workOpenIds.map((id) => ({ id }))) },
}));

import {
  tierFireAt,
  startDatelessLadder,
  sweepDatelessLadders,
  cancelLadder,
  LADDER_TIER_COUNT,
} from './datelessLadder';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000; // fixed creation epoch

/** Flush pending tasks so the dynamic-import-backed cancel emits land. A real
 *  macrotask tick is needed — vitest resolves dynamic import() on a macrotask,
 *  not a microtask, so awaiting Promise.resolve() alone is insufficient. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function ladderEntries(store: Store, module: 'admin' | 'work'): Array<{ taskId: string; tier: number; offered: boolean }> {
  return store.get(module, '_datelessLadder', []) as Array<{ taskId: string; tier: number; offered: boolean }>;
}

beforeEach(() => {
  scheduleAtMock.mockClear();
  emitMock.mockClear();
  darkToday = false;
  adminOpenIds = [];
  workOpenIds = [];
});

// ─── 1. tier math ─────────────────────────────────────────────────────────────

describe('tierFireAt', () => {
  it('grows the gaps cumulatively: +1d, +4d, +11d, +41d', () => {
    expect(tierFireAt(T0, 0)).toBe(T0 + 1 * DAY);
    expect(tierFireAt(T0, 1)).toBe(T0 + 4 * DAY);
    expect(tierFireAt(T0, 2)).toBe(T0 + 11 * DAY);
    expect(tierFireAt(T0, 3)).toBe(T0 + 41 * DAY);
  });
  it('tier === count returns the final tier moment', () => {
    expect(tierFireAt(T0, LADDER_TIER_COUNT)).toBe(tierFireAt(T0, LADDER_TIER_COUNT - 1));
  });
});

// ─── 2. start ──────────────────────────────────────────────────────────────────

describe('startDatelessLadder', () => {
  it('schedules tier 0 + persists state for a date-less task', () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });

    expect(scheduleAtMock).toHaveBeenCalledTimes(1);
    const [at, , id] = scheduleAtMock.mock.calls[0]!;
    expect(at).toBe(T0 + 1 * DAY);
    expect(id).toBe('ladder:admin:a1:0');

    const entries = ladderEntries(store, 'admin');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ taskId: 'a1', tier: 0, offered: false });
  });

  it('is a no-op for a DATED task', () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a2', text: 'x', dueDate: '2026-07-01', createdAt: T0 });
    expect(scheduleAtMock).not.toHaveBeenCalled();
    expect(ladderEntries(store, 'admin')).toHaveLength(0);
  });

  it('is idempotent — re-registering the same id does nothing', () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'work', taskId: 'w1', text: 'send deck', dueDate: null, createdAt: T0 });
    startDatelessLadder(store, { module: 'work', taskId: 'w1', text: 'send deck', dueDate: null, createdAt: T0 });
    expect(scheduleAtMock).toHaveBeenCalledTimes(1);
    expect(ladderEntries(store, 'work')).toHaveLength(1);
  });
});

// ─── 3. sweep advances tiers ───────────────────────────────────────────────────

describe('sweepDatelessLadders — tier advance', () => {
  it('advances tier + arms the next tier notification once its fire time passes', async () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });
    scheduleAtMock.mockClear();
    adminOpenIds = ['a1'];

    // Move clock just past tier 0's fire time → should advance to tier 1 and
    // arm tier 1's notification.
    await sweepDatelessLadders(store, T0 + 1 * DAY + 1000);

    expect(ladderEntries(store, 'admin')[0]!.tier).toBe(1);
    const armedIds = scheduleAtMock.mock.calls.map((c) => c[2]);
    expect(armedIds).toContain('ladder:admin:a1:1');
  });

  it('is idempotent — a second sweep at the same clock arms nothing new', async () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });
    adminOpenIds = ['a1'];
    await sweepDatelessLadders(store, T0 + 1 * DAY + 1000);
    scheduleAtMock.mockClear();
    await sweepDatelessLadders(store, T0 + 1 * DAY + 1000);
    expect(scheduleAtMock).not.toHaveBeenCalled();
    expect(ladderEntries(store, 'admin')[0]!.tier).toBe(1);
  });
});

// ─── 4. cancel-on-complete via sweep ───────────────────────────────────────────

describe('sweepDatelessLadders — completed task', () => {
  it('drops the entry + emits cancel for every tier when the task left listOpen', async () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });
    adminOpenIds = []; // a1 was completed → no longer open

    await sweepDatelessLadders(store, T0 + 1 * DAY + 1000);
    await flushMicrotasks(); // cancel emits ride a dynamic import (microtask)

    expect(ladderEntries(store, 'admin')).toHaveLength(0);
    const cancelled = emitMock.mock.calls
      .filter((c) => c[0] === 'ollie-cancel-notif')
      .map((c) => c[1]);
    for (let tier = 0; tier < LADDER_TIER_COUNT; tier += 1) {
      expect(cancelled).toContain(`ladder:admin:a1:${tier}`);
    }
  });
});

// ─── 5. cancelLadder ───────────────────────────────────────────────────────────

describe('cancelLadder', () => {
  it('emits cancel for all tiers + forgets the entry', async () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'work', taskId: 'w1', text: 'send deck', dueDate: null, createdAt: T0 });

    cancelLadder('work', 'w1', store);
    await flushMicrotasks(); // cancel emits ride a dynamic import (microtask)

    expect(ladderEntries(store, 'work')).toHaveLength(0);
    const cancelled = emitMock.mock.calls
      .filter((c) => c[0] === 'ollie-cancel-notif')
      .map((c) => c[1]);
    for (let tier = 0; tier < LADDER_TIER_COUNT; tier += 1) {
      expect(cancelled).toContain(`ladder:work:w1:${tier}`);
    }
  });
});

// ─── 6. go-dark ────────────────────────────────────────────────────────────────

describe('sweepDatelessLadders — go-dark', () => {
  it('skips entirely + does NOT advance the tier while taking the day off', async () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });
    scheduleAtMock.mockClear();
    adminOpenIds = ['a1'];
    darkToday = true;

    await sweepDatelessLadders(store, T0 + 41 * DAY); // long past every tier

    // tier unchanged, no new notification armed, no archive offer written.
    expect(ladderEntries(store, 'admin')[0]!.tier).toBe(0);
    expect(scheduleAtMock).not.toHaveBeenCalled();
    expect(store.get('admin', 'patterns', [])).toEqual([]);
  });
});

// ─── 7. archive offer after the full ladder ────────────────────────────────────

describe('sweepDatelessLadders — archive offer', () => {
  it('surfaces a model-C archive offer once the full ladder elapses, then stops tracking', async () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });
    adminOpenIds = ['a1'];

    await sweepDatelessLadders(store, T0 + 41 * DAY + 1000); // past the final tier

    // entry no longer tracked (offer surfaced).
    expect(ladderEntries(store, 'admin')).toHaveLength(0);
    // an archive offer card was written into admin.patterns.
    const cards = store.get('admin', 'patterns', []) as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      category: 'task-archive',
      actionKind: 'archive_task',
      taskModule: 'admin',
      taskId: 'a1',
    });
    expect(String(cards[0]!.copy)).toContain('call bank');
  });

  it('does not duplicate the offer card on a re-sweep', async () => {
    const store = createStore(createMemoryAdapter());
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });
    adminOpenIds = ['a1'];
    await sweepDatelessLadders(store, T0 + 41 * DAY + 1000);
    // The entry is gone after the offer; a fresh entry would be needed to retry,
    // but even if re-registered, surfaceArchiveOffer dedupes by pattern id.
    startDatelessLadder(store, { module: 'admin', taskId: 'a1', text: 'call bank', dueDate: null, createdAt: T0 });
    await sweepDatelessLadders(store, T0 + 41 * DAY + 2000);
    const cards = store.get('admin', 'patterns', []) as unknown[];
    expect(cards).toHaveLength(1);
  });
});
