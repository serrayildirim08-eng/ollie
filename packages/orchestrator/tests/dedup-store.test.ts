/**
 * @ollie/orchestrator · dedup-store (appendCapped) tests
 *
 * Audit item #8: the store-persisted `_*EmittedIds` / `_predictionEmittedKeys`
 * dedup arrays grew forever. `appendCapped` bounds them.
 */

import { describe, it, expect } from 'vitest';
import { appendCapped, DEFAULT_DEDUP_CAP } from '../src/dedup-store';

describe('@ollie/orchestrator · appendCapped (audit #8)', () => {
  it('appends fresh keys onto existing', () => {
    expect(appendCapped(['a', 'b'], ['c'])).toEqual(['a', 'b', 'c']);
  });

  it('de-duplicates a fresh key already present', () => {
    expect(appendCapped(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('returns existing unchanged (capped) when fresh is empty', () => {
    expect(appendCapped(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('caps the result to the default cap, keeping the most recent', () => {
    const existing = Array.from({ length: DEFAULT_DEDUP_CAP }, (_, i) => `old${i}`);
    const fresh = ['new1', 'new2', 'new3'];
    const out = appendCapped(existing, fresh);
    expect(out).toHaveLength(DEFAULT_DEDUP_CAP);
    // Most recent survive.
    expect(out.at(-1)).toBe('new3');
    expect(out.at(-2)).toBe('new2');
    expect(out.at(-3)).toBe('new1');
    // Oldest keys were evicted.
    expect(out).not.toContain('old0');
    expect(out).not.toContain('old1');
    expect(out).not.toContain('old2');
  });

  it('caps an already-oversized existing array even with no fresh keys', () => {
    const existing = Array.from({ length: DEFAULT_DEDUP_CAP + 50 }, (_, i) => `k${i}`);
    const out = appendCapped(existing, []);
    expect(out).toHaveLength(DEFAULT_DEDUP_CAP);
    expect(out.at(-1)).toBe(`k${DEFAULT_DEDUP_CAP + 49}`);
  });

  it('honours an explicit cap', () => {
    const out = appendCapped(['a', 'b', 'c'], ['d', 'e'], 3);
    expect(out).toEqual(['c', 'd', 'e']);
  });

  it('does not grow unboundedly over many append rounds', () => {
    let arr: string[] = [];
    for (let round = 0; round < 1000; round++) {
      arr = appendCapped(arr, [`evt-${round}`]);
    }
    // 1000 distinct keys appended but the array never exceeds the cap.
    expect(arr.length).toBe(DEFAULT_DEDUP_CAP);
    expect(arr.at(-1)).toBe('evt-999');
  });
});
