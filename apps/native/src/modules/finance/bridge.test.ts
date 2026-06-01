/**
 * Finance bridge · the-great-rewiring proof.
 *
 * Proves the SQLite→store mirror feeds the finance Layer-2 watcher: after
 * syncToStore() projects mocked repo rows into `finance.records`, the real
 * finance orchestrator's recomputeDerived() runs over them and produces a
 * derived output (here: detectRecurring → `finance.recurring`). This is the
 * end-to-end "capture in SQLite → watcher notices" path that was dark.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import type { RecurringPattern } from '@ollie/logic/finance';

vi.mock('./migrate', () => ({
  migrateFinance: vi.fn().mockResolvedValue(undefined),
}));

// Three monthly "netflix" spends 30 days apart — enough for detectRecurring
// (minOccurrences default 3) to mature a recurring pattern.
// vi.hoisted: vi.mock factories are hoisted above normal `const`s, so the
// values they reference must be hoisted too (else "Cannot access 'T0' before
// initialization"). Both the factory below and the test body read these.
const { DAY, T0 } = vi.hoisted(() => ({
  DAY: 86_400_000,
  T0: new Date('2026-03-01T12:00:00Z').getTime(),
}));

vi.mock('./repo', () => ({
  transactions: {
    list: vi.fn().mockResolvedValue([
      { id: 'tx-1', amount: 15, currency: 'USD', merchant: 'netflix', occurredAt: T0 },
      { id: 'tx-2', amount: 15, currency: 'USD', merchant: 'netflix', occurredAt: T0 + 30 * DAY },
      { id: 'tx-3', amount: 15, currency: 'USD', merchant: 'netflix', occurredAt: T0 + 60 * DAY },
    ]),
  },
  income: { list: vi.fn().mockResolvedValue([]) },
  refunds: { list: vi.fn().mockResolvedValue([]) },
  bills: { list: vi.fn().mockResolvedValue([]) },
  subscriptions: { list: vi.fn().mockResolvedValue([]) },
}));

import { syncToStore } from './bridge';

describe('finance bridge → watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mirrors SQLite transactions into finance.records', async () => {
    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    const records = store.get<Array<{ merchant: string | null; kind?: string; direction: string }>>(
      'finance',
      'records',
      [],
    );
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.merchant === 'netflix')).toBe(true);
    expect(records.every((r) => r.direction === 'out' && r.kind === 'spend')).toBe(true);
  });

  it('lets the finance watcher detect a recurring pattern from mirrored data', async () => {
    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    // Dynamic import so the orchestrator picks up the already-populated store.
    const { createFinanceOrchestrator } = await import('@ollie/orchestrator');
    const orch = createFinanceOrchestrator(store, {
      now: () => T0 + 61 * DAY,
    }) as ReturnType<typeof createFinanceOrchestrator> & { recomputeDerived(): void };

    orch.recomputeDerived();

    const recurring = store.get<RecurringPattern[]>('finance', 'recurring', []);
    expect(recurring.length).toBeGreaterThan(0);
    expect(recurring.some((p) => p.merchant_normalized?.includes('netflix'))).toBe(true);
  });
});
