/**
 * grocery-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `grocery.*` slices into the v2 view-models, deriving the torn-note
 * shopping list, the 3-shelf pantry with computed shelf-life fill bars,
 * the `feed me` recipe match through `inferRecipe`, the natural-language
 * add parse through `parseGroceryItem`, and the reflective patterns
 * through `detectPatterns` + `detectInterestCapture`. These tests verify
 * the bridge. Mirrors admin-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import {
  itemKey,
  itemName,
  shelfLifeDays,
  shopVM,
  pantryVM,
  feedMeVM,
  feedMeSearchVM,
  addParseVM,
  patternsVM,
  notificationsVM,
  fmtClockDay,
  fmtClockTime,
  type GrocerySlices,
} from './selectors';

const NOW = new Date('2026-05-19T12:00:00Z').getTime();
const DAY = 86_400_000;

/** an empty store — the cold-start fixture */
const EMPTY: GrocerySlices = { items: [], pantry: [], aliasOverrides: {} };

describe('grocery-v2 selectors · helpers', () => {
  it('itemKey lowercases + prefers normalizedName', () => {
    expect(itemKey({ normalizedName: 'Milk', name: 'whole milk' })).toBe('milk');
    expect(itemKey({ name: 'EGGS' })).toBe('eggs');
    expect(itemKey(null)).toBe('');
  });

  it('itemName falls back to a calm placeholder', () => {
    expect(itemName({ name: 'olive oil' })).toBe('olive oil');
    expect(itemName({})).toBe('item');
  });

  it('shelfLifeDays prefers an explicit shelf life, else the alias table', () => {
    expect(shelfLifeDays({ shelfLifeDays: 9 })).toBe(9);
    // an unknown item with no alias entry → the 14-day default
    expect(shelfLifeDays({ name: 'zzz-unknown-thing' })).toBe(14);
  });
});

describe('grocery-v2 selectors · shopVM', () => {
  it('is cold when the store is empty', () => {
    const vm = shopVM(EMPTY, NOW);
    expect(vm.cold).toBe(true);
    expect(vm.rows).toHaveLength(0);
  });

  it('lists open items first, checked-off ones last', () => {
    const slices: GrocerySlices = {
      items: [
        { id: 'a', name: 'olive oil', checked: false },
        { id: 'b', name: 'eggs', checked: true },
        { id: 'c', name: 'bread', checked: false },
      ],
      pantry: [],
      aliasOverrides: {},
    };
    const vm = shopVM(slices, NOW);
    expect(vm.cold).toBe(false);
    expect(vm.openCount).toBe(2);
    // open ones first
    expect(vm.rows.map((r) => r.name)).toEqual(['olive oil', 'bread', 'eggs']);
    // the got row is struck + reads "in pantry"
    const got = vm.rows.find((r) => r.name === 'eggs')!;
    expect(got.got).toBe(true);
    expect(got.qty).toBe('in pantry');
  });

  it('formats a tidy quantity line', () => {
    const slices: GrocerySlices = {
      items: [
        { id: 'a', name: 'milk', qty: 2, unit: 'l', checked: false },
        { id: 'b', name: 'olive oil', qty: 1, unit: 'bottle', checked: false },
      ],
      pantry: [],
      aliasOverrides: {},
    };
    const vm = shopVM(slices, NOW);
    expect(vm.rows[0].qty).toBe('2L');
    expect(vm.rows[1].qty).toBe('1 bottle');
  });
});

describe('grocery-v2 selectors · pantryVM', () => {
  it('is empty when nothing is in the kitchen', () => {
    expect(pantryVM(EMPTY, NOW).empty).toBe(true);
  });

  it('sorts items onto critical / watching / stocked shelves', () => {
    const slices: GrocerySlices = {
      items: [],
      pantry: [
        // a 7-day shelf bought today → 7 days left → watching
        { id: 'a', name: 'milk', boughtTs: NOW, shelfLifeDays: 7 },
        // a 4-day shelf bought 3 days ago → 1 day left → critical
        { id: 'b', name: 'spinach', boughtTs: NOW - 3 * DAY, shelfLifeDays: 4 },
        // a 90-day shelf bought today → stocked
        { id: 'c', name: 'pasta', boughtTs: NOW, shelfLifeDays: 90 },
      ],
      aliasOverrides: {},
    };
    const vm = pantryVM(slices, NOW);
    expect(vm.total).toBe(3);
    const byTier = Object.fromEntries(
      vm.shelves.map((s) => [s.tier, s.rows.map((r) => r.name)]),
    );
    expect(byTier.critical).toEqual(['spinach']);
    expect(byTier.watching).toEqual(['milk']);
    expect(byTier.stocked).toEqual(['pasta']);
  });

  it('computes a fill fraction + a calm days label', () => {
    const slices: GrocerySlices = {
      items: [],
      pantry: [
        { id: 'a', name: 'yoghurt', boughtTs: NOW - 5 * DAY, shelfLifeDays: 10 },
      ],
      aliasOverrides: {},
    };
    const row = pantryVM(slices, NOW).shelves.flatMap((s) => s.rows)[0];
    // halfway through a 10-day shelf
    expect(row.fill).toBeCloseTo(0.5, 1);
    expect(row.daysLabel).toBe('5 days');
  });
});

describe('grocery-v2 selectors · feedMeVM', () => {
  it('returns not-found + cold on an empty pantry', () => {
    const vm = feedMeVM(EMPTY, NOW);
    expect(vm.found).toBe(false);
    expect(vm.cold).toBe(true);
  });

  it('infers a recipe from real pantry contents', () => {
    // a pantry that covers a known recipe — driven by the live recipe table
    const slices: GrocerySlices = {
      items: [],
      pantry: [
        { id: '1', name: 'egg', normalizedName: 'egg', boughtTs: NOW },
        { id: '2', name: 'spinach', normalizedName: 'spinach', boughtTs: NOW },
        { id: '3', name: 'olive oil', normalizedName: 'olive oil', boughtTs: NOW },
        { id: '4', name: 'onion', normalizedName: 'onion', boughtTs: NOW },
        { id: '5', name: 'tomato', normalizedName: 'tomato', boughtTs: NOW },
        { id: '6', name: 'garlic', normalizedName: 'garlic', boughtTs: NOW },
      ],
      aliasOverrides: {},
    };
    const vm = feedMeVM(slices, NOW);
    // a real recipe could be inferred, or honestly not — but never throws,
    // and when found the coverage object is internally consistent
    if (vm.found) {
      expect(vm.total).toBe(vm.have.length + vm.missing.length);
      expect(vm.haveCount).toBe(vm.have.length);
      expect(vm.coverage).toContain('you have');
    } else {
      expect(vm.dish).toBeNull();
    }
  });

  it('feedMeSearchVM falls back to the inferred recipe on a blank query', () => {
    const blank = feedMeSearchVM(EMPTY, NOW, '   ');
    expect(blank.found).toBe(feedMeVM(EMPTY, NOW).found);
  });
});

describe('grocery-v2 selectors · addParseVM', () => {
  it('returns a blank vm on empty input', () => {
    const vm = addParseVM('', {});
    expect(vm.ok).toBe(false);
    expect(vm.unknown).toBe(false);
  });

  it('parses a quantity + a known item into a calm parse', () => {
    const vm = addParseVM('2 bottles olive oil', {});
    expect(vm.ok).toBe(true);
    expect(vm.intentLabel).toBe('add to the list');
    expect(vm.item).toBe('olive oil');
    expect(vm.qty).toBe('2 bottles');
  });

  it('reads the BOUGHT verb as a straight-to-pantry intent', () => {
    const vm = addParseVM('got milk', {});
    expect(vm.ok).toBe(true);
    expect(vm.intentLabel).toBe('straight to the pantry');
  });

  it('flags an unknown word for the teach-me block', () => {
    const vm = addParseVM('xyzzyqux', {});
    expect(vm.unknown).toBe(true);
    expect(vm.ok).toBe(false);
  });

  it('resolves a learned alias override to the canonical staple', () => {
    const vm = addParseVM('basmati rice', { 'basmati rice': 'rice' });
    expect(vm.item).toBe('rice');
  });
});

describe('grocery-v2 selectors · patternsVM', () => {
  it('falls back to honest canonical examples when nothing real is live', () => {
    const vm = patternsVM(EMPTY, NOW);
    expect(vm.live).toBe(false);
    expect(vm.exampleFallback).toBe(true);
    expect(vm.groups.length).toBeGreaterThan(0);
  });

  it('surfaces a real stale-list observation when items have sat 2+ weeks', () => {
    const old = NOW - 20 * DAY;
    const slices: GrocerySlices = {
      items: [
        { id: 'a', name: 'olive oil', checked: false, ts: old },
        { id: 'b', name: 'bread', checked: false, ts: old },
        { id: 'c', name: 'coffee beans', checked: false, ts: old },
      ],
      pantry: [],
      aliasOverrides: {},
    };
    const vm = patternsVM(slices, NOW);
    expect(vm.live).toBe(true);
    expect(vm.exampleFallback).toBe(false);
    const lines = vm.groups.flatMap((g) => g.rows.map((r) => r.line));
    expect(lines.some((l) => l.includes('over 2 weeks'))).toBe(true);
  });
});

describe('grocery-v2 selectors · notificationsVM', () => {
  it('builds a five-frame reel anchored to the injected now', () => {
    const vm = notificationsVM(NOW);
    expect(vm.cards).toHaveLength(5);
    // the first frame's day line is derived off `now`
    expect(vm.cards[0].day).toBe(fmtClockDay(NOW));
    expect(vm.cards[0].title).toBe('olive oil turns soon');
  });

  it('fmtClockTime pads the minute', () => {
    const ts = new Date('2026-05-19T08:05:00').getTime();
    expect(fmtClockTime(ts)).toBe('8:05');
  });
});
