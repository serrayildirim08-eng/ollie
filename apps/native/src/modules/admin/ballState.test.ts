/**
 * Ball-state v1 (audit #7): mine | waiting | done.
 *
 * Pure inference is tested directly; the repo transitions are exercised against
 * a real in-memory SQLite engine through the #3 migration runner.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inferInitialBallState, looksLikeWaiting } from './ballState';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const mockDb = new DatabaseSync(':memory:');

vi.mock('../../storage', () => {
  const sql = {
    async execute(query: string, params: unknown[] = []) {
      mockDb.prepare(query).run(...(params as never[]));
      return { rowsAffected: 0 };
    },
    async select<T>(query: string, params: unknown[] = []): Promise<T[]> {
      return mockDb.prepare(query).all(...(params as never[])) as T[];
    },
  };
  return {
    sql,
    async addColumnIfMissing(table: string, column: string, columnDef: string) {
      const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === column)) return;
      mockDb.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`).run();
    },
  };
});

import { tasks } from './repo';
import { migrateAdmin, _resetAdminMigration } from './migrate';

describe('inferInitialBallState (pure)', () => {
  it('moves clear hand-off signals to waiting', () => {
    expect(inferInitialBallState('sent the form to the landlord')).toBe('waiting');
    expect(inferInitialBallState('waiting to hear back from the doctor')).toBe('waiting');
    expect(inferInitialBallState('submitted application for visa')).toBe('waiting');
    expect(looksLikeWaiting('they will confirm tomorrow')).toBe(true);
  });

  it('keeps ordinary tasks as mine (conservative)', () => {
    expect(inferInitialBallState('buy milk')).toBe('mine');
    expect(inferInitialBallState('call the dentist')).toBe('mine');
    expect(looksLikeWaiting('finish the report')).toBe(false);
  });
});

describe('repo ball_state transitions', () => {
  beforeEach(async () => {
    const t = mockDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
    for (const r of t) mockDb.prepare(`DROP TABLE IF EXISTS ${r.name}`).run();
    _resetAdminMigration();
    await migrateAdmin();
  });

  it('new tasks default to mine with a stamped last_transition_at', async () => {
    const created = await tasks.add({ kind: 'task', text: 'x', data: { kind: 'task' } });
    expect(created.ballState).toBe('mine');
    expect(created.lastTransitionAt).toBe(created.createdAt);
    const [row] = await tasks.list();
    expect(row.ballState).toBe('mine');
  });

  it('add can start a task in waiting', async () => {
    await tasks.add({ kind: 'task', text: 'sent form', data: { kind: 'task' }, ballState: 'waiting' });
    expect((await tasks.list())[0].ballState).toBe('waiting');
  });

  it('setBallState moves the ball and re-stamps last_transition_at', async () => {
    const created = await tasks.add({ kind: 'task', text: 'x', data: { kind: 'task' } });
    await tasks.setBallState(created.id, 'waiting');
    const [row] = await tasks.list();
    expect(row.ballState).toBe('waiting');
    expect(row.lastTransitionAt).toBeGreaterThanOrEqual(created.lastTransitionAt);
  });

  it('completing a task moves the ball to done', async () => {
    const created = await tasks.add({ kind: 'task', text: 'x', data: { kind: 'task' } });
    await tasks.markComplete(created.id);
    const all = await tasks.list();
    expect(all[0].ballState).toBe('done');
    expect(all[0].done).toBe(true);
  });
});
