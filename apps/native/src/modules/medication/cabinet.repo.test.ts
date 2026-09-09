/**
 * Medication cabinet · repo tests (real in-memory SQLite).
 *
 * Exercises:
 *   - upsert dedupes by normalised name + derives purpose from the name
 *   - upsert preserves existing dose/qty on a bare re-add (no wipe)
 *   - setLowByName creates the row when not stocked + toggles the flag
 *   - decrementOnTaken counts down a known qty + no-ops on manual-only items
 *   - addScheduleSlots merges slots into the registry (today-tab link)
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

import { migrateMedication } from './migrate';
import { cabinet, medications } from './repo';

beforeEach(async () => {
  await migrateMedication();
  mockDb.exec('DELETE FROM medication_cabinet');
  mockDb.exec('DELETE FROM medications_registry');
  mockDb.exec('DELETE FROM medications_events');
});

describe('cabinet.upsert', () => {
  it('dedupes by normalised name + derives purpose from the name', async () => {
    await cabinet.upsert({ name: 'Magnesium' });
    await cabinet.upsert({ name: 'magnesium' });
    const list = await cabinet.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('magnesium');
    expect(list[0]!.purpose).toBe('sleep');
  });

  it('honours an explicit purpose over the derived one', async () => {
    const item = await cabinet.upsert({ name: 'mystery', purpose: 'mood' });
    expect(item.purpose).toBe('mood');
  });

  it('stores dose + qty when given', async () => {
    const item = await cabinet.upsert({ name: 'vitamin d', doseLabel: '2000 IU', qty: 60 });
    expect(item.doseLabel).toBe('2000 IU');
    expect(item.qty).toBe(60);
    expect(item.purpose).toBe('vitamins');
  });

  it('a bare re-add does NOT wipe existing dose/qty', async () => {
    await cabinet.upsert({ name: 'melatonin', doseLabel: '3mg', qty: 20 });
    await cabinet.upsert({ name: 'melatonin' }); // bare re-add
    const item = await cabinet.findByName('melatonin');
    expect(item?.doseLabel).toBe('3mg');
    expect(item?.qty).toBe(20);
  });
});

describe('cabinet.setLowByName', () => {
  it('creates the row when not stocked, then flags low', async () => {
    const item = await cabinet.setLowByName('vitamin d', true);
    expect(item.lowFlag).toBe(true);
    const fetched = await cabinet.findByName('vitamin d');
    expect(fetched?.lowFlag).toBe(true);
    expect(fetched?.purpose).toBe('vitamins');
  });

  it('clears the flag with false (set_have)', async () => {
    await cabinet.setLowByName('vitamin d', true);
    await cabinet.setLowByName('vitamin d', false);
    const fetched = await cabinet.findByName('vitamin d');
    expect(fetched?.lowFlag).toBe(false);
  });

  it('flagging low twice is idempotent (one row, still low)', async () => {
    await cabinet.setLowByName('magnesium', true);
    await cabinet.setLowByName('magnesium', true);
    const list = await cabinet.list();
    expect(list.filter((i) => i.name === 'magnesium')).toHaveLength(1);
    expect(list[0]!.lowFlag).toBe(true);
  });
});

describe('cabinet.decrementOnTaken', () => {
  it('counts down a known qty', async () => {
    await cabinet.upsert({ name: 'magnesium', qty: 5 });
    const next = await cabinet.decrementOnTaken('magnesium');
    expect(next).toBe(4);
    expect((await cabinet.findByName('magnesium'))?.qty).toBe(4);
  });

  it('no-ops (null) on a manual-only item with no qty', async () => {
    await cabinet.upsert({ name: 'melatonin' });
    const next = await cabinet.decrementOnTaken('melatonin');
    expect(next).toBeNull();
    expect((await cabinet.findByName('melatonin'))?.qty).toBeNull();
  });

  it('no-ops on an unstocked med', async () => {
    expect(await cabinet.decrementOnTaken('ghost')).toBeNull();
  });
});

describe('medications.addScheduleSlots', () => {
  it('merges slots into the registry, deduped + sorted', async () => {
    await medications.addScheduleSlots('magnesium', ['21:00']);
    await medications.addScheduleSlots('magnesium', ['09:00', '21:00']);
    const med = await medications.findByName('magnesium');
    expect(med?.schedule).toEqual(['09:00', '21:00']);
  });
});
