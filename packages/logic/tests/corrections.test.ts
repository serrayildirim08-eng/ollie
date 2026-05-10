import { describe, it, expect } from 'vitest';
import { corrections } from '../src/index';
import type { CorrectionEntry } from '../src/corrections';

const { record, match } = corrections;

const NOW = 1_700_000_000_000;

describe('corrections.record', () => {
  it('appends a fresh entry when none exists', () => {
    const next = record([], 'pay rent', 'finance', NOW);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      text: 'pay rent',
      preferredModule: 'finance',
      count: 1,
      ts: NOW,
    });
  });

  it('increments count on a near-duplicate same-module entry', () => {
    const after1 = record([], 'buy milk eggs bread', 'grocery', NOW);
    const after2 = record(after1, 'milk eggs bread', 'grocery', NOW + 1000);
    expect(after2).toHaveLength(1);
    expect(after2[0].count).toBe(2);
    expect(after2[0].ts).toBe(NOW + 1000);
  });

  it('keeps both entries when the preferred module differs', () => {
    const after1 = record([], 'buy milk eggs', 'grocery', NOW);
    const after2 = record(after1, 'buy milk eggs', 'pets', NOW + 1000);
    expect(after2).toHaveLength(2);
  });

  it('caps the array at 50 entries (drops oldest by ts)', () => {
    // Generate unique non-overlapping word tokens so dedup doesn't merge entries.
    const word = (i: number): string => {
      const letters: string[] = [];
      let x = i + 1;
      while (x > 0) {
        letters.push(String.fromCharCode(97 + ((x - 1) % 26)));
        x = Math.floor((x - 1) / 26);
      }
      return letters.reverse().join('') + 'xyz';
    };
    let arr: CorrectionEntry[] = [];
    for (let i = 0; i < 55; i++) {
      arr = record(arr, word(i), 'finance', NOW + i);
    }
    expect(arr).toHaveLength(50);
    const tsValues = new Set(arr.map((e) => e.ts));
    // The 5 oldest (i=0..4) should be gone, ts NOW..NOW+4 absent
    for (let i = 0; i < 5; i++) expect(tsValues.has(NOW + i)).toBe(false);
    // Newer ones present
    expect(tsValues.has(NOW + 54)).toBe(true);
  });

  it('rejects empty or whitespace-only text', () => {
    expect(record([], '', 'finance', NOW)).toEqual([]);
    expect(record([], '   ', 'finance', NOW)).toEqual([]);
    expect(record([], 'a b', 'finance', NOW)).toEqual([]); // no 3+ char tokens
  });

  it('handles non-array prev as empty', () => {
    expect(record(null, 'pay rent', 'finance', NOW)).toHaveLength(1);
    expect(record(undefined, 'pay rent', 'finance', NOW)).toHaveLength(1);
  });
});

describe('corrections.match', () => {
  it('returns null for empty corrections', () => {
    expect(match([], 'anything')).toBeNull();
    expect(match(null, 'anything')).toBeNull();
  });

  it('finds an entry that fuzzy-overlaps the dump text', () => {
    const list = record([], 'pay credit card bill', 'finance', NOW);
    const result = match(list, 'pay the card bill today');
    expect(result).not.toBeNull();
    expect(result?.preferredModule).toBe('finance');
  });

  it('prefers higher-count entries when scores tie', () => {
    let arr = record([], 'walk tontin pinpon', 'pets', NOW);
    arr = record(arr, 'walk tontin pinpon', 'pets', NOW + 1); // count → 2
    arr = record(arr, 'walk tontin pinpon errands', 'admin', NOW + 2);
    const result = match(arr, 'walk tontin pinpon today');
    expect(result?.preferredModule).toBe('pets');
  });

  it('returns null when nothing crosses the match threshold', () => {
    const arr = record([], 'pay rent today asap', 'finance', NOW);
    expect(match(arr, 'walk the dog')).toBeNull();
  });
});
