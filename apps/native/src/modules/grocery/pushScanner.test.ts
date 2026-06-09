/**
 * pushScanner.test.ts — integration of pushTrigger gate + dispatch + mark.
 *
 * Pure-fake injection (no DOM, no SQLite) — the scanner is a thin loop and
 * its contract is "for each row that passes the gate, fire dispatch + mark".
 */

import { describe, it, expect, vi } from 'vitest';
import { scanPantryPushes } from './pushScanner';
import type { PantryItem } from './types';
import { PUSH_TRIGGER_DAY_MS, PUSH_TRIGGER_HOUR_MS } from './pushTrigger';

const DAY = PUSH_TRIGGER_DAY_MS;
const HOUR = PUSH_TRIGGER_HOUR_MS;
const TS = 1_700_000_000_000;

function row(overrides: Partial<PantryItem>): PantryItem {
  return {
    id: 'r1',
    name: 'milk',
    quantity: null,
    unit: null,
    addedAt: TS - 7 * DAY,
    lowFlag: false,
    archivedAtMs: null,
    predictedOutAtMs: TS,
    remindMe: true,
    pushedAtMs: null,
    ...overrides,
  };
}

describe('scanPantryPushes', () => {
  it('fires + marks for one matching row', async () => {
    const dispatch = vi.fn();
    const mark = vi.fn(async () => {});
    const now = TS - 12 * HOUR;

    const res = await scanPantryPushes({
      source: async () => [row({})],
      dispatch,
      mark,
      nowMs: now,
      localHourOf: () => 10,
    });

    expect(res.fired).toEqual(['milk']);
    expect(res.scanned).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      title: 'might be out of milk',
      body: 'tomorrow',
    });
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith('r1', now);
  });

  it('skips blocked rows (remind_me false, no prediction, quiet hours)', async () => {
    const dispatch = vi.fn();
    const mark = vi.fn(async () => {});
    const now = TS - 12 * HOUR;

    const res = await scanPantryPushes({
      source: async () => [
        row({ id: 'a', name: 'milk', remindMe: false }),
        row({ id: 'b', name: 'eggs', predictedOutAtMs: null }),
        row({ id: 'c', name: 'tampons', pushedAtMs: now - HOUR }),
        row({ id: 'd', name: 'vitamin c' }), // would fire if not for quiet hours
      ],
      dispatch,
      mark,
      nowMs: now,
      localHourOf: () => 3, // deep quiet
    });

    expect(res.fired).toEqual([]);
    expect(res.scanned).toBe(4);
    expect(dispatch).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });

  it('fires for multiple matching rows in one scan', async () => {
    const dispatch = vi.fn();
    const mark = vi.fn(async () => {});
    const now = TS - 12 * HOUR;

    const res = await scanPantryPushes({
      source: async () => [
        row({ id: 'a', name: 'tampons' }),
        row({ id: 'b', name: 'vitamin c' }),
        row({ id: 'c', name: 'milk', remindMe: false }), // gated out
      ],
      dispatch,
      mark,
      nowMs: now,
      localHourOf: () => 10,
    });

    expect(res.fired).toEqual(['tampons', 'vitamin c']);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(mark).toHaveBeenCalledTimes(2);
  });

  it('source error → empty fired, no throw', async () => {
    const dispatch = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await scanPantryPushes({
      source: async () => {
        throw new Error('db boom');
      },
      dispatch,
      nowMs: TS - 12 * HOUR,
      localHourOf: () => 10,
    });

    expect(res.fired).toEqual([]);
    expect(res.scanned).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('mark error after dispatch is logged, not fatal — scan continues', async () => {
    const dispatch = vi.fn();
    const mark = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('write boom');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await scanPantryPushes({
      source: async () => [
        row({ id: 'a', name: 'tampons' }),
        row({ id: 'b', name: 'vitamin c' }),
      ],
      dispatch,
      mark,
      nowMs: TS - 12 * HOUR,
      localHourOf: () => 10,
    });

    // a was dispatched + mark threw → not in fired; b succeeded.
    expect(res.fired).toEqual(['vitamin c']);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('dispatch error → row skipped, mark not called, no throw', async () => {
    const dispatch = vi.fn(() => {
      throw new Error('dispatch boom');
    });
    const mark = vi.fn(async () => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await scanPantryPushes({
      source: async () => [row({})],
      dispatch,
      mark,
      nowMs: TS - 12 * HOUR,
      localHourOf: () => 10,
    });

    expect(res.fired).toEqual([]);
    expect(mark).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
