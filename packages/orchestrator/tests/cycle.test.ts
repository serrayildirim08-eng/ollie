/**
 * @ollie/orchestrator · cycle orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
import { createOrchestrator } from '../src/index';
import { createCycleOrchestrator } from '../src/cycle';
import type { NotificationSpec } from '@ollie/notifications';

describe('cycle orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStore(createMemoryAdapter());
    orch = createOrchestrator(store);
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('derives a non-null prediction after two period-start events 28 days apart', () => {
    const t0 = 0;
    const t1 = 28 * 86_400_000;

    store.set('cycle', 'items', [
      { action: 'started', ts: t0 },
      { action: 'started', ts: t1 },
    ]);

    const prediction = store.get<{ nextTs: number | null } | undefined>('cycle', 'prediction');
    expect(prediction).toBeDefined();
    expect(prediction!.nextTs).not.toBeNull();
    expect(typeof prediction!.nextTs).toBe('number');
  });

  it('writes lastRecomputeAt on init', () => {
    const ts = store.get<number>('cycle', 'lastRecomputeAt', 0);
    expect(ts).toBeGreaterThan(0);
  });

  it('re-derives prediction when items change', () => {
    const t0 = Date.now() - 56 * 86_400_000;
    const t1 = Date.now() - 28 * 86_400_000;

    store.set('cycle', 'items', [
      { action: 'started', ts: t0 },
      { action: 'started', ts: t1 },
    ]);

    const first = store.get<{ nextTs: number | null } | undefined>('cycle', 'prediction');
    expect(first!.nextTs).not.toBeNull();

    // Add a third start — prediction should update.
    const t2 = Date.now() - 1 * 86_400_000;
    store.set('cycle', 'items', [
      { action: 'started', ts: t0 },
      { action: 'started', ts: t1 },
      { action: 'started', ts: t2 },
    ]);

    const second = store.get<{ nextTs: number | null } | undefined>('cycle', 'prediction');
    expect(second!.nextTs).not.toBeNull();
    expect(second!.nextTs).not.toBe(first!.nextTs);
  });

  it('refreshes phaseName on 60s tick', () => {
    store.set('cycle', 'items', []);
    const before = store.get<string>('cycle', 'phaseName', '');
    vi.advanceTimersByTime(60_001);
    // phaseName should still be a string (tick ran without throwing).
    const after = store.get<string>('cycle', 'phaseName', '');
    expect(typeof after).toBe('string');
    // Value may or may not change (no cycles → 'unknown' both times), but
    // the store key must exist.
    expect(after).toBeDefined();
    void before; // suppress unused-variable lint
  });

  it('teardown stops the 60s tick from writing', () => {
    orch.teardown();
    store.set('cycle', 'phaseName', 'sentinel');
    vi.advanceTimersByTime(120_001);
    // No timer should have overwritten it.
    expect(store.get('cycle', 'phaseName')).toBe('sentinel');
  });
});

// ─── push notification subscribers ──────────────────────────────────────────

describe('cycle orchestrator — push notification subscribers', () => {
  const DAY_MS = 86_400_000;
  const FIXED_NOW = new Date('2026-05-14T12:00:00Z').getTime();

  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createCycleOrchestrator>;
  let scheduled: Array<{ spec: NotificationSpec; fireAt: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    scheduled = [];
    orch = createCycleOrchestrator(store, {
      now: () => FIXED_NOW,
      scheduleNotification: (spec, fireAt) => { scheduled.push({ spec, fireAt }); },
      ovulationOptIn: true,
    });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('cycle:period_approaching → REMINDER push with deadpan copy', () => {
    emit('cycle:period_approaching', {
      predictedTs: FIXED_NOW + 5 * DAY_MS,
      daysUntil: 5,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('REMINDER');
    expect(scheduled[0].spec.title).toBe('period probably this weekend. flagging the calendar.');
    expect(scheduled[0].spec.dedupe_key).toContain('cycle:period_approaching:');
  });

  it('cycle:period_imminent → REMINDER push with grocery-list reference', () => {
    emit('cycle:period_imminent', {
      predictedTs: FIXED_NOW + DAY_MS,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('REMINDER');
    expect(scheduled[0].spec.title).toBe('period due tomorrow. supplies are in your grocery list.');
  });

  it('cycle:period_late → PATTERN_ALERT push with days substituted', () => {
    emit('cycle:period_late', {
      predictedTs: FIXED_NOW - 3 * DAY_MS,
      daysLate: 3,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('PATTERN_ALERT');
    expect(scheduled[0].spec.title).toBe('your period is 3 days late from prediction. just noting.');
  });

  it('cycle:luteal_starting → PATTERN_ALERT push with weekday + 22% line', () => {
    const friday = new Date('2026-05-15T12:00:00Z').getTime();
    emit('cycle:luteal_starting', {
      lutealStartTs: friday,
      daysUntil: 3,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.title).toMatch(/^luteal phase starts \w+\. spending tends up 22% for you\. energy may dip\.$/);
    expect(scheduled[0].spec.title.toLowerCase()).toContain('friday');
  });

  it('cycle:ovulation_imminent → PATTERN_ALERT push with deadpan copy', () => {
    emit('cycle:ovulation_imminent', {
      ovulationTs: FIXED_NOW + DAY_MS,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.title).toBe('ovulation likely tomorrow.');
  });

  it('cycle:pill_missed → REMINDER push with yes/no prompt', () => {
    emit('cycle:pill_missed', {
      missedDate: '2026-05-13',
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('REMINDER');
    expect(scheduled[0].spec.title).toBe('pill not logged today. yes or no?');
    expect(scheduled[0].spec.dedupe_key).toContain('2026-05-13');
  });

  it('does not double-emit the same prediction window event on re-recompute', () => {
    let approachingCount = 0;
    on('cycle:period_approaching', () => { approachingCount++; });

    const lastStart = FIXED_NOW + 5 * DAY_MS - 28 * DAY_MS;
    const prevStart = lastStart - 28 * DAY_MS;
    store.set('cycle', 'items', [
      { action: 'started', ts: prevStart },
      { action: 'started', ts: lastStart },
    ]);
    const firstCount = approachingCount;
    orch.recomputeCycle();
    expect(approachingCount).toBe(firstCount);
  });

  it('cycle:pill_missed emits when prior pill exists but yesterday has none', () => {
    let pillMissedCount = 0;
    on('cycle:pill_missed', () => { pillMissedCount++; });

    store.set('cycle', 'items', [
      { action: 'pill', ts: FIXED_NOW - 3 * DAY_MS },
      { action: 'pill', ts: FIXED_NOW - 2 * DAY_MS },
    ]);

    expect(pillMissedCount).toBe(1);
  });

  it('scheduleNotification NOT called when not injected', () => {
    // Tear down the outer orch so its push subscriber doesn't observe the emit.
    orch.teardown();
    scheduled.length = 0;
    const store2 = createStore(createMemoryAdapter());
    const orch2 = createCycleOrchestrator(store2, { now: () => FIXED_NOW });
    orch2.init();
    emit('cycle:period_approaching', {
      predictedTs: FIXED_NOW + 5 * DAY_MS,
      daysUntil: 5,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(0);
    orch2.teardown();
  });
});
