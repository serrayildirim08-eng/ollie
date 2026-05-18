/**
 * Audit #3 — the orphan-cue telemetry bridge gives every previously
 * un-consumed cross-module cue a real, deterministic consumer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, emit } from '@ollie/events';
import {
  createOrphanCueBridge,
  appendCueTelemetry,
  BRIDGED_CUE_EVENTS,
  CUE_TELEMETRY_CAP,
  type CueTelemetryEntry,
} from '../src/orphan-cue-bridge';
import { createOrchestrator } from '../src/index';

describe('orphan-cue bridge', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
  });

  afterEach(() => {
    _clearAllHandlers();
  });

  it('records every bridged cue event into shared._cueTelemetry', () => {
    const bridge = createOrphanCueBridge(store, { now: () => 1000 });
    bridge.init();

    emit('pets:care_gap_detected', { pet_id: 'p1', task: 'walk', severity: 'high', days_since: 3 });
    emit('grocery:duplicate_detected', { name: 'milk', days_since_purchase: 1, ts: 2000 });
    emit('finance:recurring_candidate_detected', { merchant: 'gym', ts: 3000 });

    const log = store.get<CueTelemetryEntry[]>('shared', '_cueTelemetry', []) ?? [];
    expect(log).toHaveLength(3);
    expect(log[0].event).toBe('pets:care_gap_detected');
    // payload had no ts → falls back to injected clock.
    expect(log[0].ts).toBe(1000);
    // payload carried ts → that wins.
    expect(log[1].event).toBe('grocery:duplicate_detected');
    expect(log[1].ts).toBe(2000);
    expect(log[1].payload.name).toBe('milk');

    bridge.teardown();
  });

  it('every event in BRIDGED_CUE_EVENTS is actually consumed', () => {
    const bridge = createOrphanCueBridge(store, { now: () => 1 });
    bridge.init();
    for (const ev of BRIDGED_CUE_EVENTS) {
      emit(ev, { ts: 42 });
    }
    const log = store.get<CueTelemetryEntry[]>('shared', '_cueTelemetry', []) ?? [];
    expect(log).toHaveLength(BRIDGED_CUE_EVENTS.length);
    expect(new Set(log.map((e) => e.event))).toEqual(new Set(BRIDGED_CUE_EVENTS));
    bridge.teardown();
  });

  it('teardown() stops recording', () => {
    const bridge = createOrphanCueBridge(store);
    bridge.init();
    bridge.teardown();
    emit('journal:entries_added', { dump_ts: 1, count: 2, extractor: 'x' });
    expect(store.get('shared', '_cueTelemetry', [])).toEqual([]);
  });

  it('appendCueTelemetry caps the ring buffer at CUE_TELEMETRY_CAP', () => {
    for (let i = 0; i < CUE_TELEMETRY_CAP + 25; i++) {
      appendCueTelemetry(store, {
        event: 'notifications:delivered',
        ts: i,
        payload: { i },
      });
    }
    const log = store.get<CueTelemetryEntry[]>('shared', '_cueTelemetry', []) ?? [];
    expect(log).toHaveLength(CUE_TELEMETRY_CAP);
    // oldest evicted — newest kept (ring buffer, newest last).
    expect(log[log.length - 1].payload.i).toBe(CUE_TELEMETRY_CAP + 24);
  });

  it('createOrchestrator boots the bridge — orphan cues land without ad-hoc wiring', () => {
    const orch = createOrchestrator(store);
    orch.init();
    emit('medication:adherence_drift', { item_id: 'm1', name: 'sertraline', ratio: 0.6, ts: 99 });
    const log = store.get<CueTelemetryEntry[]>('shared', '_cueTelemetry', []) ?? [];
    expect(log.some((e) => e.event === 'medication:adherence_drift')).toBe(true);
    orch.teardown();
  });
});
