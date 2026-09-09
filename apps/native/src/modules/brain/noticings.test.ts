/**
 * Brain noticings · integration test
 *
 * Backs the `sql` shim with a real in-memory SQLite engine and proves the
 * selection-discipline wiring:
 *   - gathers candidates from <module>.patterns + shared.patterns + harm rows
 *   - selects the top 2–3 (Decision 1)
 *   - postpone hides a noticing AND persists across a simulated restart, then
 *     resurfaces once the snooze expires (Decision 2)
 *   - postpone is logged as a deferral signal; dismiss is permanent + is NOT
 *   - low capacity drops a small grocery note but keeps an urgent deadline
 *     (Decision 3)
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const mockDb = new DatabaseSync(':memory:');

vi.mock('../../storage', () => ({
  sql: {
    async execute(query: string, params: unknown[] = []) {
      const res = mockDb.prepare(query).run(...(params as never[]));
      return { rowsAffected: Number(res.changes ?? 0) };
    },
    async select<T>(query: string, params: unknown[] = []): Promise<T[]> {
      return mockDb.prepare(query).all(...(params as never[])) as T[];
    },
  },
}));

import { createStore, createMemoryAdapter } from '@ollie/store';
import { migrateBrain } from './migrate';
import {
  selectTodaysNoticings,
  postponeNoticing,
  dismissNoticing,
  excludedIds,
  countDeferralEvents,
  gatherCandidates,
} from './noticings';

const NOW = new Date('2026-06-08T12:00:00Z').getTime();
const DAY = 86_400_000;

beforeEach(async () => {
  await migrateBrain();
  mockDb.exec('DELETE FROM brain_noticing_state');
  mockDb.exec('DELETE FROM brain_deferral_events');
  mockDb.exec('DELETE FROM brain_harm_events');
});

/** A store seeded with three admin deadline patterns + one trivial grocery add. */
function seededStore() {
  const store = createStore(createMemoryAdapter());
  store.set('admin', 'patterns', [
    { pattern: 'deadline_a', category: 'deadline_passed', copy: 'A is overdue', dueDate: NOW - 1 * DAY },
    { pattern: 'deadline_b', category: 'deadline_passed', copy: 'B is overdue', dueDate: NOW - 2 * DAY },
    { pattern: 'deadline_c', category: 'deadline_passed', copy: 'C is overdue', dueDate: NOW - 3 * DAY },
  ]);
  // a bare grocery add — no run-out date, deferrable, no urgency → never surfaces
  store.set('grocery', 'patterns', [
    { pattern: 'grocery-add', category: 'grocery-add', copy: 'bought tomatoes' },
  ]);
  return store;
}

describe('gatherCandidates', () => {
  it('normalises module patterns + shared.patterns + harm rows', async () => {
    const store = seededStore();
    store.set('shared', 'patterns', [
      { module: 'work', pattern: 'shared_one', copy: 'a shared note' },
    ]);
    mockDb.prepare(
      `INSERT INTO brain_harm_events (id, ref_kind, ref_id, harm_kind, detected_at)
       VALUES ('missed:renewal:r1','renewal','r1','missed',?)`,
    ).run(NOW - DAY);

    const cands = await gatherCandidates(store);
    const ids = cands.map((c) => c.id);
    expect(ids).toContain('admin:deadline_a');
    expect(ids).toContain('work:shared_one');
    expect(ids).toContain('harm:missed:renewal:r1');
  });

  it('carries wave-2 ARRAY + NUMERIC offer facts through factsOf (the risky plumbing)', async () => {
    const store = createStore(createMemoryAdapter());
    const fireAt = NOW + 7 * DAY;
    store.set('admin', 'patterns', [
      {
        pattern: 'paperwork-pile',
        category: 'paperwork_piling',
        copy: '3 admin things stalled',
        actionKind: 'surface_tasks',
        taskIds: ['p1', 'p2', 'p3'],
      },
      {
        pattern: 'renewal-cluster:2026-07',
        category: 'renewal-cluster',
        copy: '2 renewals same month',
        actionKind: 'batch_block',
        batchLabel: 'renewals: passport, license',
        batchFireAtMs: fireAt,
        renewalIds: ['c1', 'c2'],
      },
    ]);

    const cands = await gatherCandidates(store);
    const pile = cands.find((c) => c.id === 'admin:paperwork-pile');
    expect(pile?.facts?.taskIds).toEqual(['p1', 'p2', 'p3']);
    expect(pile?.facts?.actionKind).toBe('surface_tasks');

    const cluster = cands.find((c) => c.id === 'admin:renewal-cluster:2026-07');
    expect(cluster?.facts?.renewalIds).toEqual(['c1', 'c2']);
    expect(cluster?.facts?.batchFireAtMs).toBe(fireAt);
    expect(cluster?.facts?.batchLabel).toBe('renewals: passport, license');
  });
});

describe('selectTodaysNoticings · Decision 1 (top 2–3)', () => {
  it('surfaces at most 3, and a trivial capture produces 0 of its own', async () => {
    const store = seededStore();
    const out = await selectTodaysNoticings(store, NOW);
    expect(out.length).toBeLessThanOrEqual(3);
    // the deferrable grocery add never makes the cut
    expect(out.map((n) => n.id)).not.toContain('grocery:grocery-add');
  });

  it('a store with only a trivial grocery add surfaces nothing', async () => {
    const store = createStore(createMemoryAdapter());
    store.set('grocery', 'patterns', [
      { pattern: 'grocery-add', category: 'grocery-add', copy: 'bought tomatoes' },
    ]);
    expect(await selectTodaysNoticings(store, NOW)).toHaveLength(0);
  });
});

describe('postpone · Decision 2 (snooze persists, resurfaces, logs deferral)', () => {
  it('hides now, stays hidden after a simulated restart, returns when snooze expires', async () => {
    const store = seededStore();
    const before = await selectTodaysNoticings(store, NOW);
    expect(before.map((n) => n.id)).toContain('admin:deadline_a');

    await postponeNoticing({ id: 'admin:deadline_a', module: 'admin', category: 'deadline_passed' }, NOW);

    // immediately hidden
    const after = await selectTodaysNoticings(store, NOW);
    expect(after.map((n) => n.id)).not.toContain('admin:deadline_a');

    // "restart": a fresh store, same SQLite — still excluded mid-window
    const fresh = seededStore();
    const afterRestart = await selectTodaysNoticings(fresh, NOW + 2 * 3_600_000);
    expect(afterRestart.map((n) => n.id)).not.toContain('admin:deadline_a');

    // snooze expired (+1 day later) → it comes back
    const later = await selectTodaysNoticings(seededStore(), NOW + DAY + 1000);
    expect(later.map((n) => n.id)).toContain('admin:deadline_a');
  });

  it('the next-ranked fills the slot when one is postponed', async () => {
    const store = seededStore();
    await postponeNoticing({ id: 'admin:deadline_a' }, NOW);
    const out = await selectTodaysNoticings(store, NOW);
    // a,b,c were the three; a is snoozed → b + c surface (slot refilled)
    expect(out.map((n) => n.id)).toContain('admin:deadline_b');
    expect(out.map((n) => n.id)).toContain('admin:deadline_c');
    expect(out.map((n) => n.id)).not.toContain('admin:deadline_a');
  });

  it('records each postpone as a deferral signal', async () => {
    await postponeNoticing({ id: 'admin:deadline_a', module: 'admin', category: 'deadline_passed' }, NOW);
    await postponeNoticing({ id: 'admin:deadline_b', module: 'admin', category: 'deadline_passed' }, NOW);
    expect(await countDeferralEvents()).toBe(2);
    const rows = mockDb.prepare(`SELECT module, category FROM brain_deferral_events ORDER BY id`).all() as Array<{ module: string; category: string }>;
    expect(rows[0]).toMatchObject({ module: 'admin', category: 'deadline_passed' });
  });
});

describe('dismiss · permanent, not a deferral', () => {
  it('removes the noticing forever and does NOT log a deferral signal', async () => {
    const store = seededStore();
    await dismissNoticing('admin:deadline_a', NOW);

    // hidden now and far in the future (no snooze expiry to wait out)
    expect((await selectTodaysNoticings(store, NOW)).map((n) => n.id)).not.toContain('admin:deadline_a');
    expect(
      (await selectTodaysNoticings(seededStore(), NOW + 30 * DAY)).map((n) => n.id),
    ).not.toContain('admin:deadline_a');

    // a dismiss is a rejection, not a deferral
    expect(await countDeferralEvents()).toBe(0);
  });
});

describe('excludedIds', () => {
  it('includes unexpired snoozes + all dismisses, excludes expired snoozes', async () => {
    await postponeNoticing({ id: 'snoozed' }, NOW); // until NOW + 1 day
    await dismissNoticing('killed', NOW);

    const mid = await excludedIds(NOW + 2 * 3_600_000);
    expect(mid.has('snoozed')).toBe(true);
    expect(mid.has('killed')).toBe(true);

    const afterExpiry = await excludedIds(NOW + DAY + 1000);
    expect(afterExpiry.has('snoozed')).toBe(false); // snooze lapsed → back
    expect(afterExpiry.has('killed')).toBe(true); // dismiss is forever
  });
});

describe('Decision 3 · low-capacity moderate suppression', () => {
  it('drops a small grocery replenish note on low capacity but keeps an urgent deadline', async () => {
    const store = createStore(createMemoryAdapter());
    store.set('admin', 'patterns', [
      { pattern: 'deadline_x', category: 'deadline_passed', copy: 'tax filing due', dueDate: NOW - DAY },
    ]);
    store.set('grocery', 'patterns', [
      { pattern: 'grocery-replenish-needed', category: 'grocery-replenish-needed', copy: 'milk ran low', predictedOutAtMs: NOW - DAY },
    ]);

    store.set('shared', 'capacity', { level: 'medium' });
    const med = (await selectTodaysNoticings(store, NOW)).map((n) => n.id);
    expect(med).toContain('admin:deadline_x');
    expect(med).toContain('grocery:grocery-replenish-needed');

    store.set('shared', 'capacity', { level: 'low' });
    const low = (await selectTodaysNoticings(store, NOW)).map((n) => n.id);
    expect(low).toContain('admin:deadline_x'); // urgent survives
    expect(low).not.toContain('grocery:grocery-replenish-needed'); // small note rests
  });
});
