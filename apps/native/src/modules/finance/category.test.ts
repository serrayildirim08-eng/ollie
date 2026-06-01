/**
 * Finance category capture · round-trip + watcher proof.
 *
 * Proves the 2026-06-01 tap-to-log `category` field flows end-to-end:
 *   1. a category-carrying transaction projects into `finance.records` with
 *      its `category` intact (bridge mapping), and
 *   2. the category-keyed Layer-2 watcher (F4 hyperfocus-burst,
 *      packages/logic/src/finance/patterns.ts) can now SEE those categories —
 *      three "shopping" spends inside 48h surface a hyperfocus-burst card.
 *
 * Before this field existed every mirrored spend had category === null, so
 * the F4 detector (`if (!r.category) continue`) skipped every row and the
 * burst could never fire. This test is the "watcher now has data" guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import type { FinanceRecord, PatternCard } from '@ollie/logic/finance';

vi.mock('./migrate', () => ({
  migrateFinance: vi.fn().mockResolvedValue(undefined),
}));

// Three "shopping" spends inside a 48h window — F4 needs >= 3 same-category
// rows in <= 48h, then a 6h settle before `now`. T0 is the first; spends at
// +0h / +20h / +40h all land in-window; `now` = +60h clears the settle.
const { HOUR, T0 } = vi.hoisted(() => ({
  HOUR: 3_600_000,
  T0: new Date('2026-04-10T09:00:00Z').getTime(),
}));

vi.mock('./repo', () => ({
  transactions: {
    list: vi.fn().mockResolvedValue([
      { id: 'sx-1', amount: 40, currency: 'USD', merchant: 'sephora', category: 'shopping', occurredAt: T0 },
      { id: 'sx-2', amount: 22, currency: 'USD', merchant: 'zara', category: 'shopping', occurredAt: T0 + 20 * HOUR },
      { id: 'sx-3', amount: 31, currency: 'USD', merchant: 'target', category: 'shopping', occurredAt: T0 + 40 * HOUR },
    ]),
  },
  income: { list: vi.fn().mockResolvedValue([]) },
  refunds: { list: vi.fn().mockResolvedValue([]) },
  bills: { list: vi.fn().mockResolvedValue([]) },
  subscriptions: { list: vi.fn().mockResolvedValue([]) },
}));

import { syncToStore } from './bridge';

describe('finance category capture → watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips a tap-logged category into finance.records', async () => {
    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    const records = store.get<FinanceRecord[]>('finance', 'records', []);
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.category === 'shopping')).toBe(true);
    expect(records.every((r) => r.direction === 'out' && r.kind === 'spend')).toBe(true);
  });

  it('lets the category-keyed hyperfocus-burst watcher see categories', async () => {
    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    const { createFinanceOrchestrator } = await import('@ollie/orchestrator');
    const orch = createFinanceOrchestrator(store, {
      now: () => T0 + 60 * HOUR,
    }) as ReturnType<typeof createFinanceOrchestrator> & { recomputeDerived(): void };

    orch.recomputeDerived();

    const cards = store.get<PatternCard[]>('finance', 'patterns', []);
    const burst = cards.find((c) => c.pattern === 'hyperfocus-burst');
    expect(burst).toBeDefined();
    expect(burst?.category).toBe('shopping');
    expect(burst?.burst_count).toBeGreaterThanOrEqual(3);
  });
});
