/**
 * Sleep module · bridge (SQLite → @ollie/store) test
 *
 * Proves the great-rewiring end to end for sleep: mirrored SQLite `sleep`
 * rows → syncToStore writes `sleep.records` → the real sleep orchestrator
 * recomputes → the weekday/weekend-gap watcher fires a pattern card.
 *
 * weekend_recovery_illusion was chosen because it depends ONLY on the fields
 * the native capture actually stores (night_of + tst_min), so it isolates the
 * bridge: if it fires, the SQLite→store mirror is correct.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createSleepOrchestrator } from '@ollie/orchestrator';

// ─── mocks (must precede imports of the unit under test) ───────────────────────

vi.mock('./migrate', () => ({
  migrateSleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  sleepRepo: {
    listByKind: vi.fn(),
  },
}));

import { sleepRepo } from './repo';
import { syncToStore } from './bridge';

const mockListByKind = vi.mocked(sleepRepo.listByKind);

const DAY_MS = 86_400_000;
// A Wednesday noon — gives a clean run of weekday/weekend nights behind it.
const FIXED_NOW = new Date('2026-05-13T12:00:00').getTime();

/**
 * Build 28 consecutive nightly SQLite 'sleep' events ending yesterday.
 * Weekend nights (Fri/Sat) sleep 8h; weekdays sleep 5h — a clear gap so
 * detectWeekendRecoveryIllusion fires (gap 180min ≥ 90, wdMean 300 < 390).
 */
type SleepFeel = 'rested' | 'wired' | 'foggy' | 'wrecked';

function makeSleepEvents(): Array<{
  id: string;
  kind: 'sleep';
  occurredAt: number;
  data: {
    bedtime: string | null;
    wake: string | null;
    quality: 1 | 2 | 3 | 4 | 5 | null;
    hoursSlept: number | null;
    feel: SleepFeel | null;
  };
}> {
  const out = [];
  for (let d = 28; d >= 1; d--) {
    const ts = FIXED_NOW - d * DAY_MS;
    const dow = new Date(ts).getDay(); // 0 sun … 6 sat
    const isWeekend = dow === 5 || dow === 6; // fri / sat
    const hours = isWeekend ? 8 : 5;
    out.push({
      id: `s_${d}`,
      kind: 'sleep' as const,
      occurredAt: ts,
      data: {
        bedtime: '23:00',
        wake: isWeekend ? '07:00' : '04:00',
        quality: 3 as const,
        hoursSlept: hours,
        // weekends rested, weekdays wrecked — a feel tag on every night.
        feel: (isWeekend ? 'rested' : 'wrecked') as SleepFeel,
      },
    });
  }
  // repo.listByKind returns newest-first.
  return out.reverse();
}

describe('sleep bridge → orchestrator (great rewiring)', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createSleepOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createSleepOrchestrator(store, { now: () => FIXED_NOW });
    mockListByKind.mockImplementation(async (kind: string) => {
      if (kind === 'sleep') return makeSleepEvents() as never;
      return [] as never;
    });
  });

  afterEach(() => {
    orch.teardown();
    vi.useRealTimers();
  });

  it('mirrors SQLite sleep rows into sleep.records', async () => {
    await syncToStore(store);
    const records = store.get<Array<{ night_of: string; tst_min: number }>>('sleep', 'records', []);
    expect(records.length).toBe(28);
    // oldest-first, well-formed night_of + tst_min derived from hoursSlept
    expect(records[0].night_of < records[27].night_of).toBe(true);
    expect(records.some((r) => r.tst_min === 300)).toBe(true); // weekday 5h
    expect(records.some((r) => r.tst_min === 480)).toBe(true); // weekend 8h
  });

  it('carries the feel tag into sleep.records (quality_text) + maps feel→quality fallback', async () => {
    await syncToStore(store);
    const records = store.get<
      Array<{ night_of: string; quality_text: string | null; quality: number | null; tokens: string[] }>
    >('sleep', 'records', []);
    // every mirrored night carries its feel tag in quality_text + tokens
    expect(records.every((r) => r.quality_text === 'rested' || r.quality_text === 'wrecked')).toBe(true);
    expect(records.some((r) => r.tokens.includes('rested'))).toBe(true);
    expect(records.some((r) => r.tokens.includes('wrecked'))).toBe(true);

    // explicit numeric quality (3) wins over the feel-derived fallback
    expect(records.every((r) => r.quality === 3)).toBe(true);
  });

  it('maps feel→quality when no numeric quality was set', async () => {
    // A single night with only a feel tag (quality null) → derived quality.
    mockListByKind.mockImplementation(async (kind: string) => {
      if (kind === 'sleep') {
        return [
          {
            id: 's_feelonly',
            kind: 'sleep' as const,
            occurredAt: FIXED_NOW - DAY_MS,
            data: { bedtime: null, wake: null, quality: null, hoursSlept: 7, feel: 'wrecked' as SleepFeel },
          },
        ] as never;
      }
      return [] as never;
    });
    await syncToStore(store);
    const records = store.get<Array<{ quality: number | null; quality_text: string | null }>>(
      'sleep',
      'records',
      [],
    );
    expect(records.length).toBe(1);
    expect(records[0].quality_text).toBe('wrecked');
    expect(records[0].quality).toBe(1); // wrecked → 1
  });

  it('the weekday/weekend-gap watcher fires once records are mirrored', async () => {
    // Before the bridge runs the watcher has nothing to chew on.
    orch.recomputeDerived();
    const before = store.get<Array<{ pattern: string }>>('sleep', 'patterns', []);
    expect(before.find((p) => p.pattern === 'weekend_recovery_illusion')).toBeUndefined();

    // Mirror SQLite → store, then recompute.
    await syncToStore(store);
    orch.recomputeDerived();

    const after = store.get<Array<{ pattern: string }>>('sleep', 'patterns', []);
    const gap = after.find((p) => p.pattern === 'weekend_recovery_illusion');
    expect(gap).toBeDefined();
  });
});
