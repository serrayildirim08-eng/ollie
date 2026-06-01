/**
 * Body module · bridge (SQLite → @ollie/store) test
 *
 * Proves the great-rewiring end to end for body: mirrored SQLite `water`
 * rows → syncToStore writes `body.water_log` → the real body orchestrator
 * recomputes → a hydration-drift watcher fires a pattern card.
 *
 * interoception_drift (hydration drift) was chosen because it depends ONLY on
 * water-log timestamps — the fields the native capture actually stores — so it
 * isolates the bridge: if it fires, the SQLite→store water mirror is correct.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createBodyOrchestrator } from '@ollie/orchestrator';

// ─── mocks (must precede imports of the unit under test) ───────────────────────

vi.mock('./migrate', () => ({
  migrateBody: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  events: {
    list: vi.fn(),
  },
  profile: {
    getAge: vi.fn(),
  },
}));

import { events as bodyEvents, profile as bodyProfile } from './repo';
import { syncToStore } from './bridge';

const mockList = vi.mocked(bodyEvents.list);
const mockGetAge = vi.mocked(bodyProfile.getAge);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FIXED_NOW = new Date('2026-05-13T12:00:00').getTime();

/**
 * Build SQLite 'water' events with deliberately irregular spacing so the
 * gap distribution has a high coefficient of variation (CV > 1.5):
 * several drinks clustered minutes apart, then multi-hour / multi-day gaps.
 * ≥8 entries inside the 14-day window → detectInteroceptionDrift can fire.
 */
function makeWaterEvents(): Array<{
  id: string;
  kind: 'water';
  data: Record<string, unknown>;
  loggedAt: number;
}> {
  // Offsets (ms before now) chosen for a very spiky gap series (CV ≈ 2.8,
  // well over the 1.5 drift threshold): a tight 8-entry burst ~13 days ago
  // (1–10 min apart) then two lone glasses near now — one ~13-day drought
  // dominates, exactly the "body can't time thirst" signal the detector reads.
  const offsets = [
    13 * DAY,
    13 * DAY - 1 * MIN,
    13 * DAY - 2 * MIN,
    13 * DAY - 4 * MIN,
    13 * DAY - 5 * MIN,
    13 * DAY - 7 * MIN,
    13 * DAY - 8 * MIN,
    13 * DAY - 10 * MIN,
    2 * HOUR,
    1 * HOUR,
  ];
  const evs = offsets.map((off, i) => ({
    id: `w_${i}`,
    kind: 'water' as const,
    data: { amountMl: 250 },
    loggedAt: FIXED_NOW - off,
  }));
  // repo.list returns newest-first.
  return evs.sort((a, b) => b.loggedAt - a.loggedAt);
}

describe('body bridge → orchestrator (great rewiring)', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createBodyOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createBodyOrchestrator(store, { now: () => FIXED_NOW });
    mockList.mockResolvedValue(makeWaterEvents() as never);
    mockGetAge.mockResolvedValue(null); // default: age unknown
  });

  afterEach(() => {
    orch.teardown();
    vi.useRealTimers();
  });

  it('mirrors SQLite water rows into body.water_log as {ts, glasses}', async () => {
    await syncToStore(store);
    const water = store.get<Array<{ ts: number; glasses: number }>>('body', 'water_log', []);
    expect(water.length).toBe(10);
    // oldest-first, each row carries a ts and at least one glass
    expect(water[0].ts < water[9].ts).toBe(true);
    expect(water.every((w) => w.glasses >= 1)).toBe(true);
  });

  it('computes body.water_target from the stored age', async () => {
    mockGetAge.mockResolvedValue(60); // 56+ band → 7 glasses
    await syncToStore(store);
    expect(store.get<number>('body', 'water_target', 0)).toBe(7);

    mockGetAge.mockResolvedValue(30); // adult band → 8 glasses
    await syncToStore(store);
    expect(store.get<number>('body', 'water_target', 0)).toBe(8);

    mockGetAge.mockResolvedValue(7); // child band → 5 glasses
    await syncToStore(store);
    expect(store.get<number>('body', 'water_target', 0)).toBe(5);
  });

  it('falls back to a target of 8 when age is unknown', async () => {
    mockGetAge.mockResolvedValue(null);
    await syncToStore(store);
    expect(store.get<number>('body', 'water_target', 0)).toBe(8);
  });

  it('the hydration-drift watcher fires once water rows are mirrored', async () => {
    // Before the bridge runs the watcher has an empty water log.
    orch.recomputePatterns();
    const before = store.get<Array<{ pattern: string }>>('body', 'patterns', []);
    expect(before.find((p) => p.pattern === 'interoception_drift')).toBeUndefined();

    // Mirror SQLite → store, then recompute.
    await syncToStore(store);
    orch.recomputePatterns();

    const after = store.get<Array<{ pattern: string }>>('body', 'patterns', []);
    const drift = after.find((p) => p.pattern === 'interoception_drift');
    expect(drift).toBeDefined();
  });
});
