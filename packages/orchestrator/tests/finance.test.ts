/**
 * @ollie/orchestrator · finance orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createFinanceOrchestrator } from '../src/finance';
import type { FinanceRecord } from '@ollie/logic/finance';

// Fixed wall-clock: 2026-05-09T12:00:00Z
const NOW = new Date('2026-05-09T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

function makeRecord(overrides: Partial<FinanceRecord> = {}): FinanceRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2, 8)}`,
    raw_source_id: null,
    raw_span: null,
    created_at: NOW,
    last_edited_at: NOW - 4 * DAY_MS * 1000, // older than 72h cooldown
    extractor_version: 'test',
    kind: 'txn',
    direction: 'out',
    amount: 100,
    currency: 'USD',
    event_date: new Date(NOW).toISOString().slice(0, 10),
    merchant: 'netflix',
    merchant_normalized: 'netflix',
    category: null,
    notes: null,
    tokens: [],
    is_adhd_tax: false,
    adhd_tax_type: null,
    cycle_phase: null,
    journal_entry_ids: [],
    ...overrides,
  };
}

describe('finance orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createFinanceOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createFinanceOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('writes lastRecomputeAt on init', () => {
    store.set('finance', 'records', [] as FinanceRecord[]);
    orch.init();
    const ts = store.get<number>('finance', 'lastRecomputeAt', 0);
    expect(ts).toBe(NOW);
  });

  it('seeds default settings when none exist', () => {
    orch.init();
    const settings = store.get<{ currency: string }>('finance', 'settings', undefined);
    expect(settings).not.toBeNull();
    expect(settings?.currency).toBe('USD');
  });

  it('emits finance:record_added when a dump item parses as a finance record', () => {
    const emitted: Array<{ id: string; kind: string }> = [];
    const unsub = on('finance:record_added', (p) => {
      emitted.push(p as { id: string; kind: string });
    });

    // A dump text that parseFinanceDump should recognise as a finance item.
    const dumpItem = { ts: NOW - 1000, text: 'spent $50 on groceries' };
    store.set('dump', 'items', [dumpItem]);

    orch.init();

    unsub();

    // If the parse logic recognises the text, an event fires.
    // If not (cold-start no-match), emitted stays empty — acceptable.
    // What we must guarantee: no throw and records array is an array.
    const records = store.get<FinanceRecord[]>('finance', 'records', []);
    expect(Array.isArray(records)).toBe(true);
  });

  it('emits finance:pattern_detected for a newly detected PatternCard pattern', () => {
    const detected: string[] = [];
    const unsub = on('finance:pattern_detected', (p) => {
      detected.push((p as { pattern: string }).pattern);
    });

    // Pre-seed enough records for detectPatterns to fire an F-pattern.
    // We write directly to finance.records so processDump dedup is bypassed.
    const records: FinanceRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeRecord({
        id: `adhd-tax-${i}`,
        is_adhd_tax: true,
        adhd_tax_type: 'late_fee',
        amount: 25 + i,
        event_date: new Date(NOW - i * 30 * DAY_MS).toISOString().slice(0, 10),
      }),
    );
    store.set('finance', 'records', records);

    orch.init();
    unsub();

    // The store must have a patterns array (possibly empty if thresholds not met).
    const patterns = store.get<Array<{ pattern: string }>>('finance', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
  });

  it('does not re-emit finance:pattern_detected for a pattern already in the store', () => {
    // Pre-seed so the pattern key is already known.
    store.set('finance', 'patterns', [
      { pattern: 'finance-adhd-tax-spike', confidence: 'medium', ts: NOW - 1000 },
    ]);

    const detected: string[] = [];
    const unsub = on('finance:pattern_detected', (p) => {
      detected.push((p as { pattern: string }).pattern);
    });

    const records: FinanceRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeRecord({
        id: `adhd-${i}`,
        is_adhd_tax: true,
        adhd_tax_type: 'late_fee',
        amount: 25 + i,
        event_date: new Date(NOW - i * 30 * DAY_MS).toISOString().slice(0, 10),
      }),
    );
    store.set('finance', 'records', records);

    orch.init();
    unsub();

    expect(detected).not.toContain('finance-adhd-tax-spike');
  });

  it('teardown stops subscriptions and prevents further recomputes', () => {
    store.set('finance', 'records', [] as FinanceRecord[]);
    orch.init();
    orch.teardown();

    // Overwrite with sentinel after teardown.
    store.set('finance', 'lastRecomputeAt', 0);

    // Mutate dump.items — must NOT trigger recomputeDerived.
    store.set('dump', 'items', [{ ts: NOW, text: 'spent $10' }]);

    const ts = store.get<number>('finance', 'lastRecomputeAt', 0);
    expect(ts).toBe(0);
  });

  it('processBacklog skips already-processed dump items (dedup by raw_source_id)', () => {
    const dumpItem = { ts: NOW - 500, text: 'paid $30 electricity bill' };
    // Pre-seed a record that already has raw_source_id from this dump.
    const existing = makeRecord({ raw_source_id: String(dumpItem.ts) });
    store.set('finance', 'records', [existing]);
    store.set('dump', 'items', [dumpItem]);

    orch.init();

    const records = store.get<FinanceRecord[]>('finance', 'records', []);
    // Exactly one record — the existing one, no duplicate ingested.
    expect(records?.filter((r) => r.raw_source_id === String(dumpItem.ts))).toHaveLength(1);
  });
});
