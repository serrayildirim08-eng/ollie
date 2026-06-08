/**
 * Brain harm writer · integration test
 *
 * Backs the `sql` shim with a real in-memory SQLite engine, mocks the four
 * source repos (grocery / finance / admin / goals) with controlled world-
 * facts, then proves scanAndRecordHarm():
 *   - persists the detector's events into brain_harm_events
 *   - is idempotent (re-scan = no new rows, INSERT OR IGNORE on the PK)
 *   - mirrors a count into the store
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

const NOW = new Date('2026-06-08T12:00:00Z').getTime();
const DAY = 86_400_000;

// ── repo mocks: pure data, no real SQLite tables needed for the sources ──
vi.mock('../grocery/migrate', () => ({ migrateGrocery: async () => {} }));
vi.mock('../finance/migrate', () => ({ migrateFinance: async () => {} }));
vi.mock('../admin/migrate', () => ({ migrateAdmin: async () => {} }));
vi.mock('../goals/migrate', () => ({ migrateGoals: async () => {} }));

vi.mock('../grocery/repo', () => ({
  pantry: {
    async listActive() {
      return [
        { id: 'p1', name: 'milk', predictedOutAtMs: NOW - 2 * DAY }, // spoiled
        { id: 'p2', name: 'salt', predictedOutAtMs: NOW + 30 * DAY }, // fresh
      ];
    },
  },
}));
vi.mock('../finance/repo', () => ({
  bills: {
    async list() {
      return [
        { id: 'b1', merchant: 'netflix', cadence: 'monthly', addedAt: NOW - 45 * DAY }, // late
        { id: 'b2', merchant: 'rent', cadence: 'monthly', addedAt: NOW - 5 * DAY }, // ok
      ];
    },
  },
}));
vi.mock('../admin/repo', () => ({
  renewals: {
    async list() {
      return [{ id: 'r1', dueDate: '2000-01-01' }]; // missed
    },
  },
}));
vi.mock('../goals/repo', () => ({
  goals: {
    async list() {
      return [{ id: 'g1', targetDate: NOW + 90 * DAY }]; // not yet due
    },
  },
}));

import { createStore, createMemoryAdapter } from '@ollie/store';
import { scanAndRecordHarm, countHarmEvents } from './harm';
import { migrateBrain } from './migrate';

beforeEach(async () => {
  await migrateBrain();
  mockDb.exec('DELETE FROM brain_harm_events');
});

describe('scanAndRecordHarm', () => {
  it('detects + persists spoiled / late / missed harm and skips healthy rows', async () => {
    const store = createStore(createMemoryAdapter());
    const written = await scanAndRecordHarm(store, NOW);
    expect(written).toBe(3);

    const rows = mockDb
      .prepare(`SELECT id, harm_kind FROM brain_harm_events ORDER BY id`)
      .all() as Array<{ id: string; harm_kind: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('spoiled:pantry:p1');
    expect(ids).toContain('late:bill:b1');
    expect(ids).toContain('missed:renewal:r1');
    // fresh salt, ok rent, future goal → no harm
    expect(rows).toHaveLength(3);

    expect(store.get('brain', 'harmEventCount', 0)).toBe(3);
  });

  it('is idempotent — re-scanning the same lapses writes no new rows', async () => {
    const store = createStore(createMemoryAdapter());
    expect(await scanAndRecordHarm(store, NOW)).toBe(3);
    expect(await scanAndRecordHarm(store, NOW + DAY)).toBe(0);
    expect(await countHarmEvents()).toBe(3);
  });
});
