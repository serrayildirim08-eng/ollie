/**
 * Chores · repo tests (real in-memory SQLite).
 *
 * Exercises:
 *   - upsert dedupes by normalised name; one_off → recurring promotion
 *   - markDone on a recurring chore stamps last_done_at + keeps it on the list
 *   - markDone on a one_off marks it done (drops from listOpenOneOff)
 *   - markDone on an unknown name registers a done one_off (completion kept)
 *   - listDueRecurring: recurring chore becomes due after cadenceDays elapse,
 *     and marking it done resets the clock (the cadence-due detection)
 *   - cadence.getCadenceFor learns the chore's interval from completions
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { migrateChores } from './migrate';
import { chores, cadence, isChoreDue, isChoreDueToday } from './repo';
import { localWeekday } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await migrateChores();
  mockDb.exec('DELETE FROM chores');
  mockDb.exec('DELETE FROM chore_completion');
});

describe('chores.upsert', () => {
  it('dedupes by normalised name', async () => {
    await chores.upsert({ name: 'Vacuum', kind: 'one_off' });
    await chores.upsert({ name: 'vacuum', kind: 'one_off' });
    const list = await chores.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('vacuum');
  });

  it('promotes a one_off to recurring (never downgrades)', async () => {
    await chores.upsert({ name: 'mop', kind: 'one_off' });
    await chores.upsert({ name: 'mop', kind: 'recurring', cadenceDays: 14 });
    let c = await chores.getByName('mop');
    expect(c?.kind).toBe('recurring');
    expect(c?.cadenceDays).toBe(14);
    // A later one_off statement must NOT wipe the learned cadence.
    await chores.upsert({ name: 'mop', kind: 'one_off' });
    c = await chores.getByName('mop');
    expect(c?.kind).toBe('recurring');
    expect(c?.cadenceDays).toBe(14);
  });
});

describe('chores.markDone', () => {
  it('one_off → done (drops from open list)', async () => {
    await chores.upsert({ name: 'clean the kitchen', kind: 'one_off' });
    await chores.markDone('clean the kitchen');
    const open = await chores.listOpenOneOff();
    expect(open).toHaveLength(0);
    const c = await chores.getByName('clean the kitchen');
    expect(c?.done).toBe(true);
    expect(c?.lastDoneAt).not.toBeNull();
  });

  it('recurring → stamps last_done_at, stays active (done=false)', async () => {
    await chores.upsert({ name: 'do laundry', kind: 'recurring', cadenceDays: 7 });
    const result = await chores.markDone('do laundry');
    expect(result.done).toBe(false);
    expect(result.lastDoneAt).not.toBeNull();
  });

  it('unknown name → registers a done one_off so the completion is kept', async () => {
    await chores.markDone('took out the trash');
    const c = await chores.getByName('took out the trash');
    expect(c).not.toBeNull();
    expect(c?.kind).toBe('one_off');
    expect(c?.done).toBe(true);
    const est = await cadence.getCadenceFor('took out the trash');
    expect(est.sampleSize).toBe(1);
  });
});

describe('listDueRecurring — cadence-due detection', () => {
  it('a recurring chore becomes due after cadenceDays, and markDone resets it', async () => {
    const now = Date.now();
    await chores.upsert({ name: 'vacuum', kind: 'recurring', cadenceDays: 7 });
    // Seed last_done_at to 8 days ago → due.
    mockDb
      .prepare(`UPDATE chores SET last_done_at = ? WHERE name = 'vacuum'`)
      .run(now - 8 * DAY_MS);

    const due = await chores.listDueRecurring(now);
    expect(due.map((c) => c.name)).toContain('vacuum');

    // Marking it done resets the clock → no longer due.
    await chores.markDone('vacuum', now);
    const dueAfter = await chores.listDueRecurring(now);
    expect(dueAfter.map((c) => c.name)).not.toContain('vacuum');
  });

  it('a never-done recurring chore is due immediately', async () => {
    await chores.upsert({ name: 'water plants', kind: 'recurring', cadenceDays: 3 });
    const c = await chores.getByName('water plants');
    expect(isChoreDue(c!, Date.now())).toBe(true);
  });

  it('a one_off is never "due" via cadence', async () => {
    await chores.upsert({ name: 'clean the garage', kind: 'one_off' });
    const c = await chores.getByName('clean the garage');
    expect(isChoreDue(c!, Date.now())).toBe(false);
  });
});

describe('weekday-anchored chores — listDueToday + isChoreDueToday', () => {
  // Anchor on whatever weekday `now` actually is, so the test is independent of
  // the day it runs.
  const now = Date.now();
  const today = localWeekday(now);
  const otherDay = (today + 1) % 7;

  it('upsert with weekdays stores them and clears interval cadence', async () => {
    await chores.upsert({
      name: 'do laundry',
      kind: 'recurring',
      cadenceDays: 7,
      weekdays: [today],
    });
    const c = await chores.getByName('do laundry');
    expect(c?.weekdays).toEqual([today]);
    expect(c?.cadenceDays).toBeNull(); // weekday-anchored carries no interval
  });

  it('appears on today only on a matching weekday', async () => {
    await chores.upsert({ name: 'laundry', kind: 'recurring', weekdays: [today] });
    await chores.upsert({ name: 'sweep porch', kind: 'recurring', weekdays: [otherDay] });

    const due = await chores.listDueToday(now);
    const names = due.map((c) => c.name);
    expect(names).toContain('laundry');
    expect(names).not.toContain('sweep porch');
  });

  it('drops off after being marked done today, returns next matching week', async () => {
    await chores.upsert({ name: 'laundry', kind: 'recurring', weekdays: [today] });
    const before = await chores.getByName('laundry');
    expect(isChoreDueToday(before!, now)).toBe(true);

    await chores.markDone('laundry', now);
    const after = await chores.getByName('laundry');
    expect(isChoreDueToday(after!, now)).toBe(false); // already done today

    // Same weekday next week → due again.
    expect(isChoreDueToday(after!, now + 7 * DAY_MS)).toBe(true);
  });

  it('listDueToday also surfaces interval chores whose clock rolled over', async () => {
    await chores.upsert({ name: 'vacuum', kind: 'recurring', cadenceDays: 7 });
    mockDb
      .prepare(`UPDATE chores SET last_done_at = ? WHERE name = 'vacuum'`)
      .run(now - 8 * DAY_MS);
    const due = await chores.listDueToday(now);
    expect(due.map((c) => c.name)).toContain('vacuum');
  });
});

describe('cadence.getCadenceFor', () => {
  it('learns the interval from logged completions', async () => {
    const now = Date.now();
    await chores.upsert({ name: 'vacuum', kind: 'recurring', cadenceDays: 7 });
    // Three completions ~7 days apart.
    for (const t of [now - 14 * DAY_MS, now - 7 * DAY_MS, now]) {
      await chores.markDone('vacuum', t);
    }
    const est = await cadence.getCadenceFor('vacuum');
    expect(est.sampleSize).toBe(3);
    expect(est.confidence).not.toBe('low-data');
    expect(Math.round(est.medianIntervalMs / DAY_MS)).toBe(7);
  });
});
