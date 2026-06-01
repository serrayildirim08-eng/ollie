/**
 * Cycle repo · bleeding-intensity persistence test
 *
 * Proves the new per-day bleeding-intensity capture round-trips through
 * SQLite: setBleeding writes a `bleeding` event with the tag in `data`,
 * bleedingForDay reads today's tag back, and the per-day upsert keeps exactly
 * one tag per local day (re-tap replaces, doesn't stack).
 *
 * Backed by a real in-memory SQLite engine (node:sqlite), same shim shape the
 * habits bridge test uses.
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

import { migrateCycle } from './migrate';
import { cycleRepo } from './repo';

beforeEach(async () => {
  await migrateCycle();
  mockDb.exec('DELETE FROM cycle_events');
});

describe('cycle repo · bleeding intensity', () => {
  it('persists a bleeding tag and reads it back for the day', async () => {
    expect(await cycleRepo.bleedingForDay()).toBeNull();

    const ev = await cycleRepo.setBleeding('heavy');
    expect(ev.kind).toBe('bleeding');
    expect(ev.intensity).toBe('heavy');

    // round-trips out of SQLite (not just the returned object)
    expect(await cycleRepo.bleedingForDay()).toBe('heavy');

    // and surfaces in the kind-filtered list with the tag decoded from JSON
    const list = await cycleRepo.list('bleeding', 10);
    expect(list).toHaveLength(1);
    expect(list[0]!.intensity).toBe('heavy');
  });

  it('keeps exactly one tag per local day — re-tap replaces', async () => {
    await cycleRepo.setBleeding('light');
    await cycleRepo.setBleeding('medium');
    await cycleRepo.setBleeding('spotting');

    expect(await cycleRepo.bleedingForDay()).toBe('spotting');
    const list = await cycleRepo.list('bleeding', 10);
    expect(list).toHaveLength(1);
  });

  it('keeps separate tags on different days', async () => {
    const today = Date.now();
    const yesterday = today - 24 * 60 * 60 * 1000;

    await cycleRepo.setBleeding('brown', yesterday);
    await cycleRepo.setBleeding('clots', today);

    expect(await cycleRepo.bleedingForDay(yesterday)).toBe('brown');
    expect(await cycleRepo.bleedingForDay(today)).toBe('clots');
    const list = await cycleRepo.list('bleeding', 10);
    expect(list).toHaveLength(2);
  });
});
