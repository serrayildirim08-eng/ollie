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
function makeSleepEvents(): Array<{
  id: string;
  kind: 'sleep';
  occurredAt: number;
  data: { bedtime: string | null; wake: string | null; quality: 1 | 2 | 3 | 4 | 5 | null; hoursSlept: number | null };
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
