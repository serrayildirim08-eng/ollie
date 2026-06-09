/**
 * Cycle pregnancy pause — suppression + clean resume, end-to-end with the
 * real watcher.
 *
 * Proves the brief:
 *   (a) declaring pregnant suppresses prediction (nextTs → null) AND clears
 *       period/late health flags + stops the period-late event from firing,
 *   (b) ending the pregnancy resumes prediction (nextTs → number again),
 *   (c) the first period AFTER a pregnancy ends restarts the cycle — it is
 *       NOT paired with the pre-pregnancy start into one absurd ~9-month
 *       "late" cycle (the fresh-start fence).
 *
 * The repo is mocked with a MUTABLE row list so each test drives a different
 * cycle_events stream through the same bridge + real orchestrator. No native
 * SQLite in this env — the bridge only calls cycleRepo.list().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createCycleOrchestrator } from '@ollie/orchestrator';
import type { CycleEvent } from './types';

const DAY = 86_400_000;

// Mutable row stream the mocked repo serves. Tests overwrite `rows` then call
// syncToStore + orch.init().
let rows: CycleEvent[] = [];

vi.mock('./repo', () => ({
  cycleRepo: {
    list: vi.fn(async () => rows),
  },
}));

import { syncToStore } from './bridge';

function ev(
  kind: CycleEvent['kind'],
  occurredAt: number,
  extra: Partial<CycleEvent> = {},
): CycleEvent {
  return { id: `${kind}_${occurredAt}`, kind, symptom: null, intensity: null, occurredAt, ...extra };
}

describe('cycle pregnancy pause — suppression + resume', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    rows = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('(a) declaring pregnant suppresses prediction + clears health flags + schedules no period nudge', async () => {
    const now = 400 * DAY;
    // A long, regular history that on its own would predict a next period AND
    // (with 3+ long cycles ≥35d) trip the long-cycles health flag — so we can
    // prove suppression, not just absence of data.
    rows = [
      ev('period_start', 0),
      ev('period_start', 40 * DAY),
      ev('period_start', 80 * DAY),
      ev('period_start', 120 * DAY),
      // declared pregnant AFTER the last period, before `now`
      ev('pregnancy_start', 150 * DAY),
    ];

    // Inject the push scheduler — the user-facing nudge surface. If the cycle
    // were NOT paused, being 250d past the last period would schedule a
    // period_late notification. We assert it never does while paused.
    const scheduled: unknown[] = [];
    const orch = createCycleOrchestrator(store, {
      now: () => now,
      scheduleNotification: (spec) => scheduled.push(spec),
    });
    await syncToStore(store);
    orch.init();

    // bridge derived the pause
    expect(store.get('cycle', 'pregnant', false)).toBe(true);

    // prediction is dormant — no predicted next period
    const prediction = store.get<{ nextTs: number | null }>('cycle', 'prediction', { nextTs: 0 });
    expect(prediction.nextTs).toBeNull();

    // health flags cleared while paused (would otherwise carry long-cycles)
    expect(store.get('cycle', 'healthFlags', null)).toEqual([]);
    expect(store.get('cycle', 'flags', null)).toEqual([]);

    // no period/late/missed nudge scheduled despite being 250d past last period
    expect(scheduled).toHaveLength(0);

    orch.teardown();
  });

  it('control: same history WITHOUT the pregnancy marker DOES predict + flag (proves the test bites)', async () => {
    const now = 400 * DAY;
    rows = [
      ev('period_start', 0),
      ev('period_start', 40 * DAY),
      ev('period_start', 80 * DAY),
      ev('period_start', 120 * DAY),
      // no pregnancy_start — normal tracking
    ];

    const orch = createCycleOrchestrator(store, { now: () => now });
    await syncToStore(store);
    orch.init();

    expect(store.get('cycle', 'pregnant', true)).toBe(false);
    const prediction = store.get<{ nextTs: number | null }>('cycle', 'prediction', { nextTs: null });
    expect(prediction.nextTs).not.toBeNull();
    // 3 consecutive 40-day cycles → long-cycles flag fires when NOT paused
    const flags = store.get<Array<{ id: string }>>('cycle', 'healthFlags', []);
    expect(flags.some((f) => f.id === 'long-cycles')).toBe(true);

    orch.teardown();
  });

  it('(b) ending the pregnancy resumes prediction', async () => {
    const now = 200 * DAY;
    rows = [
      ev('period_start', 0),
      ev('period_start', 28 * DAY),
      ev('pregnancy_start', 40 * DAY),
      ev('pregnancy_end', 100 * DAY),
      // first period after the end
      ev('period_start', 130 * DAY),
      ev('period_start', 158 * DAY),
    ];

    const orch = createCycleOrchestrator(store, { now: () => now });
    await syncToStore(store);
    orch.init();

    expect(store.get('cycle', 'pregnant', true)).toBe(false);

    const prediction = store.get<{ nextTs: number | null }>('cycle', 'prediction', { nextTs: null });
    expect(prediction.nextTs).not.toBeNull();
    expect(typeof prediction.nextTs).toBe('number');

    orch.teardown();
  });

  it('(c) the first post-end period restarts the cycle — no absurd ~9-month late cycle', async () => {
    const now = 220 * DAY;
    rows = [
      // pre-pregnancy starts
      ev('period_start', 0),
      ev('period_start', 28 * DAY),
      ev('pregnancy_start', 40 * DAY),
      ev('pregnancy_end', 120 * DAY),
      // two post-end periods, ~28 days apart — a clean fresh start
      ev('period_start', 150 * DAY),
      ev('period_start', 178 * DAY),
    ];

    const orch = createCycleOrchestrator(store, { now: () => now });
    await syncToStore(store);
    orch.init();

    // The fence dropped the pre-pregnancy starts (< pregnancyEndTs = 120d) from
    // the prediction spine. Boundaries therefore see only the two post-end
    // starts → one ~28-day cycle, NOT a ~110-day pre→post jump.
    const cycles = store.get<Array<{ cycleStartTs: number; cycleLengthDays?: number }>>(
      'cycle',
      'cycles',
      [],
    );
    const closed = cycles.filter((c) => typeof c.cycleLengthDays === 'number');
    expect(closed.length).toBeGreaterThanOrEqual(1);
    for (const c of closed) {
      // nothing absurd — every closed cycle is in a sane human range, never the
      // ~110-day artefact a non-fenced join would produce.
      expect(c.cycleLengthDays! < 60).toBe(true);
    }

    // and the prediction is a normal ~28-day forward step, not months out
    const prediction = store.get<{ avgCycle: number; nextTs: number | null }>('cycle', 'prediction', {
      avgCycle: 0,
      nextTs: null,
    });
    expect(prediction.nextTs).not.toBeNull();
    expect(prediction.avgCycle).toBeLessThan(45);

    orch.teardown();
  });
});
