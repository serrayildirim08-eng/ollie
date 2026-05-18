/**
 * Audit #2 regression guard — the root orchestrator MUST boot the two
 * timed passes (body weekly review + body correlation pass).
 *
 * Before this fix `scheduleWeeklyReview()` / `scheduleBodyCorrelationPass()`
 * were exported but never called, so:
 *   - body:weekly_review never fired, and
 *   - pattern:detected had no emitter at all → the push path behind
 *     initPatternDetectedSubscriber was dead code.
 *
 * These tests assert createOrchestrator().init() arms both, that they
 * actually emit, and that teardown() disarms them cleanly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createOrchestrator } from '../src/index';

// A Wednesday noon — next Sunday 19:00 is a fixed, known delta away.
const FIXED_NOW = new Date('2026-05-13T12:00:00Z').getTime();

describe('root orchestrator · timed-pass booting (audit #2)', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createOrchestrator(store);
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('init() runs a deferred first body-correlation pass (persists correlations key)', () => {
    expect(store.get('body', 'correlations', null)).toBeNull();
    orch.init();
    // The first pass is deferred to a 0ms timer so a cold-start
    // pattern:detected emit lands after the app boot registers its
    // push subscriber. Before the timer fires nothing is persisted.
    expect(store.get('body', 'correlationsLastComputedAt', null)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.get('body', 'correlationsLastComputedAt', null)).not.toBeNull();
    expect(Array.isArray(store.get('body', 'correlations', null))).toBe(true);
  });

  it('init() arms the weekly-review timer; it emits body:weekly_review when it fires', () => {
    const seen: unknown[] = [];
    const unsub = on('body:weekly_review', (p) => seen.push(p));

    orch.init();
    expect(seen).toHaveLength(0); // not fired yet — armed for Sunday 19:00

    // Jump well past the next Sunday 19:00 boundary.
    vi.advanceTimersByTime(8 * 86_400_000);
    expect(seen.length).toBeGreaterThanOrEqual(1);

    unsub();
  });

  it('init() arms the daily body-correlation timer (re-runs the pass at 03:00 local)', () => {
    orch.init();
    // Let the deferred first pass land.
    vi.advanceTimersByTime(1);
    const firstRunAt = store.get<number>('body', 'correlationsLastComputedAt', 0);
    expect(firstRunAt).toBeGreaterThan(0);

    // Advance two days — the 03:00 daily timer must have re-fired.
    vi.advanceTimersByTime(2 * 86_400_000);
    const laterRunAt = store.get<number>('body', 'correlationsLastComputedAt', 0);
    expect(laterRunAt).toBeGreaterThan(firstRunAt ?? 0);
  });

  it('teardown() disarms the timers — no emit after teardown', () => {
    const seen: unknown[] = [];
    const unsub = on('body:weekly_review', (p) => seen.push(p));

    orch.init();
    orch.teardown();
    seen.length = 0;

    // Even a long jump must not fire a torn-down scheduler.
    vi.advanceTimersByTime(30 * 86_400_000);
    expect(seen).toHaveLength(0);

    unsub();
  });

  it('init() is idempotent — re-init does not leak a second weekly timer', () => {
    const seen: unknown[] = [];
    const unsub = on('body:weekly_review', (p) => seen.push(p));

    orch.init();
    orch.init(); // re-arm; must clear the prior timer, not stack one

    vi.advanceTimersByTime(8 * 86_400_000);
    // Exactly one weekly review for the one week window crossed.
    expect(seen).toHaveLength(1);

    unsub();
  });
});
