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

/** Seed a period_start row at an exact timestamp (no public API for this). */
function seedPeriodStart(occurredAt: number): void {
  mockDb
    .prepare('INSERT INTO cycle_events (id, kind, data, occurred_at) VALUES (?, ?, ?, ?)')
    .run(`seed_${occurredAt}`, 'period_start', null, occurredAt);
}

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

describe('cycle repo · current() day counter (#136 DST/local-day)', () => {
  it('counts calendar days, not 24h blocks, across a local midnight', async () => {
    // period_start late on day D (23:30 local); "now" is just after midnight
    // on day D+1 (00:30 local) — only ~1h of wall-clock elapsed.
    const startLocal = new Date();
    startLocal.setHours(23, 30, 0, 0);
    const startedAt = startLocal.getTime();
    const nowLocal = new Date(startedAt);
    nowLocal.setDate(nowLocal.getDate() + 1);
    nowLocal.setHours(0, 30, 0, 0);

    seedPeriodStart(startedAt);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowLocal.getTime());
    try {
      const cur = await cycleRepo.current();
      // Absolute-ms / 86_400_000 would floor to 0 here (the old bug); a local
      // calendar-day diff correctly reports 1 — the next cycle day.
      expect(cur?.daysSinceStart).toBe(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('reports day 0 for a start earlier the same local day', async () => {
    const startLocal = new Date();
    startLocal.setHours(2, 0, 0, 0);
    const startedAt = startLocal.getTime();
    const nowLocal = new Date(startedAt);
    nowLocal.setHours(22, 0, 0, 0); // 20h later, same calendar day

    seedPeriodStart(startedAt);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowLocal.getTime());
    try {
      const cur = await cycleRepo.current();
      expect(cur?.daysSinceStart).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('cycle repo · pregnancy pause', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('round-trips isPregnant through setPregnant / endPregnancy', async () => {
    // not pregnant by default
    expect(await cycleRepo.isPregnant()).toBe(false);

    // declare → pregnant
    const start = await cycleRepo.setPregnant();
    expect(start.kind).toBe('pregnancy_start');
    expect(await cycleRepo.isPregnant()).toBe(true);

    // end (any path) → resumed
    const end = await cycleRepo.endPregnancy();
    expect(end.kind).toBe('pregnancy_end');
    expect(await cycleRepo.isPregnant()).toBe(false);

    // a second pregnancy pauses again
    await cycleRepo.setPregnant();
    expect(await cycleRepo.isPregnant()).toBe(true);
  });

  it('isPregnant(asOf) reflects state at a past instant, not just now', async () => {
    const now = Date.now();
    await cycleRepo.setPregnant(now - 200 * DAY); // pregnant 200d ago
    await cycleRepo.endPregnancy(now - 5 * DAY); // ended 5d ago

    // mid-pregnancy: pregnant
    expect(await cycleRepo.isPregnant(now - 100 * DAY)).toBe(true);
    // before it started: not pregnant
    expect(await cycleRepo.isPregnant(now - 300 * DAY)).toBe(false);
    // after it ended: not pregnant
    expect(await cycleRepo.isPregnant(now)).toBe(false);
  });
});
