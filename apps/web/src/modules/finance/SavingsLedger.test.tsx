/**
 * SavingsLedger + ADHDTaxCandidateChip · pure-helper unit tests
 *
 * The components themselves are thin store consumers (covered indirectly by
 * FinanceModule integration). These tests pin the pure selectors that decide
 * what surfaces — the load-bearing logic:
 *   - savingsLedgerTotal: tolerant sum
 *   - sortedLedgerEntries: newest-first, malformed dropped
 *   - pickADHDTaxChip: at most one, sparse, never auto_add / dismissed / confirmed
 */

import { describe, it, expect, vi } from 'vitest';

// FinanceModule imports `../../store`, which boots the full orchestrator at
// module load. We only want the pure helpers — stub the store out.
vi.mock('../../store', () => ({
  store: { get: () => undefined, set: () => {}, subscribe: () => () => {} },
  useStoreSlice: <T,>(_mod: string, _key: string, defaultValue: T) =>
    [defaultValue, () => {}] as [T, (v: T) => void],
  reminderScheduler: { add: () => {}, init: () => {} },
}));

import {
  savingsLedgerTotal,
  sortedLedgerEntries,
  pickADHDTaxChip,
  type SavingsLedgerEntry,
  type ADHDTaxCandidateSlice,
} from './FinanceModule';

// ─── savingsLedgerTotal ─────────────────────────────────────────────────────

describe('savingsLedgerTotal', () => {
  it('returns 0 for null / undefined / empty', () => {
    expect(savingsLedgerTotal(null)).toBe(0);
    expect(savingsLedgerTotal(undefined)).toBe(0);
    expect(savingsLedgerTotal([])).toBe(0);
  });

  it('sums positive amounts', () => {
    const entries: SavingsLedgerEntry[] = [
      { id: 'a', amount: 20, ts: 1 },
      { id: 'b', amount: 5.5, ts: 2 },
      { id: 'c', amount: 100, ts: 3 },
    ];
    expect(savingsLedgerTotal(entries)).toBe(125.5);
  });

  it('ignores malformed / non-positive / non-finite entries', () => {
    const entries = [
      { id: 'a', amount: 10, ts: 1 },
      { id: 'b', amount: -5, ts: 2 },
      { id: 'c', amount: 0, ts: 3 },
      { id: 'd', amount: Number.NaN, ts: 4 },
      { id: 'e', amount: Number.POSITIVE_INFINITY, ts: 5 },
      null,
      { id: 'f', ts: 6 },
    ] as unknown as SavingsLedgerEntry[];
    expect(savingsLedgerTotal(entries)).toBe(10);
  });
});

// ─── sortedLedgerEntries ────────────────────────────────────────────────────

describe('sortedLedgerEntries', () => {
  it('returns [] for non-array', () => {
    expect(sortedLedgerEntries(null)).toEqual([]);
    expect(sortedLedgerEntries(undefined)).toEqual([]);
  });

  it('sorts newest-first by ts', () => {
    const entries: SavingsLedgerEntry[] = [
      { id: 'old', amount: 1, ts: 100 },
      { id: 'new', amount: 1, ts: 300 },
      { id: 'mid', amount: 1, ts: 200 },
    ];
    expect(sortedLedgerEntries(entries).map((e) => e.id)).toEqual(['new', 'mid', 'old']);
  });

  it('drops entries with bad amount or ts', () => {
    const entries = [
      { id: 'ok', amount: 10, ts: 5 },
      { id: 'noamt', amount: 0, ts: 6 },
      { id: 'nots', amount: 10 },
      null,
    ] as unknown as SavingsLedgerEntry[];
    expect(sortedLedgerEntries(entries).map((e) => e.id)).toEqual(['ok']);
  });
});

// ─── pickADHDTaxChip ────────────────────────────────────────────────────────

function cand(over: Partial<ADHDTaxCandidateSlice> = {}): ADHDTaxCandidateSlice {
  return {
    id: 'c1',
    record_id: null,
    category: 'late_fee',
    confidence: 'medium',
    amount: 25,
    matched_phrase: 'late fee',
    copy: 'this looks like a late fee',
    auto_add: false,
    ts: 1000,
    ...over,
  };
}

describe('pickADHDTaxChip', () => {
  it('returns null for empty / non-array', () => {
    expect(pickADHDTaxChip(null, {}, {})).toBeNull();
    expect(pickADHDTaxChip([], {}, {})).toBeNull();
  });

  it('surfaces exactly one candidate, newest first', () => {
    const list = [
      cand({ id: 'a', ts: 100 }),
      cand({ id: 'c', ts: 300 }),
      cand({ id: 'b', ts: 200 }),
    ];
    const picked = pickADHDTaxChip(list, {}, {});
    expect(picked?.id).toBe('c');
  });

  it('skips auto_add candidates (already booked by orchestrator)', () => {
    const list = [cand({ id: 'auto', auto_add: true, ts: 500 }), cand({ id: 'ask', ts: 100 })];
    expect(pickADHDTaxChip(list, {}, {})?.id).toBe('ask');
  });

  it('skips dismissed candidates', () => {
    const list = [cand({ id: 'x', ts: 500 }), cand({ id: 'y', ts: 100 })];
    expect(pickADHDTaxChip(list, { x: Date.now() }, {})?.id).toBe('y');
  });

  it('skips confirmed candidates', () => {
    const list = [cand({ id: 'x', ts: 500 }), cand({ id: 'y', ts: 100 })];
    expect(pickADHDTaxChip(list, {}, { x: Date.now() })?.id).toBe('y');
  });

  it('returns null when every candidate is resolved', () => {
    const list = [cand({ id: 'x', ts: 500 }), cand({ id: 'y', auto_add: true })];
    expect(pickADHDTaxChip(list, { x: 1 }, {})).toBeNull();
  });

  it('tolerates malformed entries without an id', () => {
    const list = [{ ts: 1 }, cand({ id: 'real' })] as unknown as ADHDTaxCandidateSlice[];
    expect(pickADHDTaxChip(list, {}, {})?.id).toBe('real');
  });
});
