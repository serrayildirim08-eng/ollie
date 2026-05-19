/**
 * cycle-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `cycle.*` slices into the v2 view-models. These tests verify the
 * bridge, including the cold-start branch the v2 face depends on for its
 * two states. Mirrors money-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import type { CycleItem } from '@ollie/logic/cycle';
import {
  fmtDate,
  fmtWeekday,
  dateKey,
  faceVM,
  pillVM,
  historyVM,
  flagsVM,
  flagSummary,
  composeAskNote,
  PILL_BACKDATE_LIMIT,
  type CycleSlices,
} from './selectors';
import { DEFAULT_CYCLE_SETTINGS } from './useCycleSlices';

const NOW = new Date('2026-05-18T12:00:00Z').getTime();
const DAY = 86_400_000;

function emptySlices(): CycleSlices {
  return {
    items: [],
    settings: { ...DEFAULT_CYCLE_SETTINGS },
    birthControlEnabled: false,
    lastEditedByCycle: {},
    asks: [],
  };
}

/** a period-start marker `daysAgo` before NOW */
function started(daysAgo: number): CycleItem {
  return { ts: NOW - daysAgo * DAY, action: 'started' };
}

/** a pill log `daysAgo` before NOW */
function pill(daysAgo: number): CycleItem {
  return { ts: NOW - daysAgo * DAY, action: 'pill' };
}

describe('format helpers', () => {
  it('fmtDate renders a lowercase month + day', () => {
    expect(fmtDate(NOW)).toBe('may 18');
  });
  it('fmtWeekday renders a 3-letter weekday', () => {
    expect(fmtWeekday(NOW)).toMatch(/^(sun|mon|tue|wed|thu|fri|sat)$/);
  });
  it('dateKey renders a local YYYY-MM-DD', () => {
    expect(dateKey(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('faceVM', () => {
  it('cold-start with no data — no prediction, ring still scales', () => {
    const vm = faceVM(emptySlices(), NOW);
    expect(vm.hasData).toBe(false);
    expect(vm.coldStart).toBe(true);
    expect(vm.prediction).toBeNull();
    expect(vm.ringLength).toBeGreaterThanOrEqual(21);
    expect(vm.cyclesLogged).toBe(0);
    expect(vm.confidenceFill).toBe(0);
  });

  it('a single period start reads as data but stays cold-start', () => {
    const slices = emptySlices();
    slices.items = [started(3)];
    const vm = faceVM(slices, NOW);
    expect(vm.hasData).toBe(true);
    expect(vm.coldStart).toBe(true);
    expect(vm.day).toBe(4); // day 1 is the start day
  });

  it('two closed cycles clear cold-start and warm a prediction', () => {
    const slices = emptySlices();
    // three starts → two closed cycles of ~28d
    slices.items = [started(56), started(28), started(0)];
    const vm = faceVM(slices, NOW);
    expect(vm.coldStart).toBe(false);
    expect(vm.cyclesLogged).toBe(2);
    expect(vm.prediction).not.toBeNull();
    expect(vm.confidenceFill).toBeGreaterThan(0);
  });
});

describe('pillVM', () => {
  it('empty — a 7-day strip, nothing logged', () => {
    const vm = pillVM(emptySlices(), NOW);
    expect(vm.strip).toHaveLength(7);
    expect(vm.todayLogged).toBe(false);
    expect(vm.totalLogged).toBe(0);
    // today is the last cell, oldest first
    expect(vm.strip[6].isToday).toBe(true);
    expect(vm.strip[0].isToday).toBe(false);
  });

  it('today logged flips todayLogged and totals', () => {
    const slices = emptySlices();
    slices.items = [pill(0), pill(1)];
    const vm = pillVM(slices, NOW);
    expect(vm.todayLogged).toBe(true);
    expect(vm.totalLogged).toBe(2);
    expect(vm.strip[6].logged).toBe(true);
  });

  it('back-date reach covers the last 3 days only', () => {
    const vm = pillVM(emptySlices(), NOW);
    const backdateable = vm.strip.filter((d) => d.backdateable);
    expect(backdateable).toHaveLength(PILL_BACKDATE_LIMIT);
  });
});

describe('historyVM', () => {
  it('no closed cycle → hasClosed false', () => {
    const vm = historyVM(emptySlices());
    expect(vm.hasClosed).toBe(false);
    expect(vm.meanDays).toBeNull();
    expect(vm.cycles).toEqual([]);
  });

  it('closed cycles report a mean and bar rows', () => {
    const slices = emptySlices();
    slices.items = [started(84), started(56), started(28), started(0)];
    const vm = historyVM(slices);
    expect(vm.hasClosed).toBe(true);
    expect(vm.meanDays).toBeGreaterThan(0);
    expect(vm.cycles.length).toBeGreaterThan(0);
    // every bar fill sits in the 0.32..1 visible band
    for (const c of vm.cycles) {
      expect(c.fill).toBeGreaterThanOrEqual(0.32);
      expect(c.fill).toBeLessThanOrEqual(1);
    }
  });
});

describe('flagsVM / flagSummary', () => {
  it('no data → no flags, no summary line', () => {
    expect(flagsVM(emptySlices(), NOW).flags).toEqual([]);
    expect(flagSummary(emptySlices(), NOW)).toBeNull();
  });
});

describe('composeAskNote', () => {
  it('empty picks → the calm placeholder', () => {
    expect(composeAskNote([])).toContain('pick a few things');
  });
  it('picks compose into one low-energy-day sentence', () => {
    const note = composeAskNote(['a heat pad', 'a hug']);
    expect(note).toContain('low-energy day');
    expect(note).toContain('a heat pad');
    expect(note).toContain('a hug');
  });
});
