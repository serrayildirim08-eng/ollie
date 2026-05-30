/**
 * Grocery · pantry replenishment-column repo tests.
 *
 * Exercises the columns + helpers added 2026-05-30 for Plan B opt-in push:
 *   - remind_me / predicted_out_at_ms / pushed_at_ms columns default sanely
 *   - pantry.add() seeds remind_me=1 for critical canonicals and 0 otherwise
 *   - pantry.add() resets pushed_at_ms on cycle restart (re-purchase)
 *   - setRemindMe() flips the flag
 *   - setPredictedOut() updates the prediction AND clears pushed_at_ms
 *   - markPushed() records the timestamp
 *   - dismissPrediction() bumps the prediction forward by 7 days + clears
 *     pushed_at_ms (cadence-bump-lite)
 *   - listPredictedOut() returns rows whose prediction has passed
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

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await migrateGrocery();
  mockDb.exec('DELETE FROM grocery_pantry');
  mockDb.exec('DELETE FROM grocery_shopping');
  mockDb.exec('DELETE FROM grocery_purchase_log');
  mockDb.exec('DELETE FROM grocery_cook_history');
});

describe('pantry.add · seeds remind_me from criticality', () => {
  it('milk → remind_me=false (non-critical)', async () => {
    const row = await pantry.add({ name: 'milk' });
    expect(row.remindMe).toBe(false);
    expect(row.predictedOutAtMs).toBeNull();
    expect(row.pushedAtMs).toBeNull();
  });

  it('tampons → remind_me=true (explicit critical set)', async () => {
    const row = await pantry.add({ name: 'tampons' });
    expect(row.remindMe).toBe(true);
  });

  it('vitamin c → remind_me=true (wellness category)', async () => {
    const row = await pantry.add({ name: 'vitamin c' });
    expect(row.remindMe).toBe(true);
  });

  it('cat litter → remind_me=true (pet category)', async () => {
    const row = await pantry.add({ name: 'cat litter' });
    expect(row.remindMe).toBe(true);
  });

  it('explicit remindMe override wins over the gate', async () => {
    // user opts INTO milk reminders manually
    const milk = await pantry.add({ name: 'milk', remindMe: true });
    expect(milk.remindMe).toBe(true);

    // user opts OUT of tampons reminders manually
    const tampons = await pantry.add({ name: 'tampons', remindMe: false });
    expect(tampons.remindMe).toBe(false);
  });
});

describe('pantry.add · cycle restart (re-purchase) resets pushed_at_ms', () => {
  it('re-adding an item clears pushed_at_ms but preserves remind_me', async () => {
    const t0 = 1_700_000_000_000;
    const first = await pantry.add({ name: 'vitamin c', nowMs: t0 });
    expect(first.remindMe).toBe(true);

    // simulate predict + push fire
    await pantry.setPredictedOut(first.id, t0 + 7 * DAY_MS);
    await pantry.markPushed(first.id, t0 + 6 * DAY_MS);

    // user buys vitamin c again (cycle restart) — pushed_at_ms must clear
    const t1 = t0 + 14 * DAY_MS;
    const second = await pantry.add({ name: 'vitamin c', nowMs: t1 });
    expect(second.id).toBe(first.id); // same row
    expect(second.remindMe).toBe(true); // preserved
    expect(second.pushedAtMs).toBeNull(); // cleared by cycle restart
  });
});

describe('pantry.setRemindMe', () => {
  it('flips the flag in both directions', async () => {
    const row = await pantry.add({ name: 'milk' });
    expect(row.remindMe).toBe(false);

    await pantry.setRemindMe(row.id, true);
    const after = await pantry.list();
    expect(after.find((r) => r.id === row.id)?.remindMe).toBe(true);

    await pantry.setRemindMe(row.id, false);
    const after2 = await pantry.list();
    expect(after2.find((r) => r.id === row.id)?.remindMe).toBe(false);
  });
});

describe('pantry.setPredictedOut', () => {
  it('writes the prediction and clears pushed_at_ms', async () => {
    const row = await pantry.add({ name: 'milk' });
    const t = 1_800_000_000_000;
    await pantry.markPushed(row.id, t - DAY_MS);

    await pantry.setPredictedOut(row.id, t);
    const after = await pantry.list();
    const r = after.find((x) => x.id === row.id);
    expect(r?.predictedOutAtMs).toBe(t);
    expect(r?.pushedAtMs).toBeNull();
  });

  it('null prediction clears the column + clears pushed_at_ms', async () => {
    const row = await pantry.add({ name: 'milk' });
    await pantry.setPredictedOut(row.id, 1_800_000_000_000);
    await pantry.setPredictedOut(row.id, null);
    const after = await pantry.list();
    const r = after.find((x) => x.id === row.id);
    expect(r?.predictedOutAtMs).toBeNull();
    expect(r?.pushedAtMs).toBeNull();
  });
});

describe('pantry.markPushed', () => {
  it('records the timestamp', async () => {
    const row = await pantry.add({ name: 'tampons' });
    await pantry.setPredictedOut(row.id, 1_800_000_000_000);

    await pantry.markPushed(row.id, 1_799_999_000_000);
    const after = await pantry.list();
    expect(after.find((r) => r.id === row.id)?.pushedAtMs).toBe(1_799_999_000_000);
  });

  it('defaults nowMs to Date.now when omitted', async () => {
    const row = await pantry.add({ name: 'tampons' });
    const before = Date.now();
    await pantry.markPushed(row.id);
    const after = Date.now();
    const list = await pantry.list();
    const stored = list.find((r) => r.id === row.id)?.pushedAtMs;
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored!).toBeLessThanOrEqual(after);
  });
});

describe('pantry.dismissPrediction · cadence bump (v1: +7 days)', () => {
  it('bumps the prediction forward by 7 days from nowMs', async () => {
    const row = await pantry.add({ name: 'milk' });
    const t0 = 1_700_000_000_000;
    await pantry.setPredictedOut(row.id, t0);

    await pantry.dismissPrediction(row.id, t0);

    const after = await pantry.list();
    expect(after.find((r) => r.id === row.id)?.predictedOutAtMs).toBe(t0 + 7 * DAY_MS);
  });

  it('clears pushed_at_ms so the bumped prediction can fire fresh', async () => {
    const row = await pantry.add({ name: 'tampons' });
    const t0 = 1_700_000_000_000;
    await pantry.setPredictedOut(row.id, t0);
    await pantry.markPushed(row.id, t0 - DAY_MS);

    await pantry.dismissPrediction(row.id, t0);
    const after = await pantry.list();
    expect(after.find((r) => r.id === row.id)?.pushedAtMs).toBeNull();
  });
});

describe('pantry.listPredictedOut', () => {
  it('returns only rows with predicted_out_at_ms <= now AND not archived', async () => {
    const t = 1_800_000_000_000;
    const milk = await pantry.add({ name: 'milk' });
    const eggs = await pantry.add({ name: 'egg' });
    // bread inserted with no prediction — must be excluded from the result.
    await pantry.add({ name: 'bread' });
    const archived = await pantry.add({ name: 'lettuce' });

    // milk predicted out yesterday, eggs predicted out tomorrow,
    // bread no prediction, lettuce predicted out but archived.
    await pantry.setPredictedOut(milk.id, t - DAY_MS);
    await pantry.setPredictedOut(eggs.id, t + DAY_MS);
    await pantry.setPredictedOut(archived.id, t - DAY_MS);
    await pantry.archive(archived.id, t);

    const out = await pantry.listPredictedOut(t);
    const names = out.map((r) => r.name);
    expect(names).toContain('milk');
    expect(names).not.toContain('egg');
    expect(names).not.toContain('bread');
    expect(names).not.toContain('lettuce');
  });

  it('sorts by predicted_out_at_ms ASC (oldest miss first)', async () => {
    const t = 1_800_000_000_000;
    const a = await pantry.add({ name: 'milk' });
    const b = await pantry.add({ name: 'egg' });
    const c = await pantry.add({ name: 'bread' });

    await pantry.setPredictedOut(a.id, t - DAY_MS);
    await pantry.setPredictedOut(b.id, t - 5 * DAY_MS);
    await pantry.setPredictedOut(c.id, t - 2 * DAY_MS);

    const out = await pantry.listPredictedOut(t);
    expect(out.map((r) => r.name)).toEqual(['egg', 'bread', 'milk']);
  });
});

describe('pantry.list / listActive · returns new columns', () => {
  it('all three new fields are populated correctly', async () => {
    const row = await pantry.add({ name: 'tampons' });
    await pantry.setPredictedOut(row.id, 1_900_000_000_000);
    await pantry.markPushed(row.id, 1_899_999_000_000);

    const live = await pantry.list();
    const stored = live.find((r) => r.id === row.id);
    expect(stored?.remindMe).toBe(true);
    expect(stored?.predictedOutAtMs).toBe(1_900_000_000_000);
    expect(stored?.pushedAtMs).toBe(1_899_999_000_000);
  });
});
