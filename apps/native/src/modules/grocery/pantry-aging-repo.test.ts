/**
 * Grocery · pantry aging repository tests.
 *
 * Exercises the new column + helpers added 2026-05-30:
 *   - archived_at_ms defaults to NULL on insert
 *   - touch() refreshes added_at + clears archive
 *   - archive() / unarchive() round-trip
 *   - listActive() vs listArchived() partition
 *   - add() with an explicit nowMs (test injection) is honored
 *   - re-adding an archived item resurfaces it (clears archived_at_ms)
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

import { migrateGrocery } from './migrate';
import { pantry } from './repo';

beforeEach(async () => {
  await migrateGrocery();
  mockDb.exec('DELETE FROM grocery_pantry');
  mockDb.exec('DELETE FROM grocery_shopping');
  mockDb.exec('DELETE FROM grocery_purchase_log');
  mockDb.exec('DELETE FROM grocery_cook_history');
});

describe('pantry · archived_at_ms column + helpers', () => {
  it('inserts new rows with archivedAtMs === null', async () => {
    const it1 = await pantry.add({ name: 'milk', quantity: 1, unit: 'liter' });
    expect(it1.archivedAtMs).toBeNull();
    const live = await pantry.list();
    expect(live).toHaveLength(1);
    expect(live[0]!.archivedAtMs).toBeNull();
  });

  it('accepts an explicit nowMs for test injection on add', async () => {
    const t = 1_700_000_000_000;
    const it1 = await pantry.add({ name: 'eggs', nowMs: t });
    expect(it1.addedAt).toBe(t);
  });

  it('archive() moves the row out of listActive() into listArchived()', async () => {
    const it1 = await pantry.add({ name: 'lettuce' });
    await pantry.archive(it1.id, 1_700_000_000_001);

    const active = await pantry.listActive();
    expect(active.map((r) => r.id)).not.toContain(it1.id);

    const archived = await pantry.listArchived();
    expect(archived).toHaveLength(1);
    expect(archived[0]!.id).toBe(it1.id);
    expect(archived[0]!.archivedAtMs).toBe(1_700_000_000_001);
  });

  it('unarchive() restores the row + resets the aging clock', async () => {
    const it1 = await pantry.add({ name: 'rice', nowMs: 1_000 });
    await pantry.archive(it1.id, 2_000);
    await pantry.unarchive(it1.id, 9_000);

    const archived = await pantry.listArchived();
    expect(archived).toHaveLength(0);

    const active = await pantry.list();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(it1.id);
    expect(active[0]!.archivedAtMs).toBeNull();
    expect(active[0]!.addedAt).toBe(9_000);
  });

  it('touch() refreshes added_at without changing archive state', async () => {
    const it1 = await pantry.add({ name: 'yoghurt', nowMs: 1_000 });
    await pantry.touch(it1.id, 5_000);
    const active = await pantry.list();
    expect(active[0]!.addedAt).toBe(5_000);
    expect(active[0]!.archivedAtMs).toBeNull();
  });

  it('re-adding an archived item resurfaces it (clears archive flag)', async () => {
    const it1 = await pantry.add({ name: 'butter', nowMs: 1_000 });
    await pantry.archive(it1.id, 2_000);
    expect(await pantry.listArchived()).toHaveLength(1);

    // The user just bought butter again — should come back to the active list.
    const re = await pantry.add({ name: 'butter', nowMs: 10_000 });
    expect(re.id).toBe(it1.id); // same row (dedupe by name)
    expect(re.archivedAtMs).toBeNull();
    expect(re.addedAt).toBe(10_000);
    expect(await pantry.listArchived()).toHaveLength(0);
    expect(await pantry.listActive()).toHaveLength(1);
  });

  it('listActive() ignores archived rows when sorting by added_at DESC', async () => {
    const a = await pantry.add({ name: 'apples', nowMs: 1_000 });
    const b = await pantry.add({ name: 'bananas', nowMs: 2_000 });
    const c = await pantry.add({ name: 'cherries', nowMs: 3_000 });
    await pantry.archive(b.id, 4_000);
    const active = await pantry.list();
    expect(active.map((r) => r.name)).toEqual(['cherries', 'apples']);
    expect(active.map((r) => r.id)).not.toContain(b.id);
    const _used = c.id; // satisfy unused-binding
    expect(_used).toBe(c.id);
    expect(a.id).toBeTruthy();
  });
});
