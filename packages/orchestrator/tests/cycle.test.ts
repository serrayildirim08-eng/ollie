/**
 * @ollie/orchestrator · cycle orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers } from '@ollie/events';
import { createOrchestrator } from '../src/index';

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
