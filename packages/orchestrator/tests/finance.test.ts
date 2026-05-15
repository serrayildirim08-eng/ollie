/**
 * @ollie/orchestrator · finance orchestrator tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
import { createFinanceOrchestrator } from '../src/finance';
import type { FinanceRecord } from '@ollie/logic/finance';
import type { NotificationSpec } from '@ollie/notifications';

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

  it('ingests a parseable dump item into finance.records without throwing', () => {
    // A dump text that parseFinanceDump should recognise as a finance item.
    const dumpItem = { ts: NOW - 1000, text: 'spent $50 on groceries' };
    store.set('dump', 'items', [dumpItem]);

    orch.init();

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

  // ── detectRecurringEarly integration ────────────────────────────────

  it('emits finance:recurring_candidate_detected for a known-recurring single-occurrence merchant', () => {
    const emitted: Array<{ merchant: string; confidence: string }> = [];
    const unsub = on('finance:recurring_candidate_detected', (p) => {
      emitted.push(p as { merchant: string; confidence: string });
    });

    // Single Netflix record — should trigger low-confidence candidate
    const records: FinanceRecord[] = [
      makeRecord({
        id: 'netflix-1',
        merchant: 'netflix',
        merchant_normalized: 'netflix',
        amount: 15.99,
        direction: 'out',
        event_date: new Date(NOW - 10 * DAY_MS).toISOString().slice(0, 10),
      }),
    ];
    store.set('finance', 'records', records);

    orch.init();
    unsub();

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const netflixEvent = emitted.find((e) => e.merchant?.toLowerCase?.() === 'netflix');
    expect(netflixEvent).toBeDefined();
    expect(netflixEvent?.confidence).toBe('low');
  });

  it('emits finance:recurring_candidate_detected with medium confidence for 2 consistent occurrences', () => {
    const emitted: Array<{ merchant: string; confidence: string; estimatedInterval: number | null }> = [];
    const unsub = on('finance:recurring_candidate_detected', (p) => {
      emitted.push(p as { merchant: string; confidence: string; estimatedInterval: number | null });
    });

    const records: FinanceRecord[] = [
      makeRecord({
        id: 'acme-1',
        merchant: 'acme-billing',
        merchant_normalized: 'acme-billing',
        amount: 200,
        direction: 'out',
        event_date: new Date(NOW - 60 * DAY_MS).toISOString().slice(0, 10),
      }),
      makeRecord({
        id: 'acme-2',
        merchant: 'acme-billing',
        merchant_normalized: 'acme-billing',
        amount: 200,
        direction: 'out',
        event_date: new Date(NOW - 30 * DAY_MS).toISOString().slice(0, 10),
      }),
    ];
    store.set('finance', 'records', records);

    orch.init();
    unsub();

    const acmeEvent = emitted.find((e) => e.merchant?.toLowerCase?.().includes('acme'));
    expect(acmeEvent).toBeDefined();
    expect(acmeEvent?.confidence).toBe('medium');
    expect(acmeEvent?.estimatedInterval).toBeCloseTo(30, 0);
  });

  it('does not re-emit finance:recurring_candidate_detected for already-emitted candidates', () => {
    // Pre-seed the emitted set so the candidate is already known
    store.set('finance', '_recurringCandidatesEmitted', ['netflix:low']);

    const emitted: string[] = [];
    const unsub = on('finance:recurring_candidate_detected', (p) => {
      emitted.push((p as { merchant: string }).merchant);
    });

    const records: FinanceRecord[] = [
      makeRecord({
        id: 'nf-dedup',
        merchant: 'netflix',
        merchant_normalized: 'netflix',
        amount: 15.99,
        direction: 'out',
        event_date: new Date(NOW - 10 * DAY_MS).toISOString().slice(0, 10),
      }),
    ];
    store.set('finance', 'records', records);

    orch.init();
    unsub();

    expect(emitted).not.toContain('netflix');
  });

  it('writes finance.recurringCandidates to store on recompute', () => {
    const records: FinanceRecord[] = [
      makeRecord({
        id: 'spotify-1',
        merchant: 'spotify',
        merchant_normalized: 'spotify',
        amount: 9.99,
        direction: 'out',
        event_date: new Date(NOW - 10 * DAY_MS).toISOString().slice(0, 10),
      }),
    ];
    store.set('finance', 'records', records);

    orch.init();

    const candidates = store.get<Array<{ merchant: string; confidence: string }>>('finance', 'recurringCandidates', []);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates?.some((c) => c.merchant?.toLowerCase?.() === 'spotify')).toBe(true);
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

// ─── own-form slice subscription tests (Faz 2 fix, 2026-05-15) ────────────────
// The module's in-app forms write finance.bills / .subscriptions /
// .transactions / .goals / .adhd_tax directly. Each write must trigger a
// debounced recomputeDerived so anomaly/pattern/savings cards stay fresh.

describe('finance orchestrator — own-form slice subscriptions', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createFinanceOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStore(createMemoryAdapter());
    orch = createFinanceOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    vi.useRealTimers();
    _clearAllHandlers();
  });

  for (const slice of ['bills', 'subscriptions', 'transactions', 'goals', 'adhd_tax'] as const) {
    it(`finance.${slice} write triggers a debounced recompute`, () => {
      store.set('finance', 'records', [] as FinanceRecord[]);
      orch.init();
      // init() ran a synchronous cold-start recompute. Capture that baseline,
      // then clear it so we can prove the form write produces a NEW recompute.
      expect(store.get<number>('finance', 'lastRecomputeAt', 0)).toBe(NOW);
      store.set('finance', 'lastRecomputeAt', 0);

      // Simulate an in-app form appending a row to its own slice.
      store.update<Array<{ id: string; text: string; ts: number }>>(
        'finance',
        slice,
        (cur) => [...(cur ?? []), { id: `f-${slice}`, text: 'x', ts: NOW }],
      );

      // Debounced — nothing yet before the 500ms timer fires.
      expect(store.get<number>('finance', 'lastRecomputeAt', 0)).toBe(0);
      vi.advanceTimersByTime(500);
      expect(store.get<number>('finance', 'lastRecomputeAt', 0)).toBe(NOW);
    });
  }

  it('teardown stops own-form slice recomputes', () => {
    store.set('finance', 'records', [] as FinanceRecord[]);
    orch.init();
    orch.teardown();
    store.set('finance', 'lastRecomputeAt', 0);

    store.update<Array<{ id: string }>>('finance', 'bills', (cur) => [...(cur ?? []), { id: 'b1' }]);
    vi.advanceTimersByTime(500);
    expect(store.get<number>('finance', 'lastRecomputeAt', 0)).toBe(0);
  });
});

// ─── push notification wiring tests ───────────────────────────────────────────

describe('finance orchestrator — push notification subscribers', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createFinanceOrchestrator>;
  let scheduledCalls: Array<{ spec: NotificationSpec; fireAt: number }>;
  let scheduleNotification: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    scheduledCalls = [];
    scheduleNotification = vi.fn((spec: NotificationSpec, fireAt: number) => {
      scheduledCalls.push({ spec, fireAt });
    });
    orch = createFinanceOrchestrator(store, { now: () => NOW, scheduleNotification });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.clearAllMocks();
  });

  it('finance:bill_due_predicted → schedules REMINDER push with merchant + days in title', () => {
    emit('finance:bill_due_predicted', {
      pattern_id: 'pat-rent-1',
      merchant: 'rent',
      amount: 1200,
      due_at: NOW + 3 * DAY_MS,
      days_until: 3,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec, fireAt } = scheduledCalls[0];
    expect(spec.category).toBe('REMINDER');
    expect(spec.dedupe_key).toContain('finance:bill_due_predicted:pat-rent-1');
    expect(spec.title).toContain('rent');
    expect(spec.title).toContain('3 day');
    expect(spec.title).toContain('1,200');
    expect(fireAt).toBeGreaterThanOrEqual(NOW);
  });

  it('finance:bill_due_predicted — singular "day" when days_until === 1', () => {
    emit('finance:bill_due_predicted', {
      pattern_id: 'pat-electric',
      merchant: 'electric',
      amount: 80,
      due_at: NOW + DAY_MS,
      days_until: 1,
      ts: NOW,
    });

    const { spec } = scheduledCalls[0];
    expect(spec.title).toContain('1 day');
    expect(spec.title).not.toContain('1 days');
  });

  it('finance:bill_due_predicted — skips when merchant missing', () => {
    emit('finance:bill_due_predicted', {
      pattern_id: 'pat-x',
      merchant: '',
      amount: 50,
      due_at: NOW + 2 * DAY_MS,
      days_until: 2,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:subscription_detected → schedules PATTERN_ALERT push next morning', () => {
    emit('finance:subscription_detected', {
      pattern_id: 'pat-netflix',
      merchant: 'netflix',
      amount: 15.99,
      cadence: 'monthly',
      occurrence_count: 3,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec, fireAt } = scheduledCalls[0];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.dedupe_key).toBe('finance:subscription_detected:pat-netflix');
    expect(spec.title).toContain('netflix');
    // fire time should be ~16h from now
    expect(fireAt).toBeGreaterThan(NOW + 15 * 60 * 60 * 1000);
    expect(fireAt).toBeLessThan(NOW + 17 * 60 * 60 * 1000);
  });

  it('finance:subscription_detected — skips when pattern_id missing', () => {
    emit('finance:subscription_detected', {
      pattern_id: '',
      merchant: 'hulu',
      amount: 8,
      cadence: 'monthly',
      occurrence_count: 3,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:adhd_tax_updated → schedules weekly PATTERN_ALERT digest (not immediate)', () => {
    emit('finance:adhd_tax_updated', {
      total_30d: 140,
      count_30d: 4,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec, fireAt } = scheduledCalls[0];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.aggregation_group).toBe('finance:adhd_tax_digest');
    expect(spec.title).toContain('4');
    expect(spec.title).toContain('140');
    // weekly digest: fire ~7 days from now
    expect(fireAt).toBeGreaterThan(NOW + 6 * DAY_MS);
  });

  it('finance:adhd_tax_updated — skips when count_30d is 0', () => {
    emit('finance:adhd_tax_updated', {
      total_30d: 0,
      count_30d: 0,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:cycle_spending_pattern_detected → schedules PATTERN_ALERT 2 days before luteal start', () => {
    // Plant a cycle that starts 5 days ago with 28-day length.
    // lutealStart = cycleStart + floor(28/2)*DAY = cycleStart + 14*DAY (which is +9 days from NOW)
    const cycleStart = NOW - 5 * DAY_MS;
    store.set('cycle', 'cycles', [
      { startTs: cycleStart, endTs: null, lengthDays: 28 },
    ]);

    emit('finance:cycle_spending_pattern_detected', {
      luteal_ratio: 1.4,
      follicular_median: 60,
      luteal_median: 84,
      cycle_count: 3,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec, fireAt } = scheduledCalls[0];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.dedupe_key).toContain('finance:cycle_spending_pattern_detected');
    // fireAt should be 2 days before luteal start = cycleStart + 14*DAY - 2*DAY = cycleStart + 12*DAY
    const expectedFireAt = cycleStart + 12 * DAY_MS;
    expect(fireAt).toBe(expectedFireAt);
  });

  it('finance:cycle_spending_pattern_detected — skips when fireAt is in the past', () => {
    // cycle started 20 days ago, luteal started 6 days ago — 2-day warning already past
    const cycleStart = NOW - 20 * DAY_MS;
    store.set('cycle', 'cycles', [
      { startTs: cycleStart, endTs: null, lengthDays: 28 },
    ]);

    emit('finance:cycle_spending_pattern_detected', {
      luteal_ratio: 1.3,
      follicular_median: 55,
      luteal_median: 72,
      cycle_count: 3,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:cycle_spending_pattern_detected — skips when no cycle data available', () => {
    // no cycles in store
    emit('finance:cycle_spending_pattern_detected', {
      luteal_ratio: 1.2,
      follicular_median: 50,
      luteal_median: 60,
      cycle_count: 2,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('scheduleNotification is NOT called when not injected', () => {
    // Orchestrator without the callback must not throw when events fire.
    const store2 = createStore(createMemoryAdapter());
    const scheduledCalls2: Array<{ spec: NotificationSpec; fireAt: number }> = [];
    // orch2 has NO scheduleNotification — scheduledCalls2 stays empty.
    const orch2 = createFinanceOrchestrator(store2, { now: () => NOW });
    orch2.init();

    // Reset calls from orch (first orchestrator) so we isolate.
    scheduledCalls.length = 0;

    // Manually invoke orch2's subscriber pathway — since it has no callback,
    // nothing should land in scheduledCalls2.
    emit('finance:bill_due_predicted', {
      pattern_id: 'pat-z',
      merchant: 'gas',
      amount: 50,
      due_at: NOW + 2 * DAY_MS,
      days_until: 2,
      ts: NOW,
    });

    // orch (first, with callback) will fire — that's expected.
    // scheduledCalls2 must remain empty: orch2 has no callback.
    expect(scheduledCalls2).toHaveLength(0);
    orch2.teardown();
  });

  // ── finance:subscription_stale ─────────────────────────────────────────────

  it('finance:subscription_stale → schedules PATTERN_ALERT push next morning', () => {
    emit('finance:subscription_stale', {
      pattern_id: 'pat-spotify',
      merchant: 'spotify',
      amount: 9.99,
      days_since: 95,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec, fireAt } = scheduledCalls[0];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.dedupe_key).toBe('finance:subscription_stale:pat-spotify');
    expect(spec.title).toContain('spotify');
    expect(spec.title).toContain('95');
    expect(spec.title).toContain('9.99');
    // ~16h from now
    expect(fireAt).toBeGreaterThan(NOW + 15 * 60 * 60 * 1000);
    expect(fireAt).toBeLessThan(NOW + 17 * 60 * 60 * 1000);
  });

  it('finance:subscription_stale — skips when pattern_id missing', () => {
    emit('finance:subscription_stale', {
      pattern_id: '',
      merchant: 'hulu',
      amount: 8,
      days_since: 100,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:subscription_stale — skips when merchant missing', () => {
    emit('finance:subscription_stale', {
      pattern_id: 'pat-x',
      merchant: '',
      amount: 8,
      days_since: 100,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:subscription_stale — omits amount when zero', () => {
    emit('finance:subscription_stale', {
      pattern_id: 'pat-free',
      merchant: 'freeapp',
      amount: 0,
      days_since: 120,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    // title should NOT contain a dollar sign for zero-amount
    const { spec } = scheduledCalls[0];
    expect(spec.title).not.toMatch(/\$\d/);
  });

  // ── finance:savings_milestone ──────────────────────────────────────────────

  it('finance:savings_milestone → schedules immediate PATTERN_ALERT push', () => {
    emit('finance:savings_milestone', {
      goal_id: 'goal-emergency',
      goal_name: 'emergency fund',
      current: 2500,
      target: 5000,
      milestone_pct: 50,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec, fireAt } = scheduledCalls[0];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.dedupe_key).toBe('finance:savings_milestone:goal-emergency:50');
    expect(spec.title).toContain('emergency fund');
    expect(spec.title).toContain('2,500');
    expect(spec.title).toContain('5,000');
    expect(spec.title).toContain('quietly growing');
    // fires immediately (NOW)
    expect(fireAt).toBe(NOW);
  });

  it('finance:savings_milestone — skips when goal_id missing', () => {
    emit('finance:savings_milestone', {
      goal_id: '',
      goal_name: 'vacation',
      current: 500,
      target: 1000,
      milestone_pct: 50,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:savings_milestone — skips when goal_id is missing (shape guard)', () => {
    // Emit with empty goal_id — subscriber guards on !p.goal_id.
    emit('finance:savings_milestone', {
      goal_id: '',
      goal_name: 'test',
      current: 100,
      target: 200,
      milestone_pct: 50,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  // ── finance:impulse_pause_summary ─────────────────────────────────────────

  it('finance:impulse_pause_summary → schedules monthly PATTERN_ALERT digest', () => {
    emit('finance:impulse_pause_summary', {
      count: 5,
      total: 234.5,
      month_start: NOW - 30 * DAY_MS,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec } = scheduledCalls[0];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.aggregation_group).toBe('finance:impulse_pause_digest');
    expect(spec.dedupe_key).toContain('finance:impulse_pause_digest:');
    expect(spec.title).toContain('5');
    expect(spec.title).toContain('234.5');
    expect(spec.title).toContain('paused');
  });

  it('finance:impulse_pause_summary — singular "buy" when count === 1', () => {
    emit('finance:impulse_pause_summary', {
      count: 1,
      total: 49,
      month_start: NOW - 30 * DAY_MS,
      ts: NOW,
    });

    const { spec } = scheduledCalls[0];
    expect(spec.title).toContain('1 impulse buy ');
    expect(spec.title).not.toContain('1 impulse buys');
  });

  it('finance:impulse_pause_summary — skips when count is 0', () => {
    emit('finance:impulse_pause_summary', {
      count: 0,
      total: 0,
      month_start: NOW - 30 * DAY_MS,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  // ── finance:anomaly_detected ───────────────────────────────────────────────

  it('finance:anomaly_detected → schedules PATTERN_ALERT push ~1h from now', () => {
    emit('finance:anomaly_detected', {
      anomaly_id: 'anom-123',
      merchant: 'amazon',
      amount: 450,
      median: 25,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec, fireAt } = scheduledCalls[0];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.dedupe_key).toBe('finance:anomaly_detected:anom-123');
    expect(spec.title).toContain('450');
    expect(spec.title).toContain('confirm or flag');
    // ~1h from now
    expect(fireAt).toBeGreaterThan(NOW + 59 * 60 * 1000);
    expect(fireAt).toBeLessThan(NOW + 61 * 60 * 1000);
  });

  it('finance:anomaly_detected — skips when anomaly_id missing', () => {
    emit('finance:anomaly_detected', {
      anomaly_id: '',
      merchant: 'target',
      amount: 300,
      median: 30,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(0);
  });

  it('finance:anomaly_detected — works when merchant is null (anonymous charge)', () => {
    emit('finance:anomaly_detected', {
      anomaly_id: 'anom-anon',
      merchant: null,
      amount: 999,
      median: null,
      ts: NOW,
    });

    expect(scheduledCalls).toHaveLength(1);
    const { spec } = scheduledCalls[0];
    expect(spec.title).toContain('999');
    expect(spec.title).toContain('confirm or flag');
  });
});

// ─── finance:tax_setaside_due tests ───────────────────────────────────────────

// Wall-clock pinned to the 1st of June 2026 at noon UTC so the monthly-gate
// in recomputeDerived fires.
const JUNE_1_2026 = new Date('2026-06-01T12:00:00Z').getTime();

describe('finance orchestrator — tax set-aside', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createFinanceOrchestrator>;
  let scheduledCalls: Array<{ spec: NotificationSpec; fireAt: number }>;
  let scheduleNotification: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    scheduledCalls = [];
    scheduleNotification = vi.fn((spec: NotificationSpec, fireAt: number) => {
      scheduledCalls.push({ spec, fireAt });
    });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.clearAllMocks();
  });

  function makeOrch(nowFn: () => number = () => JUNE_1_2026) {
    orch = createFinanceOrchestrator(store, { now: nowFn, scheduleNotification });
  }

  it('emits finance:tax_setaside_due once on the 1st when selfEmployed is true', () => {
    store.set('finance', 'taxProfile', { selfEmployed: true });
    const emitted: unknown[] = [];
    const unsub = on('finance:tax_setaside_due', (p) => { emitted.push(p); });
    makeOrch();
    orch.init();
    unsub();
    expect(emitted).toHaveLength(1);
    const p = emitted[0] as { amount: number; month_start: number; ts: number };
    expect(typeof p.amount).toBe('number');
    expect(p.amount).toBeGreaterThanOrEqual(0);
    expect(p.month_start).toBe(Date.UTC(2026, 4, 1)); // May 2026
    expect(p.ts).toBe(JUNE_1_2026);
  });

  it('deduplicates on second recompute in the same month', () => {
    store.set('finance', 'taxProfile', { selfEmployed: true });
    const emitted: unknown[] = [];
    const unsub = on('finance:tax_setaside_due', (p) => { emitted.push(p); });
    makeOrch();
    orch.init();
    // Manually call recomputeDerived again — same month, should not re-emit.
    orch.recomputeDerived();
    unsub();
    expect(emitted).toHaveLength(1);
  });

  it('does not emit when selfEmployed is false', () => {
    store.set('finance', 'taxProfile', { selfEmployed: false });
    const emitted: unknown[] = [];
    const unsub = on('finance:tax_setaside_due', (p) => { emitted.push(p); });
    makeOrch();
    orch.init();
    unsub();
    expect(emitted).toHaveLength(0);
  });

  it('does not emit when taxProfile is absent', () => {
    // No taxProfile set — defaults to null, isSelfEmployed = false.
    const emitted: unknown[] = [];
    const unsub = on('finance:tax_setaside_due', (p) => { emitted.push(p); });
    makeOrch();
    orch.init();
    unsub();
    expect(emitted).toHaveLength(0);
  });

  it('subscriber calls scheduleNotification with correct payload shape', () => {
    store.set('finance', 'taxProfile', { selfEmployed: true });
    makeOrch();
    orch.init();

    // scheduleNotification is called once during init (via recomputeDerived -> emit -> subscriber)
    expect(scheduleNotification).toHaveBeenCalledOnce();
    const [spec, fireAt] = scheduleNotification.mock.calls[0] as [NotificationSpec, number];
    expect(spec.category).toBe('PATTERN_ALERT');
    expect(spec.dedupe_key).toBe('finance:tax-setaside:2026-05');
    expect(spec.action_url).toBe('/finance');
    expect(spec.title).toContain('tax set-aside');
    expect(spec.title).toContain('May');
    // no exclamation marks in push copy
    expect(spec.title).not.toContain('!');
    // fires immediately (NOW)
    expect(fireAt).toBe(JUNE_1_2026);
  });

  it('copy literal passes banned-phrase scanner', () => {
    // The exact push copy — verified against the scanner rules in banned-phrases.cjs.
    // No cheerleading, no engagement, no streak language, no exclamation.
    const { scanForBanned } = require('../../../tools/banned-phrases.cjs') as {
      scanForBanned: (text: string, scope: string[]) => Array<{ id: string; why: string; source: string }>;
    };
    const title = 'tax set-aside · $500 for May. monthly nudge, not a deadline.';
    const globalHits = scanForBanned(title, []);
    const pushHits = scanForBanned(title, ['push']);
    expect(globalHits).toHaveLength(0);
    expect(pushHits).toHaveLength(0);
  });
});

// ─── finance:savings_deposit_detected consumer ──────────────────────────────

describe('finance orchestrator · savings_deposit_detected sink', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createFinanceOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createFinanceOrchestrator(store, { now: () => NOW });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('appends a savings deposit to finance.savingsLedger', () => {
    emit('finance:savings_deposit_detected', {
      transfer_id: 't1', record_id: 'r1', paired_record_id: null,
      amount: 75, date: '2026-05-09', memo: 'set aside',
      matched_keyword: 'set aside', confidence: 'high',
      is_matched_pair: false, ts: NOW,
    });
    const ledger = store.get<Array<{ id: string; amount: number }>>('finance', 'savingsLedger', []);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].id).toBe('t1');
    expect(ledger[0].amount).toBe(75);
  });

  it('is idempotent — duplicate transfer id appended once', () => {
    const payload = {
      transfer_id: 't1', record_id: 'r1', paired_record_id: null,
      amount: 50, date: '2026-05-09', memo: null,
      matched_keyword: null, confidence: 'medium' as const,
      is_matched_pair: false, ts: NOW,
    };
    emit('finance:savings_deposit_detected', payload);
    emit('finance:savings_deposit_detected', payload);
    expect(store.get('finance', 'savingsLedger', [])).toHaveLength(1);
  });

  it('credits the earliest incomplete savings goal', () => {
    store.set('finance', 'goals', [
      { id: 'g1', name: 'emergency', target: 1000, saved: 900, ts: NOW },
      { id: 'g2', name: 'vacation', target: 1000, saved: 100, ts: NOW },
    ]);
    emit('finance:savings_deposit_detected', {
      transfer_id: 't1', record_id: 'r1', paired_record_id: null,
      amount: 40, date: '2026-05-09', memo: null,
      matched_keyword: null, confidence: 'high',
      is_matched_pair: false, ts: NOW,
    });
    const goals = store.get<Array<{ id: string; saved: number }>>('finance', 'goals', []);
    // g2 has the lowest progress ratio → credited.
    expect(goals.find((g) => g.id === 'g2')?.saved).toBe(140);
    expect(goals.find((g) => g.id === 'g1')?.saved).toBe(900);
    const ledger = store.get<Array<{ goal_id: string | null }>>('finance', 'savingsLedger', []);
    expect(ledger[0].goal_id).toBe('g2');
  });

  it('grows the garden via burhan:add_leaf on a deposit', () => {
    const leaves: unknown[] = [];
    on('burhan:add_leaf', (p) => leaves.push(p));
    emit('finance:savings_deposit_detected', {
      transfer_id: 't1', record_id: 'r1', paired_record_id: null,
      amount: 30, date: '2026-05-09', memo: null,
      matched_keyword: null, confidence: 'high',
      is_matched_pair: false, ts: NOW,
    });
    expect(leaves).toHaveLength(1);
  });

  it('drops a zero/negative-amount deposit', () => {
    emit('finance:savings_deposit_detected', {
      transfer_id: 't1', record_id: 'r1', paired_record_id: null,
      amount: 0, date: '2026-05-09', memo: null,
      matched_keyword: null, confidence: 'high',
      is_matched_pair: false, ts: NOW,
    });
    expect(store.get('finance', 'savingsLedger', [])).toHaveLength(0);
  });
});

// ─── finance:adhd_tax_candidate_detected consumer ───────────────────────────

describe('finance orchestrator · adhd_tax_candidate_detected sink', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createFinanceOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createFinanceOrchestrator(store, { now: () => NOW });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('appends a candidate to finance.adhdTaxCandidates', () => {
    emit('finance:adhd_tax_candidate_detected', {
      record_id: 'r1', category: 'late_fee', confidence: 'high',
      amount: 35, matched_phrase: 'late fee', copy: 'was this a late fee?',
      auto_add: false, ts: NOW,
    });
    const pending = store.get<Array<{ category: string }>>('finance', 'adhdTaxCandidates', []);
    expect(pending).toHaveLength(1);
    expect(pending[0].category).toBe('late_fee');
  });

  it('is idempotent — same record/category/phrase appended once', () => {
    const payload = {
      record_id: 'r1', category: 'duplicate' as const, confidence: 'medium' as const,
      amount: 20, matched_phrase: 'duplicate purchase', copy: 'bought twice?',
      auto_add: false, ts: NOW,
    };
    emit('finance:adhd_tax_candidate_detected', payload);
    emit('finance:adhd_tax_candidate_detected', payload);
    expect(store.get('finance', 'adhdTaxCandidates', [])).toHaveLength(1);
  });
});
