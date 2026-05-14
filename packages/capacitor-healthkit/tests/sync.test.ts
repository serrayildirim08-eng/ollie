/**
 * @ollie/capacitor-healthkit · sync pipeline tests
 *
 * Exercises the pull pipeline via a hand-rolled HealthPluginShape mock
 * (the `pluginOverride` path). Covers:
 *   - happy path (one pull → store written)
 *   - idempotency (re-pull same data → no growth, same values)
 *   - sleep mirror (mirrors only when no existing record for night)
 *   - native-absent path (every reader returns null → no store writes)
 *   - bucketStepsByDay / upsertById helpers
 *   - reader errors don't break the whole pass (warnings collected)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bucketStepsByDay,
  HEALTHKIT_SYNC_INTERVAL_MS,
  mirrorSleepRecords,
  pickLatest,
  sleepSegmentsToRecord,
  syncHealthKit,
  upsertById,
} from '../src/sync';
import type { HealthPluginShape } from '../src/runtime';
import type {
  HealthKitSleepSample,
  HealthKitStepSample,
} from '../src/types';

// ─── minimal in-memory Store ──────────────────────────────────────────

interface InMemoryStore {
  data: Record<string, Record<string, unknown>>;
  get<T>(mod: string, key: string, fallback: T): T;
  set(mod: string, key: string, value: unknown): void;
  subscribeKey<T>(mod: string, key: string, cb: (v: T) => void): () => void;
  subscribe?: unknown;
  _reset?: () => void;
}

function makeStore(): InMemoryStore {
  return {
    data: {},
    get<T>(mod: string, key: string, fallback: T): T {
      const m = this.data[mod];
      if (!m) return fallback;
      return (key in m ? m[key] : fallback) as T;
    },
    set(mod: string, key: string, value: unknown): void {
      if (!this.data[mod]) this.data[mod] = {};
      this.data[mod]![key] = value;
    },
    subscribeKey(): () => void { return () => undefined; },
  };
}

// ─── plugin mock factory ──────────────────────────────────────────────

function makePlugin(
  responses: Partial<Record<string, Array<{ startDate: string; endDate: string; value: number | string; unit?: string; id?: string }>>>,
): HealthPluginShape {
  return {
    async requestAuthorization() { return { authorized: true }; },
    async queryAggregated(opts) {
      // Not used in these tests; fall back to empty.
      void opts;
      return { samples: [] };
    },
    async querySamples(opts) {
      return { samples: responses[opts.dataType] ?? [] };
    },
  };
}

const NOW = Date.UTC(2026, 4, 14, 9, 0, 0); // 2026-05-14T09:00:00Z

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe('syncHealthKit · happy path', () => {
  it('pulls all five metrics and writes to the healthkit.* namespace', async () => {
    const store = makeStore();
    const plugin = makePlugin({
      steps: [
        { startDate: new Date(NOW - 3 * 3600_000).toISOString(), endDate: new Date(NOW - 2 * 3600_000).toISOString(), value: 1500, id: 'S1' },
        { startDate: new Date(NOW - 2 * 3600_000).toISOString(), endDate: new Date(NOW - 1 * 3600_000).toISOString(), value: 2200, id: 'S2' },
      ],
      heartRate: [
        { startDate: new Date(NOW - 600_000).toISOString(), endDate: new Date(NOW - 600_000).toISOString(), value: 72, id: 'HR1' },
      ],
      sleep: [
        { startDate: new Date(NOW - 10 * 3600_000).toISOString(), endDate: new Date(NOW - 4 * 3600_000).toISOString(), value: 'asleep', id: 'SL1' },
      ],
      restingHeartRate: [
        { startDate: new Date(NOW - 24 * 3600_000).toISOString(), endDate: new Date(NOW - 24 * 3600_000).toISOString(), value: 58, id: 'R1' },
        { startDate: new Date(NOW - 60 * 60_000).toISOString(), endDate: new Date(NOW - 60 * 60_000).toISOString(), value: 56, id: 'R2' },
      ],
      hydration: [
        { startDate: new Date(NOW - 3600_000).toISOString(), endDate: new Date(NOW - 3600_000).toISOString(), value: 250, unit: 'ml', id: 'H1' },
      ],
    });

    const r = await syncHealthKit(store as never, { pluginOverride: plugin });

    expect(r.ok).toBe(true);
    expect(r.ranNative).toBe(true);
    expect(r.counts.steps).toBe(2);
    expect(r.counts.heartRate).toBe(1);
    expect(r.counts.sleep).toBe(1);
    expect(r.counts.restingHR).toBe(2);
    expect(r.counts.hydration).toBe(1);

    expect(store.get<Record<string, number>>('healthkit', 'samples_steps_byDay', {})).toBeTruthy();
    expect(store.get<number>('healthkit', 'last_sync_at', 0)).toBe(NOW);
    // resting HR picks the LATEST sample by start_ts.
    const restingLatest = store.get<{ bpm: number; start_ts: number }>('healthkit', 'samples_restingHR_latest', { bpm: 0, start_ts: 0 });
    expect(restingLatest.bpm).toBe(56);
  });

  it('is idempotent: re-running with the same input does not grow arrays', async () => {
    const store = makeStore();
    const plugin = makePlugin({
      heartRate: [
        { startDate: new Date(NOW - 600_000).toISOString(), endDate: new Date(NOW - 600_000).toISOString(), value: 72, id: 'HR1' },
        { startDate: new Date(NOW - 300_000).toISOString(), endDate: new Date(NOW - 300_000).toISOString(), value: 78, id: 'HR2' },
      ],
    });

    await syncHealthKit(store as never, { pluginOverride: plugin });
    const after1 = store.get<unknown[]>('healthkit', 'samples_heartRate', []);
    expect(after1.length).toBe(2);

    await syncHealthKit(store as never, { pluginOverride: plugin });
    const after2 = store.get<unknown[]>('healthkit', 'samples_heartRate', []);
    expect(after2.length).toBe(2);
  });
});

describe('syncHealthKit · native-absent', () => {
  it('returns ranNative=false and does not write last_sync_at when nothing loads', async () => {
    const store = makeStore();
    // No pluginOverride + isHealthKitAvailable() false (test env) → every
    // reader returns null → ranNative === false.
    const r = await syncHealthKit(store as never, {});
    expect(r.ranNative).toBe(false);
    // No writes have happened, so last_sync_at remains 0.
    expect(store.get<number>('healthkit', 'last_sync_at', 0)).toBe(0);
  });
});

describe('syncHealthKit · resilience', () => {
  it('one failing reader does not break the pass', async () => {
    const store = makeStore();
    const plugin: HealthPluginShape = {
      async requestAuthorization() { return { authorized: true }; },
      async queryAggregated() { return { samples: [] }; },
      async querySamples(opts) {
        if (opts.dataType === 'heartRate') {
          throw new Error('boom');
        }
        return { samples: [] };
      },
    };

    const r = await syncHealthKit(store as never, { pluginOverride: plugin });
    expect(r.ok).toBe(true);
    expect(r.ranNative).toBe(true);
    expect(r.warnings.some((w) => w.includes('heartRate'))).toBe(true);
  });
});

describe('mirrorSleepRecords', () => {
  function sleepSample(start: number, end: number, stage: 'asleep' | 'remSleep' | 'deepSleep' | 'lightSleep' = 'asleep'): HealthKitSleepSample {
    return {
      id: `id-${start}` as never,
      kind: 'sleepAnalysis',
      start_ts: start,
      end_ts: end,
      stage,
      duration_min: Math.round((end - start) / 60_000),
      source: 'healthkit',
      ingested_at: start,
    };
  }

  it('inserts a sleep.records row when none exists for the night', () => {
    const store = makeStore();
    const segs = [
      sleepSample(Date.UTC(2026, 4, 13, 23, 0, 0), Date.UTC(2026, 4, 14, 1, 0, 0)),
      sleepSample(Date.UTC(2026, 4, 14, 1, 30, 0), Date.UTC(2026, 4, 14, 6, 0, 0)),
    ];
    mirrorSleepRecords(store as never, segs);
    const records = store.get<Array<{ night_of: string; source?: string; tst_min?: number }>>('sleep', 'records', []);
    expect(records.length).toBe(1);
    expect(records[0]!.source).toBe('healthkit');
    expect(records[0]!.tst_min).toBeGreaterThan(0);
  });

  it('does not overwrite an existing user record', () => {
    const store = makeStore();
    store.set('sleep', 'records', [
      { id: 'user-1', night_of: '2026-05-13', source: 'dump', tst_min: 420, tokens: [] },
    ]);
    const segs = [
      sleepSample(Date.UTC(2026, 4, 13, 23, 0, 0), Date.UTC(2026, 4, 14, 5, 0, 0)),
    ];
    mirrorSleepRecords(store as never, segs);
    const records = store.get<Array<{ source?: string }>>('sleep', 'records', []);
    expect(records.length).toBe(1);
    expect(records[0]!.source).toBe('dump');
  });
});

describe('sleepSegmentsToRecord', () => {
  it('returns null when no sleeping stages are present', () => {
    const r = sleepSegmentsToRecord('2026-05-14', [
      {
        id: 'x' as never,
        kind: 'sleepAnalysis',
        start_ts: 0, end_ts: 0,
        stage: 'awake', duration_min: 0,
        source: 'healthkit', ingested_at: 0,
      },
    ]);
    expect(r).toBeNull();
  });

  it('sums duration only over the sleeping stages', () => {
    const r = sleepSegmentsToRecord('2026-05-14', [
      { id: 'a' as never, kind: 'sleepAnalysis', start_ts: 1000, end_ts: 1000 + 60_000 * 60, stage: 'asleep', duration_min: 60, source: 'healthkit', ingested_at: 0 },
      { id: 'b' as never, kind: 'sleepAnalysis', start_ts: 1000 + 60_000 * 60, end_ts: 1000 + 60_000 * 90, stage: 'awake', duration_min: 30, source: 'healthkit', ingested_at: 0 },
      { id: 'c' as never, kind: 'sleepAnalysis', start_ts: 1000 + 60_000 * 90, end_ts: 1000 + 60_000 * 180, stage: 'remSleep', duration_min: 90, source: 'healthkit', ingested_at: 0 },
    ]);
    expect(r!.tst_min).toBe(150);
  });
});

describe('helpers', () => {
  it('bucketStepsByDay sums by local YYYY-MM-DD', () => {
    const noon1 = Date.UTC(2026, 4, 13, 18, 0, 0);
    const noon2 = Date.UTC(2026, 4, 13, 20, 0, 0);
    const noon3 = Date.UTC(2026, 4, 14, 18, 0, 0);
    const out = bucketStepsByDay([
      { id: '1' as never, kind: 'stepCount', start_ts: noon1, end_ts: noon1, steps: 100, source: 'healthkit', ingested_at: 0 },
      { id: '2' as never, kind: 'stepCount', start_ts: noon2, end_ts: noon2, steps: 200, source: 'healthkit', ingested_at: 0 },
      { id: '3' as never, kind: 'stepCount', start_ts: noon3, end_ts: noon3, steps: 50, source: 'healthkit', ingested_at: 0 },
    ] as HealthKitStepSample[]);
    // Local-day bucketing uses the runtime's TZ. Assert both buckets
    // exist; their absolute keys depend on the TZ but the dataset
    // shape is invariant: exactly two distinct keys, summing to 350.
    const total = Object.values(out).reduce((a, b) => a + b, 0);
    expect(total).toBe(350);
    expect(Object.keys(out)).toHaveLength(2);
  });

  it('upsertById merges by id, last-write-wins', () => {
    const a = { id: 'a', start_ts: 1, v: 1 };
    const b = { id: 'b', start_ts: 2, v: 2 };
    const aPrime = { id: 'a', start_ts: 1, v: 99 };
    const out = upsertById([a, b], [aPrime]);
    expect(out).toHaveLength(2);
    const found = out.find((x) => x.id === 'a')!;
    expect((found as { v: number }).v).toBe(99);
  });

  it('pickLatest returns the sample with the highest start_ts', () => {
    const out = pickLatest([
      { start_ts: 10 },
      { start_ts: 50 },
      { start_ts: 30 },
    ]);
    expect(out!.start_ts).toBe(50);
  });

  it('pickLatest returns null on empty input', () => {
    expect(pickLatest([])).toBeNull();
  });

  it('exports a 6h default interval', () => {
    expect(HEALTHKIT_SYNC_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
