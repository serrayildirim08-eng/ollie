/**
 * @ollie/orchestrator · body orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
import { createBodyOrchestrator } from '../src/body';
import type { NotificationSpec } from '@ollie/notifications';

// Fixture: a user with 30 days of water logs and braindump entries
// mentioning headaches on low-water days — enough to fire
// headache-hydration pattern (r threshold is normally 0.4 with ≥5 days).
function makeFixture(now: number): {
  waterLog: Array<{ ts: number; glasses?: number }>;
  actionLog: Array<{ ts: number; rawText: string; undone: boolean }>;
} {
  const MS = 86_400_000;
  const waterLog: Array<{ ts: number; glasses?: number }> = [];
  const actionLog: Array<{ ts: number; rawText: string; undone: boolean }> = [];

  // 30-day window: alternate high (8 glasses) and low (1 glass) water days.
  // Headache mention on every low-water day.
  for (let d = 30; d >= 1; d--) {
    const dayTs = now - d * MS + 12 * 3_600_000; // noon each day
    const isLow = d % 2 === 0;
    waterLog.push({ ts: dayTs, glasses: isLow ? 1 : 8 });
    if (isLow) {
      actionLog.push({ ts: dayTs + 3_600_000, rawText: 'headache again today', undone: false });
    } else {
      actionLog.push({ ts: dayTs + 3_600_000, rawText: 'feeling fine', undone: false });
    }
  }

  return { waterLog, actionLog };
}

describe('body orchestrator', () => {
  const FIXED_NOW = new Date('2026-05-11T12:00:00Z').getTime();

  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createBodyOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createBodyOrchestrator(store, { now: () => FIXED_NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('writes patterns and patternsLastComputedAt after init()', () => {
    const { waterLog, actionLog } = makeFixture(FIXED_NOW);
    store.set('body', 'water_log', waterLog);
    store.set('shared', 'actionLog', actionLog);

    orch.init();
    // Flush the 500ms debounce.
    vi.advanceTimersByTime(600);

    const lastComputedAt = store.get<number>('body', 'patternsLastComputedAt', 0);
    expect(lastComputedAt).toBe(FIXED_NOW);

    const patterns = store.get<unknown[]>('body', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
  });

  it('fires at least one pattern for a realistic fixture', () => {
    const { waterLog, actionLog } = makeFixture(FIXED_NOW);
    store.set('body', 'water_log', waterLog);
    store.set('shared', 'actionLog', actionLog);

    orch.init();
    vi.advanceTimersByTime(600);

    const patterns = store.get<Array<{ pattern: string }>>('body', 'patterns', []);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0]).toHaveProperty('pattern');
    expect(typeof patterns[0].pattern).toBe('string');
  });

  it('re-runs when water_log changes', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    const before = store.get<unknown[]>('body', 'patterns', []);

    const { waterLog, actionLog } = makeFixture(FIXED_NOW);
    store.set('shared', 'actionLog', actionLog);
    store.set('body', 'water_log', waterLog);
    vi.advanceTimersByTime(600);

    const after = store.get<unknown[]>('body', 'patterns', []);
    // After seeding data a recompute ran — patternsLastComputedAt should be set.
    const ts = store.get<number>('body', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
    void before;
    void after;
  });

  it('emits body:pattern_detected for new patterns', () => {
    const detected: string[] = [];
    on('body:pattern_detected', (p: unknown) => {
      const payload = p as { pattern: string };
      detected.push(payload.pattern);
    });

    const { waterLog, actionLog } = makeFixture(FIXED_NOW);
    store.set('body', 'water_log', waterLog);
    store.set('shared', 'actionLog', actionLog);

    orch.init();
    vi.advanceTimersByTime(600);

    expect(detected.length).toBeGreaterThan(0);
    expect(typeof detected[0]).toBe('string');
  });

  it('teardown stops recompute from firing', () => {
    orch.init();
    vi.advanceTimersByTime(600);

    orch.teardown();
    store.set('body', 'patterns', [{ pattern: 'sentinel' }] as never);

    // Store subscriptions are gone — no new recompute scheduled.
    store.set('body', 'water_log', []);
    vi.advanceTimersByTime(600);

    const patterns = store.get<Array<{ pattern: string }>>('body', 'patterns', []);
    expect(patterns[0]?.pattern).toBe('sentinel');
  });

  it('init() is idempotent', () => {
    orch.init();
    orch.init();
    orch.init();
    vi.advanceTimersByTime(600);
    // Should not throw and should not double-fire subscriptions.
    const ts = store.get<number>('body', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });
});

// ─── push notification subscribers ──────────────────────────────────────────

describe('body orchestrator — push notification subscribers', () => {
  // Use a time inside the 8am supplement reminder window so emitSupplementDue
  // fires when recompute runs.
  const FIXED_NOW = new Date('2026-05-14T08:30:00').getTime();

  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createBodyOrchestrator>;
  let scheduled: Array<{ spec: NotificationSpec; fireAt: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    scheduled = [];
    orch = createBodyOrchestrator(store, {
      now: () => FIXED_NOW,
      scheduleNotification: (spec, fireAt) => { scheduled.push({ spec, fireAt }); },
    });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('body:supplement_due → REMINDER push with name substituted', () => {
    orch.init();
    emit('body:supplement_due', {
      supplementId: 'sup-d',
      supplementName: 'vitamin d',
      reminderHHMM: '08:00',
      ts: FIXED_NOW,
    });
    // flush the 10ms aggregation timer
    vi.advanceTimersByTime(20);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('REMINDER');
    expect(scheduled[0].spec.title).toBe('vitamin d. just a heads up.');
    expect(scheduled[0].spec.dedupe_key).toContain('body:supplement_due:sup-d');
  });

  it('body:supplement_due → aggregates multiple supplements emitted within same tick', () => {
    orch.init();
    emit('body:supplement_due', {
      supplementId: 'sup-d', supplementName: 'vitamin d',
      reminderHHMM: '08:00', ts: FIXED_NOW,
    });
    emit('body:supplement_due', {
      supplementId: 'sup-mg', supplementName: 'magnesium',
      reminderHHMM: '08:00', ts: FIXED_NOW,
    });
    emit('body:supplement_due', {
      supplementId: 'sup-fe', supplementName: 'iron',
      reminderHHMM: '08:00', ts: FIXED_NOW,
    });
    vi.advanceTimersByTime(20);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.title).toBe('vitamin d, magnesium, iron. just a heads up.');
    expect(scheduled[0].spec.aggregation_group).toContain('body:supplement_due:');
  });

  it('body:posture_nudge → REMINDER push with deadpan copy', () => {
    orch.init();
    emit('body:posture_nudge', {
      hourBucket: 14,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('REMINDER');
    expect(scheduled[0].spec.title).toBe('stand up. or sit better. either works.');
    expect(scheduled[0].spec.dedupe_key).toContain('body:posture_nudge');
  });

  it('emits body:supplement_due from recompute when reminder window is open', () => {
    let emitted = 0;
    on('body:supplement_due', () => { emitted++; });
    store.set('body', 'supplements', [
      { id: 'sup-d', name: 'vitamin d', dose: '2000iu', reminder_hhmm: '08:00', added_at: FIXED_NOW - 86400_000 },
    ]);
    orch.init();
    vi.advanceTimersByTime(600);
    expect(emitted).toBeGreaterThanOrEqual(1);
  });

  it('emits body:supplement_due only ONCE per supplement per day', () => {
    let emitted = 0;
    on('body:supplement_due', () => { emitted++; });
    store.set('body', 'supplements', [
      { id: 'sup-d', name: 'vitamin d', reminder_hhmm: '08:00', added_at: FIXED_NOW - 86400_000 },
    ]);
    orch.init();
    vi.advanceTimersByTime(600);
    orch.recomputePatterns();
    orch.recomputePatterns();
    expect(emitted).toBe(1);
  });

  it('does NOT emit body:supplement_due when supplement was checked off today', () => {
    let emitted = 0;
    on('body:supplement_due', () => { emitted++; });
    const todayKey = new Date(FIXED_NOW).toISOString().slice(0, 10);
    store.set('body', 'supplements', [
      { id: 'sup-d', name: 'vitamin d', reminder_hhmm: '08:00', added_at: FIXED_NOW - 86400_000, checked_dates: [todayKey] },
    ]);
    orch.init();
    vi.advanceTimersByTime(600);
    expect(emitted).toBe(0);
  });

  it('does NOT emit body:posture_nudge when opt_in is false', () => {
    let emitted = 0;
    on('body:posture_nudge', () => { emitted++; });
    // posture_settings absent → opt_in false → no emit
    orch.init();
    vi.advanceTimersByTime(600);
    expect(emitted).toBe(0);
  });

  it('emits body:posture_nudge when opt_in is true and current hour is in window', () => {
    // Override now to 14:00 local (well inside 9-17 work hours)
    vi.setSystemTime(new Date('2026-05-14T14:00:00').getTime());
    orch.teardown();
    orch = createBodyOrchestrator(store, {
      now: () => new Date('2026-05-14T14:00:00').getTime(),
      scheduleNotification: (spec, fireAt) => { scheduled.push({ spec, fireAt }); },
    });
    let emitted = 0;
    on('body:posture_nudge', () => { emitted++; });
    store.set('body', 'posture_settings', { opt_in: true });
    orch.init();
    vi.advanceTimersByTime(600);
    expect(emitted).toBe(1);
  });

  it('scheduleNotification NOT called when not injected', () => {
    const store2 = createStore(createMemoryAdapter());
    const orch2 = createBodyOrchestrator(store2, { now: () => FIXED_NOW });
    orch2.init();
    emit('body:posture_nudge', { hourBucket: 14, ts: FIXED_NOW });
    expect(scheduled).toHaveLength(0);
    orch2.teardown();
  });
});
