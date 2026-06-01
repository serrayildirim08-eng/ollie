/**
 * Cycle bridge · SQLite → store mirror, end-to-end with the real watcher.
 *
 * Proves the great-rewiring contract for cycle: rows captured in SQLite,
 * mirrored by syncToStore() into cycle.items/cycle.cycles, drive the REAL
 * cycle orchestrator to recompute and produce a non-null prediction +
 * derived stats — i.e. live data now reaches Layer-2 (which was permanently
 * starved before the bridge).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createCycleOrchestrator } from '@ollie/orchestrator';

// Mock the repo so the bridge reads a fixed SQLite event stream (no native
// SQLite in the test env). Two period_start events 28 days apart + a symptom.
// NOTE: vi.mock is hoisted above top-level consts, so the factory inlines the
// literal timestamps (DAY=86_400_000, T0=0, T1=28*DAY=2_419_200_000).
const DAY = 86_400_000;
const T0 = 0;
const T1 = 28 * DAY;

vi.mock('./repo', () => ({
  cycleRepo: {
    list: vi.fn().mockResolvedValue([
      { id: 'a', kind: 'period_start', symptom: null, occurredAt: 0 },
      { id: 'b', kind: 'symptom', symptom: 'cramps', occurredAt: 86_400_000 },
      { id: 'c', kind: 'period_start', symptom: null, occurredAt: 2_419_200_000 },
      { id: 'd', kind: 'pill', symptom: null, occurredAt: 2_419_200_000 },
    ]),
  },
}));

import { syncToStore } from './bridge';

describe('cycle bridge → watcher', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mirrors cycle_events → cycle.items in the logic shape', async () => {
    await syncToStore(store);
    const items = store.get('cycle', 'items', [] as unknown[]);
    expect(items).toEqual([
      { ts: T0, action: 'started' },
      { ts: T0 + DAY, action: 'symptom', text: 'cramps' },
      { ts: T1, action: 'started' },
      { ts: T1, action: 'pill' },
    ]);
    // cross-module key: two starts 28d apart → one closed boundary record.
    const cycles = store.get('cycle', 'cycles', [] as unknown[]);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  it('mirrored data drives the real cycle watcher (recomputes + predicts)', async () => {
    // now = just after the second period so the data is "current".
    const orch = createCycleOrchestrator(store, { now: () => T1 + DAY });

    // 1) mirror SQLite → store (what the bridge runner does on boot)
    await syncToStore(store);
    // 2) boot the watcher — it reads cycle.items and recomputes
    orch.init();

    // The watcher ran on mirrored data: it stamped a recompute…
    expect(store.get<number>('cycle', 'lastRecomputeAt', 0)).toBeGreaterThan(0);

    // …and computed a prediction from the mirrored two-cycle history.
    const prediction = store.get<{ nextTs: number | null }>('cycle', 'prediction', {
      nextTs: null,
    });
    expect(prediction.nextTs).not.toBeNull();
    expect(typeof prediction.nextTs).toBe('number');

    orch.teardown();
  });
});
