/**
 * @ollie/router · cross-module router — D2 wire tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import * as events from '@ollie/events';
import { createCrossModuleRouter, type CrossModuleLineageEntry } from '../src/cross-module';

describe('cross-module router', () => {
  let store: ReturnType<typeof createStore>;
  let router: ReturnType<typeof createCrossModuleRouter>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    router = createCrossModuleRouter(store, events, { now: () => 1_700_000_000_000 });
    router.init();
  });

  afterEach(() => {
    router.teardown();
    events._clearAllHandlers();
  });

  it('finance reminder → admin:reflect_upcoming + admin.reflected store entry', () => {
    const seen: unknown[] = [];
    events.on('admin:reflect_upcoming', (p) => seen.push(p));

    events.emit('finance:reminder_set', {
      pattern_id: 'rent-1',
      due_at: 1_700_000_000_000 + 5 * 86_400_000,
      kind: 'bill',
      message: 'rent due in 5 days',
      ts: 1_700_000_000_000,
    });

    expect(seen).toHaveLength(1);
    const reflected = store.get<Array<{ id: string }>>('admin', 'reflected', []) ?? [];
    expect(reflected).toHaveLength(1);
    expect(reflected[0].id).toContain('rent-1');
  });

  it('sleep pacing breach → habits reduce_motion + work suggest_break', () => {
    const habitsSeen: unknown[] = [];
    const workSeen: unknown[] = [];
    events.on('habits:reduce_motion_on', (p) => habitsSeen.push(p));
    events.on('work:suggest_break', (p) => workSeen.push(p));

    events.emit('sleep:pacing_breach_detected', {
      severity: 'watch',
      run_length: 5,
      ts: 1_700_000_000_000,
    });

    expect(habitsSeen).toHaveLength(1);
    expect(workSeen).toHaveLength(1);
  });

  it('finance spending spike → body:suggest_rest_check', () => {
    const seen: unknown[] = [];
    events.on('body:suggest_rest_check', (p) => seen.push(p));
    events.emit('finance:spending_spike_detected', {
      amount: 240,
      baseline_median: 80,
      ratio: 3.0,
      ts: 1_700_000_000_000,
    });
    expect(seen).toHaveLength(1);
  });

  it('habits interest_capture → work:suggest_pause_marked_missed', () => {
    const seen: unknown[] = [];
    events.on('work:suggest_pause_marked_missed', (p) => seen.push(p));
    events.emit('habits:interest_capture_detected', { ts: 1_700_000_000_000 });
    expect(seen).toHaveLength(1);
  });

  it('body hydration drop → habits:surface_water_habit', () => {
    const seen: unknown[] = [];
    events.on('habits:surface_water_habit', (p) => seen.push(p));
    events.emit('body:hydration_drop_detected', { drop_pct: 35, ts: 1_700_000_000_000 });
    expect(seen).toHaveLength(1);
  });

  it('hydration drop reflects into habits.surface_water_habit so the UI can render', () => {
    // Regression: previously this rule had no `reflect` block. The event
    // fired but the store was never written, so HabitsWaterPrompt (which
    // reads habits.surface_water_habit) was dead code.
    events.emit('body:hydration_drop_detected', { drop_pct: 35, ts: 1_700_000_000_000 });

    const surfaced = store.get<Array<{ id: string; reason: string }>>(
      'habits',
      'surface_water_habit',
      [],
    ) ?? [];
    expect(surfaced.length).toBe(1);
    expect(surfaced[0].id).toContain('water:');
    expect(surfaced[0].reason).toContain('hydration drop');
  });

  it('lineage records every dispatched cross-module event', () => {
    events.emit('finance:reminder_set', {
      pattern_id: 'rent-1',
      due_at: 1_700_000_000_000,
      kind: 'bill',
      message: '',
      ts: 1_700_000_000_000,
    });
    events.emit('sleep:pacing_breach_detected', {
      severity: 'watch',
      run_length: 5,
      ts: 1_700_000_000_000,
    });
    const lineage = router.lineage();
    expect(lineage.length).toBeGreaterThanOrEqual(2);
    const sources = new Set(lineage.map((l: CrossModuleLineageEntry) => l.source));
    expect(sources.has('finance:reminder_set')).toBe(true);
    expect(sources.has('sleep:pacing_breach_detected')).toBe(true);
  });

  it('ttl drops stale events', () => {
    const seen: unknown[] = [];
    events.on('body:suggest_rest_check', (p) => seen.push(p));
    // The rule has ttlMs = 24h. Source ts 48h ago.
    events.emit('finance:spending_spike_detected', {
      amount: 100,
      baseline_median: 50,
      ratio: 2,
      ts: 1_700_000_000_000 - 48 * 60 * 60 * 1000,
    });
    expect(seen).toHaveLength(0);
  });

  it('reflect dedupes by id — same source event does not duplicate the entry', () => {
    events.emit('finance:reminder_set', {
      pattern_id: 'rent-1',
      due_at: 1_700_000_000_000,
      kind: 'bill',
      message: 'first',
      ts: 1_700_000_000_000,
    });
    events.emit('finance:reminder_set', {
      pattern_id: 'rent-1',
      due_at: 1_700_000_000_000,
      kind: 'bill',
      message: 'second',
      ts: 1_700_000_000_000,
    });
    const reflected = store.get<unknown[]>('admin', 'reflected', []) ?? [];
    expect(reflected).toHaveLength(1);
  });
});
