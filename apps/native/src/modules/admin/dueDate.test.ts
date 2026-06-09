/**
 * Admin generic-task due dates (audit #6).
 *
 * Backs the `sql` wrapper with a real in-memory SQLite engine so the repo's
 * actual SQL + the #3 migration runner execute. Covers: due_date round-trips
 * through tasks.add → list; a dated task surfaces with a `date` on /todo; an
 * existing (pre-#6) admin_tasks table is upgraded with the new column.
 */

import { createRequire } from 'node:module';
import { beforeEach, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const mockDb = new DatabaseSync(':memory:');

// Back BOTH sql and addColumnIfMissing with the in-memory engine — migrateAdmin
// imports addColumnIfMissing from the barrel, and the real one would reach the
// production no-op shim instead of mockDb.
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
import { normalizeAdminTask } from '../../todo/aggregateTodos';

function dropAll(): void {
  const t = mockDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
  for (const r of t) mockDb.prepare(`DROP TABLE IF EXISTS ${r.name}`).run();
}

beforeEach(async () => {
  dropAll();
  _resetAdminMigration?.();
  await migrateAdmin();
});

it('round-trips a due date through tasks.add → list', async () => {
  await tasks.add({ kind: 'task', text: 'pay rent', data: { kind: 'task' }, dueDate: '2026-07-01' });
  const rows = await tasks.list();
  expect(rows).toHaveLength(1);
  expect(rows[0].dueDate).toBe('2026-07-01');
});

it('a dateless task stores null (no regression)', async () => {
  await tasks.add({ kind: 'task', text: 'someday thing', data: { kind: 'task' } });
  const rows = await tasks.list();
  expect(rows[0].dueDate).toBeNull();
});

it('a dated generic task surfaces with a `date` on the /todo aggregate', async () => {
  await tasks.add({ kind: 'task', text: 'renew gym', data: { kind: 'task' }, dueDate: '2026-06-20' });
  const [row] = await tasks.list();
  const todo = normalizeAdminTask(row);
  expect(todo?.date).toBe('2026-06-20');
});

it('a phone task can carry a due date too', async () => {
  await tasks.add({ kind: 'phone', text: 'dentist', data: { kind: 'phone' }, dueDate: '2026-06-15' });
  const [row] = await tasks.list();
  expect(row.dueDate).toBe('2026-06-15');
  expect(normalizeAdminTask(row)?.date).toBe('2026-06-15');
});

it('upgrades a pre-#6 admin_tasks table (no due_date column) via the runner', async () => {
  dropAll();
  _resetAdminMigration?.();
  // legacy schema — no due_date column
  mockDb
    .prepare(
      `CREATE TABLE admin_tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, data TEXT, done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
    )
    .run();
  await migrateAdmin();
  const cols = (mockDb.prepare(`PRAGMA table_info(admin_tasks)`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  expect(cols).toContain('due_date');
  // and a write with a due date works after the upgrade
  await tasks.add({ kind: 'task', text: 'x', data: { kind: 'task' }, dueDate: '2026-08-01' });
  expect((await tasks.list())[0].dueDate).toBe('2026-08-01');
});
