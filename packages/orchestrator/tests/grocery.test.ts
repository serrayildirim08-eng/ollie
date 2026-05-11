/**
 * @ollie/orchestrator · grocery orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createGroceryOrchestrator } from '../src/grocery';
import type { GroceryPattern, PantryItem, ShoppingItem } from '@ollie/logic/grocery';

// Fixed wall-clock: 2026-05-09T12:00:00Z
const NOW = new Date('2026-05-09T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

describe('grocery orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createGroceryOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createGroceryOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('populates patterns slice after init when stockout cascade is present', () => {
    // 4 pantry entries of "milk" bought within 60 days → stockout-cascade
    const pantry: PantryItem[] = [
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 5 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 12 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 20 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 30 * DAY_MS, shelfLifeDays: 7 },
    ];
    store.set('grocery', 'pantry', pantry);

    orch.init();

    const patterns = store.get<GroceryPattern[]>('grocery', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns!.some((p) => p.pattern === 'grocery-stockout-cascade')).toBe(true);
  });

  it('writes patternsLastComputedAt on init', () => {
    store.set('grocery', 'items', [] as ShoppingItem[]);
    store.set('grocery', 'pantry', [] as PantryItem[]);

    orch.init();

    const ts = store.get<number>('grocery', 'patternsLastComputedAt', 0);
    expect(ts).toBe(NOW);
  });

  it('emits grocery:duplicate_detected when a bought item is already in pantry within shelf life', () => {
    const emitted: Array<{ name: string; days_since_purchase: number }> = [];
    const unsub = on('grocery:duplicate_detected', (p) => {
      emitted.push(p as { name: string; days_since_purchase: number });
    });

    // Pantry has eggs bought 2 days ago (shelf life 14 days → still fresh)
    const pantry: PantryItem[] = [
      { name: 'eggs', normalizedName: 'eggs', boughtTs: NOW - 2 * DAY_MS, shelfLifeDays: 14 },
    ];
    store.set('grocery', 'pantry', pantry);

    // Shopping list marks eggs as just bought
    const items: ShoppingItem[] = [
      { name: 'eggs', normalizedName: 'eggs', checked: true, boughtTs: NOW },
    ];
    store.set('grocery', 'items', items);

    orch.init();

    unsub();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].name).toBe('eggs');
    expect(emitted[0].days_since_purchase).toBeCloseTo(2, 0);
  });

  it('emits grocery:pattern_detected for a newly detected pattern', () => {
    const detected: string[] = [];
    const unsub = on('grocery:pattern_detected', (p) => {
      detected.push((p as { pattern: string }).pattern);
    });

    // 4 pantry milk entries → grocery-stockout-cascade fires as a new pattern
    const pantry: PantryItem[] = [
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 5 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 12 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 20 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 30 * DAY_MS, shelfLifeDays: 7 },
    ];
    store.set('grocery', 'pantry', pantry);

    orch.init();

    unsub();

    expect(detected).toContain('grocery-stockout-cascade');
  });

  it('does not re-emit grocery:pattern_detected for a pattern already in the store', () => {
    // Pre-seed patterns so grocery-stockout-cascade is already known.
    const existingPatterns: GroceryPattern[] = [
      {
        pattern: 'grocery-stockout-cascade',
        confidence: 'high',
        sample_n: 4,
        items: [{ name: 'milk', count: 4 }],
        name: 'milk',
        copy: 'you keep buying milk.',
        source: 'Wood & Neal 2007',
      },
    ];
    store.set('grocery', 'patterns', existingPatterns);

    const detected: string[] = [];
    const unsub = on('grocery:pattern_detected', (p) => {
      detected.push((p as { pattern: string }).pattern);
    });

    const pantry: PantryItem[] = [
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 5 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 12 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 20 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 30 * DAY_MS, shelfLifeDays: 7 },
    ];
    store.set('grocery', 'pantry', pantry);

    orch.init();

    unsub();

    expect(detected).not.toContain('grocery-stockout-cascade');
  });

  it('teardown stops subscriptions and prevents further recomputes', () => {
    store.set('grocery', 'items', [] as ShoppingItem[]);
    store.set('grocery', 'pantry', [] as PantryItem[]);

    orch.init();
    orch.teardown();

    // Overwrite patterns with a sentinel value after teardown.
    store.set('grocery', 'patterns', [] as GroceryPattern[]);

    // Mutate pantry — should NOT trigger a recompute.
    store.set('grocery', 'pantry', [
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 5 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 12 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 20 * DAY_MS, shelfLifeDays: 7 },
      { name: 'milk', normalizedName: 'milk', boughtTs: NOW - 30 * DAY_MS, shelfLifeDays: 7 },
    ] as PantryItem[]);

    // Sentinel empty array must remain — no recompute fired after teardown.
    const patterns = store.get<GroceryPattern[]>('grocery', 'patterns', []);
    expect(patterns).toHaveLength(0);
  });
});
