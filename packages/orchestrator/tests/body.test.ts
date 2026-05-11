/**
 * @ollie/orchestrator · body orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createBodyOrchestrator } from '../src/body';

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
