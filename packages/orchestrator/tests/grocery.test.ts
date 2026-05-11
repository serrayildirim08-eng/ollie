/**
 * @ollie/orchestrator · grocery orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
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

  // ─── Sprint 3 / D4 · cycle → grocery auto-routing ───────────────────────
  describe('D4 · cycle:period_logged → auto-add period products', () => {
    it('adds 3 generic period products when no preferences set', () => {
      orch.init();
      emit('cycle:period_logged', { ts: NOW, source: 'user' });
      const items = store.get<ShoppingItem[]>('grocery', 'items', []) ?? [];
      const periodItems = items.filter((i) => (i as { category?: string }).category === 'period_products');
      expect(periodItems).toHaveLength(3);
      const names = periodItems.map((i) => i.name);
      expect(names).toEqual(expect.arrayContaining(['tampons', 'pads', 'liners']));
    });

    it('uses user preferences from shared.settings.period_products', () => {
      store.set('shared', 'settings', {
        period_products: [
          { name: 'organyc super', normalizedName: 'tampons' },
          { name: 'natracare regular' },
        ],
      });
      orch.init();
      emit('cycle:period_logged', { ts: NOW, source: 'user' });
      const items = store.get<ShoppingItem[]>('grocery', 'items', []) ?? [];
      const periodItems = items.filter((i) => (i as { category?: string }).category === 'period_products');
      expect(periodItems).toHaveLength(2);
      expect(periodItems[0].name).toBe('organyc super');
    });

    it('stamps shelf=watching and source=auto-added on the items', () => {
      orch.init();
      emit('cycle:period_logged', { ts: NOW, source: 'user' });
      const items = store.get<ShoppingItem[]>('grocery', 'items', []) ?? [];
      const it = items.find((i) => (i as { category?: string }).category === 'period_products') as {
        shelf?: string;
        auto_added_source?: string;
        auto_added_source_event?: string;
        auto_added_at?: number;
      };
      expect(it.shelf).toBe('watching');
      expect(it.auto_added_source).toBe('period log');
      expect(it.auto_added_source_event).toBe('cycle:period_logged');
      expect(typeof it.auto_added_at).toBe('number');
    });

    it('is idempotent — same period ts does not duplicate items', () => {
      orch.init();
      emit('cycle:period_logged', { ts: NOW, source: 'user' });
      emit('cycle:period_logged', { ts: NOW, source: 'user' });
      const items = store.get<ShoppingItem[]>('grocery', 'items', []) ?? [];
      const periodItems = items.filter((i) => (i as { category?: string }).category === 'period_products');
      expect(periodItems).toHaveLength(3);
    });

    it('emits grocery:auto_added with the new item ids', () => {
      orch.init();
      const seen: unknown[] = [];
      on('grocery:auto_added', (p) => seen.push(p));
      emit('cycle:period_logged', { ts: NOW, source: 'user' });
      expect(seen).toHaveLength(1);
      const p = seen[0] as { item_ids?: string[]; category?: string; source_event?: string };
      expect(p.item_ids?.length).toBe(3);
      expect(p.category).toBe('period_products');
      expect(p.source_event).toBe('cycle:period_logged');
    });
  });
});
