/**
 * Goals module · repository unit tests
 *
 * Backs the `sql` storage wrapper with a real in-memory SQLite engine
 * (node:sqlite) so the repo's actual SQL runs — the production shim is a
 * no-op, which would make these tests vacuous.
 *
 * Coverage:
 *   - create() persists + reads back all 6 rich-capture fields
 *   - create() throws GoalCapError at ACTIVE_GOAL_CAP
 *   - canDelete() fails open (allowed:true) with an empty mood log
 *   - canDelete() locks (allowed:false, reason:'low_mood') after ≥3
 *     low-mood-marker signals in the last 7 days
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// node:sqlite is a Node builtin; require it via createRequire so Vite's
// transform doesn't try to bundle/resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

// In-memory SQLite, shared for the file. Tables are wiped in beforeEach.
// The `mock` prefix lets vitest reference it inside the hoisted vi.mock factory.
const mockDb = new DatabaseSync(':memory:');

// Back the storage wrapper with the real engine so the repo's SQL executes.
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

import { migrateGoals } from './migrate';
import { goals, GoalCapError } from './repo';
import { ACTIVE_GOAL_CAP, DELETE_LOCK_MS, type GoalDraft } from './types';

beforeEach(async () => {
  await migrateGoals(); // memoised — runs the CREATE TABLEs once
  mockDb.exec('DELETE FROM goals_registry');
  mockDb.exec('DELETE FROM goals_events');
  mockDb.exec('DELETE FROM goals_mood_log');
});

describe('goals.create', () => {
  it('persists and reads back all six fields', async () => {
    const draft: GoalDraft = {
      name: '  Move to Netherlands  ',
      why: 'a fresh start',
      targetDate: 1893456000000,
      obstacle: 'visa paperwork stalls',
      premortem: 'gave up after the first rejection',
      ulyssesContract: 'future me: you wanted this badly',
    };

    const created = await goals.create(draft);
    expect(created.name).toBe('move to netherlands'); // normalised
    expect(created.why).toBe('a fresh start');
    expect(created.targetDate).toBe(1893456000000);
    expect(created.obstacle).toBe('visa paperwork stalls');
    expect(created.premortem).toBe('gave up after the first rejection');
    expect(created.ulyssesContract).toBe('future me: you wanted this badly');

    // Round-trip through a fresh read.
    const fetched = await goals.findByName('move to netherlands');
    expect(fetched).not.toBeNull();
    expect(fetched).toMatchObject({
      name: 'move to netherlands',
      why: 'a fresh start',
      targetDate: 1893456000000,
      obstacle: 'visa paperwork stalls',
      premortem: 'gave up after the first rejection',
      ulyssesContract: 'future me: you wanted this badly',
    });
  });

  it('throws GoalCapError when already at ACTIVE_GOAL_CAP', async () => {
    for (let i = 0; i < ACTIVE_GOAL_CAP; i++) {
      await goals.create({ name: `goal ${i}` });
    }
    expect(await goals.activeCount()).toBe(ACTIVE_GOAL_CAP);

    await expect(goals.create({ name: 'one too many' })).rejects.toBeInstanceOf(
      GoalCapError,
    );
    try {
      await goals.create({ name: 'one too many' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as GoalCapError).code).toBe('goal_cap');
      expect((err as Error).name).toBe('GoalCapError');
    }
    // Nothing extra got inserted past the cap.
    expect(await goals.activeCount()).toBe(ACTIVE_GOAL_CAP);
  });
});

describe('goals.ensure (active-goal cap — audit #69)', () => {
  it('throws GoalCapError when inserting a NEW goal at ACTIVE_GOAL_CAP', async () => {
    for (let i = 0; i < ACTIVE_GOAL_CAP; i++) {
      await goals.create({ name: `goal ${i}` });
    }
    expect(await goals.activeCount()).toBe(ACTIVE_GOAL_CAP);

    await expect(goals.ensure('one too many')).rejects.toBeInstanceOf(GoalCapError);
    // Nothing slipped past the cap via ensure().
    expect(await goals.activeCount()).toBe(ACTIVE_GOAL_CAP);
  });

  it('still matches an EXISTING goal at cap (no new active goal added)', async () => {
    for (let i = 0; i < ACTIVE_GOAL_CAP; i++) {
      await goals.create({ name: `goal ${i}` });
    }
    // Re-ensuring an existing name is fine even at cap — it adds nothing.
    const got = await goals.ensure('goal 0');
    expect(got.name).toBe('goal 0');
    expect(await goals.activeCount()).toBe(ACTIVE_GOAL_CAP);
  });

  it('backfills why on an existing goal at cap without throwing', async () => {
    await goals.create({ name: 'learn french' }); // no why
    for (let i = 1; i < ACTIVE_GOAL_CAP; i++) {
      await goals.create({ name: `goal ${i}` });
    }
    expect(await goals.activeCount()).toBe(ACTIVE_GOAL_CAP);

    const got = await goals.ensure('learn french', 'move to paris');
    expect(got.why).toBe('move to paris');
    expect(await goals.activeCount()).toBe(ACTIVE_GOAL_CAP);
  });
});

describe('goals.canDelete (low-mood gate)', () => {
  it('fails open (allowed) with an empty mood log', async () => {
    const g = await goals.create({ name: 'learn spanish' });
    const gate = await goals.canDelete(g.id);
    expect(gate).toEqual({ allowed: true });
  });

  it('locks deletion after ≥3 low-mood signals in the last 7 days', async () => {
    const g = await goals.create({ name: 'learn spanish' });
    // LOW_MOOD_RE markers: exhausted / hopeless / numb.
    await goals.recordMoodSignal('i feel completely exhausted today');
    await goals.recordMoodSignal('everything is hopeless right now');
    await goals.recordMoodSignal('just numb, nothing landed');

    const before = Date.now();
    const gate = await goals.canDelete(g.id);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('low_mood');
    expect(gate.lockedUntil).toBeGreaterThanOrEqual(before + DELETE_LOCK_MS);
  });

  it('stays open when mood signals carry no low-mood markers', async () => {
    const g = await goals.create({ name: 'learn spanish' });
    await goals.recordMoodSignal('had a decent morning');
    await goals.recordMoodSignal('shipped the thing, feeling fine');
    await goals.recordMoodSignal('went for a walk');

    const gate = await goals.canDelete(g.id);
    expect(gate).toEqual({ allowed: true });
  });
});
