/**
 * @ollie/orchestrator · patterns orchestrator tests
 *
 * Seeds cycle + symptom + sleep + finance data and verifies that
 * cross-module patterns surface in the shared.patterns derived slice.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers } from '@ollie/events';
import { createPatternsOrchestrator } from '../src/patterns';

// Fixed epoch: 2026-05-11 noon UTC — matches suite-wide convention.
const FIXED_NOW = new Date('2026-05-11T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

// ── fixture helpers ──────────────────────────────────────────────────────────

/**
 * Build `n` closed cycles, each `lengthDays` long, ending before `now`.
 * Cycles are spaced tightly (one follows the other) so phase folding works.
 */
function makeCycles(
  now: number,
  n: number,
  lengthDays = 28,
): Array<{ cycleStartTs: number; cycleEndTs: number; cycleLengthDays: number }> {
  const cycles = [];
  let start = now - n * lengthDays * DAY_MS;
  for (let i = 0; i < n; i++) {
    const end = start + lengthDays * DAY_MS;
    cycles.push({ cycleStartTs: start, cycleEndTs: end, cycleLengthDays: lengthDays });
    start = end;
  }
  return cycles;
}

/**
 * Given cycles, build symptom events that cluster > 60 % in the luteal phase
 * across every cycle — enough to fire symptom_in_phase for the given tag.
 */
function makeLutealSymptoms(
  cycles: Array<{ cycleStartTs: number; cycleLengthDays: number }>,
  tag: string,
): Array<{ ts: number; text: string; action: string }> {
  const events: Array<{ ts: number; text: string; action: string }> = [];
  for (const c of cycles) {
    // Day 20 in a 28-day cycle = luteal phase (day > 28-13=15 && day > 28-18=10)
    const lutealDay = 20;
    const ts = c.cycleStartTs + (lutealDay - 1) * DAY_MS + 12 * 3_600_000;
    // 4 luteal events, 1 follicular event per cycle => 80% luteal share
    for (let j = 0; j < 4; j++) {
      events.push({ ts: ts + j * 3_600_000, text: tag, action: 'symptom' });
    }
    // follicular day — day 8 (between day 6 and day 10 in a 28-day cycle)
    const follDay = 8;
    const follTs = c.cycleStartTs + (follDay - 1) * DAY_MS + 12 * 3_600_000;
    events.push({ ts: follTs, text: tag, action: 'symptom' });
  }
  return events;
}

/**
 * Build sleep sessions (noon-epoch each day) with a clear pre-period TST drop
 * across all cycles — enough for sleep_cycle_lag (drop ≥ 30 min, 3+ cycles).
 */
function makeSleepWithPrePeriodDrop(
  cycles: Array<{ cycleStartTs: number; cycleLengthDays: number }>,
): Array<{ ts: number; tstMinutes: number }> {
  const sessions: Array<{ ts: number; tstMinutes: number }> = [];
  for (const c of cycles) {
    const L = c.cycleLengthDays;
    for (let d = 1; d <= L; d++) {
      const ts = c.cycleStartTs + (d - 1) * DAY_MS + 12 * 3_600_000;
      // Last 5 days: 360 min (6h). Rest: 480 min (8h). Delta = -120 min.
      const tstMinutes = d > L - 5 ? 360 : 480;
      sessions.push({ ts, tstMinutes });
    }
  }
  return sessions;
}

/**
 * Build finance transactions with higher luteal daily spend in a single
 * category across all cycles — enough for finance_cycle_spend.
 */
function makeFinanceTransactions(
  cycles: Array<{ cycleStartTs: number; cycleLengthDays: number }>,
): Array<{ ts: number; amount: number; direction: string; category: string }> {
  const txns: Array<{ ts: number; amount: number; direction: string; category: string }> = [];
  for (const c of cycles) {
    const L = c.cycleLengthDays;
    for (let d = 1; d <= L; d++) {
      const ts = c.cycleStartTs + (d - 1) * DAY_MS + 14 * 3_600_000;
      // Days > L-13 are luteal — spend 50, follicular (d <= L-18) spend 10.
      const amount = d > L - 13 ? 50 : 10;
      txns.push({ ts, amount, direction: 'expense', category: 'food' });
    }
  }
  return txns;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('patterns orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createPatternsOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    // Zero throttle so recompute fires immediately in tests.
    orch = createPatternsOrchestrator(store, { now: () => FIXED_NOW, throttleMs: 0 });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  // ── 1. cold start ──────────────────────────────────────────────────────────

  it('writes shared.patterns and patternsLastComputedAt on init() with no data', () => {
    orch.init();

    const ts = store.get<number>('shared', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);

    const patterns = store.get<unknown[]>('shared', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
    // No cycles → no cross-module patterns.
    expect(patterns).toHaveLength(0);
  });

  // ── 2. symptom_in_phase surfaces when cramps cluster in luteal ─────────────

  it('surfaces symptom_in_phase for cramps clustering in luteal phase', () => {
    const cycles = makeCycles(FIXED_NOW, 4, 28);
    const symptoms = makeLutealSymptoms(cycles, 'cramps');

    store.set('cycle', 'cycles', cycles);
    store.set('cycle', 'items', symptoms);

    orch.init();

    const patterns = store.get<Array<{ type: string; meta: { tag: string; phase: string } }>>(
      'shared', 'patterns', [],
    );
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    const crampsPattern = patterns.find((p) => p.type === 'symptom_in_phase' && p.meta.tag === 'cramps');
    expect(crampsPattern).toBeDefined();
    expect(crampsPattern!.meta.phase).toBe('luteal');
  });

  // ── 3. sleep_cycle_lag surfaces when TST drops pre-period ─────────────────

  it('surfaces sleep_cycle_lag when TST drops ≥30 min before period across 3+ cycles', () => {
    const cycles = makeCycles(FIXED_NOW, 4, 28);
    const sleepSessions = makeSleepWithPrePeriodDrop(cycles);

    store.set('cycle', 'cycles', cycles);
    // sleep.records format that the orchestrator reads.
    const records = sleepSessions.map((s) => {
      const d = new Date(s.ts);
      const nightOf = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      return { night_of: nightOf, tst_min: s.tstMinutes, is_skipped: false };
    });
    store.set('sleep', 'records', records);

    orch.init();

    const patterns = store.get<Array<{ type: string }>>(
      'shared', 'patterns', [],
    );
    const lagPattern = patterns.find((p) => p.type === 'sleep_cycle_lag');
    expect(lagPattern).toBeDefined();
  });

  // ── 4. finance_cycle_spend surfaces for higher luteal spend ───────────────

  it('surfaces finance_cycle_spend for elevated luteal spending in a category', () => {
    const cycles = makeCycles(FIXED_NOW, 4, 28);
    const transactions = makeFinanceTransactions(cycles);

    store.set('cycle', 'cycles', cycles);
    store.set('finance', 'records', transactions);

    orch.init();

    const patterns = store.get<Array<{ type: string; meta: { higherPhase: string } }>>(
      'shared', 'patterns', [],
    );
    const spendPattern = patterns.find((p) => p.type === 'finance_cycle_spend');
    expect(spendPattern).toBeDefined();
    expect(spendPattern!.meta.higherPhase).toBe('luteal');
  });

  // ── 5. recompute on upstream store change ─────────────────────────────────

  it('re-runs recompute when cycle.cycles key changes', () => {
    orch.init();

    // Initially no patterns (no cycles).
    const before = store.get<unknown[]>('shared', 'patterns', []);
    expect(before).toHaveLength(0);

    // Seed sufficient data and trigger via store write.
    const cycles = makeCycles(FIXED_NOW, 4, 28);
    const symptoms = makeLutealSymptoms(cycles, 'fatigue');
    store.set('cycle', 'items', symptoms);
    store.set('cycle', 'cycles', cycles); // triggers subscribeKey → schedule → recompute

    vi.advanceTimersByTime(50); // flush throttle (throttleMs=0 → 0ms delay)

    const after = store.get<Array<{ type: string }>>(
      'shared', 'patterns', [],
    );
    const found = after.find((p) => p.type === 'symptom_in_phase');
    expect(found).toBeDefined();
  });

  // ── 6. teardown stops further recomputes ──────────────────────────────────

  it('teardown() prevents further recomputes after called', () => {
    orch.init();
    orch.teardown();

    // Zero out the sentinel.
    store.set('shared', 'patternsLastComputedAt', 0 as never);

    // Write upstream data — subscriptions should be gone.
    const cycles = makeCycles(FIXED_NOW, 4, 28);
    store.set('cycle', 'cycles', cycles);
    vi.advanceTimersByTime(100);

    const ts = store.get<number>('shared', 'patternsLastComputedAt', 0);
    expect(ts).toBe(0);
  });
});
