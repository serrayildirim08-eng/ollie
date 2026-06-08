/**
 * Brain capacity wiring · test
 *
 * Proves recomputeCapacity() reads the store keys the existing bridges
 * populate (sleep.records, mood.logs, dump.items) and writes shared.capacity
 * = { level, computedAt }. The scoring itself is unit-tested in
 * packages/logic/tests/brain.test.ts; here we prove the store plumbing.
 */

import { describe, expect, it } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { recomputeCapacity } from './capacity';

const NOW = new Date('2026-06-08T18:00:00').getTime();
const DAY = 86_400_000;

function freshStore() {
  return createStore(createMemoryAdapter());
}

describe('recomputeCapacity', () => {
  it('poor sleep + low mood + heavy day → low, written to shared.capacity', () => {
    const store = freshStore();
    store.set('sleep', 'records', [
      { night_of: '2026-06-07', tst_min: 4 * 60, quality: 1, created_at: NOW - DAY },
    ]);
    store.set('mood', 'logs', [{ kind: 'mood', ts: NOW - 1000, valence: -1 }]);
    // 6 dumps today → heavy load
    const items = Array.from({ length: 6 }, (_, i) => ({ ts: NOW - i * 1000 }));
    store.set('dump', 'items', items);

    const level = recomputeCapacity(store, NOW);
    expect(level).toBe('low');

    const cap = store.get<{ level: string; computedAt: number }>('shared', 'capacity', { level: 'x', computedAt: 0 });
    expect(cap.level).toBe('low');
    expect(cap.computedAt).toBe(NOW);
  });

  it('good sleep + high mood + light day → high', () => {
    const store = freshStore();
    store.set('sleep', 'records', [
      { night_of: '2026-06-07', tst_min: 8 * 60, quality: 5, created_at: NOW - DAY },
    ]);
    store.set('mood', 'logs', [{ kind: 'mood', ts: NOW - 1000, valence: 2 }]);
    store.set('dump', 'items', [{ ts: NOW - 1000 }]);

    expect(recomputeCapacity(store, NOW)).toBe('high');
  });

  it('no signals at all → medium (no judgement without data)', () => {
    const store = freshStore();
    expect(recomputeCapacity(store, NOW)).toBe('medium');
  });

  it('falls back to today\'s dump mood tag when no mood log in window', () => {
    const store = freshStore();
    store.set('mood', 'logs', []);
    // poor sleep + low dump-mood tag, light load → low
    store.set('sleep', 'records', [
      { night_of: '2026-06-07', tst_min: 5 * 60, quality: 2 },
    ]);
    store.set('dump', 'items', [{ ts: NOW - 1000, mood: 'low' }]);
    expect(recomputeCapacity(store, NOW)).toBe('low');
  });

  it('ignores a stale mood log older than 2 days', () => {
    const store = freshStore();
    store.set('mood', 'logs', [{ kind: 'mood', ts: NOW - 5 * DAY, valence: -3 }]);
    // only stale mood, nothing else → medium
    expect(recomputeCapacity(store, NOW)).toBe('medium');
  });
});
