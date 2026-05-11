/**
 * @ollie/orchestrator · burhan — D1 wire tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import * as events from '@ollie/events';
import type { BurhanState } from '@ollie/logic/burhan';
import { createBurhanOrchestrator } from '../src/burhan';

describe('burhan orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createBurhanOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createBurhanOrchestrator(store);
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    events._clearAllHandlers();
  });

  function read(): BurhanState {
    return store.get<BurhanState>('burhan', 'state', { events: [] }) ?? { events: [] };
  }

  it('adds a flower on cycle:period_logged', () => {
    events.emit('cycle:period_logged', { ts: 1000, source: 'user' });
    const s = read();
    expect(s.events).toHaveLength(1);
    expect(s.events[0].type).toBe('flower');
    expect(s.events[0].source_module).toBe('cycle');
  });

  it('adds a fruit on finance:subscription_cancelled', () => {
    events.emit('finance:subscription_cancelled', { pattern_id: 'p1', merchant: 'Canva', ts: 2000 });
    expect(read().events[0]?.type).toBe('fruit');
  });

  it('adds a leaf on admin:appointment_completed (appointment kind)', () => {
    events.emit('admin:appointment_completed', { task_id: 't1', kind: 'appointment', ts: 3000 });
    expect(read().events[0]?.type).toBe('leaf');
  });

  it('adds a canopy_fruit on admin:appointment_completed with kind=doctor', () => {
    events.emit('admin:appointment_completed', { task_id: 't2', kind: 'doctor', ts: 4000 });
    expect(read().events[0]?.type).toBe('canopy_fruit');
  });

  it('adds a gold_leaf on finance:bill_paid_on_time', () => {
    events.emit('finance:bill_paid_on_time', { pattern_id: 'p2', merchant: 'Rent', ts: 5000 });
    expect(read().events[0]?.type).toBe('gold_leaf');
  });

  it('adds a canopy_fruit on body:doctor_visit_completed', () => {
    events.emit('body:doctor_visit_completed', { ts: 6000 });
    expect(read().events[0]?.type).toBe('canopy_fruit');
  });

  it('emits burhan:element_added when the tree grows', () => {
    const seen: unknown[] = [];
    events.on('burhan:element_added', (p) => seen.push(p));
    events.emit('cycle:period_logged', { ts: 7000, source: 'user' });
    expect(seen).toHaveLength(1);
    const p = seen[0] as { type: string; source_module: string };
    expect(p.type).toBe('flower');
    expect(p.source_module).toBe('cycle');
  });

  it('is idempotent — same period_logged ts produces one element', () => {
    events.emit('cycle:period_logged', { ts: 8000, source: 'user' });
    events.emit('cycle:period_logged', { ts: 8000, source: 'user' });
    events.emit('cycle:period_logged', { ts: 8000, source: 'user' });
    expect(read().events).toHaveLength(1);
  });

  it('constitutional · no decay ever shrinks the tree', () => {
    events.emit('cycle:period_logged', { ts: 100, source: 'user' });
    events.emit('finance:subscription_cancelled', { pattern_id: 'p3', merchant: 'X', ts: 200 });
    events.emit('admin:appointment_completed', { task_id: 't3', kind: 'doctor', ts: 300 });
    const before = read().events.length;
    expect(before).toBe(3);

    // Simulate the kind of "time passing" / "user inactivity" / "miss"
    // signals that other trackers use to decay state. None of these
    // should shrink the tree.
    events.emit('void:braindump:submitted', { v: 2, items: [], raw: '', ts: 999, idempotency_key: 'k', route_path: 'fallback' });
    events.emit('habits:drift', { habit_id: 'h1', drop_pct: 50, ts: 999 });
    events.emit('sleep:pacing_breach_detected', { severity: 'watch', run_length: 5, ts: 999 });

    expect(read().events).toHaveLength(before);
  });
});
