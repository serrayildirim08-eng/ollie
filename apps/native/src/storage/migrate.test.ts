/**
 * SQLite migration runner tests (audit #3).
 *
 * Backs the `sql` wrapper with a real in-memory SQLite engine (node:sqlite),
 * mirroring the module repo tests, so the runner's actual SQL executes.
 *
 * Covers: fresh DB applies all migrations in order; re-run is a no-op
 * (idempotent); a failing migration aborts + is NOT recorded, and a later
 * re-run resumes from it; addColumnIfMissing is safe on present + absent cols.
 */

import { createRequire } from 'node:module';
import { beforeEach, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const mockDb = new DatabaseSync(':memory:');

vi.mock('./sqlite', () => ({
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

import { runMigrations, addColumnIfMissing, appliedMigrations } from './migrate';

function tableCols(table: string): string[] {
  return (mockDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

beforeEach(() => {
  // Wipe everything between tests for a true "fresh DB".
  const tables = mockDb
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all() as Array<{ name: string }>;
  for (const t of tables) mockDb.prepare(`DROP TABLE IF EXISTS ${t.name}`).run();
});

it('fresh DB: applies all migrations in order and records them', async () => {
  const order: string[] = [];
  await runMigrations([
    {
      name: 'test:0001_create_widgets',
      up: async () => {
        order.push('a');
        mockDb.prepare(`CREATE TABLE widgets (id TEXT PRIMARY KEY)`).run();
      },
    },
    {
      name: 'test:0002_add_color',
      up: async () => {
        order.push('b');
        await addColumnIfMissing('widgets', 'color', 'color TEXT');
      },
    },
  ]);

  expect(order).toEqual(['a', 'b']); // order preserved
  expect(tableCols('widgets')).toContain('color');
  expect(await appliedMigrations()).toEqual(['test:0001_create_widgets', 'test:0002_add_color']);
});

it('re-run is a no-op: already-applied migrations do not run again', async () => {
  const up = vi.fn(async () => {
    mockDb.prepare(`CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY)`).run();
  });
  const migs = [{ name: 'test:0001_create_widgets', up }];

  await runMigrations(migs);
  await runMigrations(migs); // second pass

  expect(up).toHaveBeenCalledTimes(1);
  expect(await appliedMigrations()).toEqual(['test:0001_create_widgets']);
});

it('a failing migration aborts, is not recorded, and a re-run resumes from it', async () => {
  let firstAttempt = true;
  const migs = [
    {
      name: 'test:0001_ok',
      up: async () => {
        mockDb.prepare(`CREATE TABLE IF NOT EXISTS t1 (id TEXT)`).run();
      },
    },
    {
      name: 'test:0002_flaky',
      up: async () => {
        if (firstAttempt) {
          firstAttempt = false;
          throw new Error('boom');
        }
        mockDb.prepare(`CREATE TABLE IF NOT EXISTS t2 (id TEXT)`).run();
      },
    },
  ];

  await expect(runMigrations(migs)).rejects.toThrow('boom');
  // only the first migration recorded; the failed one is not
  expect(await appliedMigrations()).toEqual(['test:0001_ok']);

  // re-run resumes at the failed migration and completes it
  await runMigrations(migs);
  expect(await appliedMigrations()).toEqual(['test:0001_ok', 'test:0002_flaky']);
  expect(tableCols('t2')).toContain('id');
});

it('addColumnIfMissing is idempotent: adds once, no-op when present', async () => {
  mockDb.prepare(`CREATE TABLE box (id TEXT PRIMARY KEY)`).run();

  await addColumnIfMissing('box', 'due_date', 'due_date TEXT');
  expect(tableCols('box')).toContain('due_date');

  // second call must not throw "duplicate column"
  await expect(addColumnIfMissing('box', 'due_date', 'due_date TEXT')).resolves.toBeUndefined();
  expect(tableCols('box').filter((c) => c === 'due_date')).toHaveLength(1);
});
