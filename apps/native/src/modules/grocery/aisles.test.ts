/**
 * Grocery · aisle categoriser tests.
 *
 * Asserts:
 *   - worker ShelfCategory wins + folds correctly into the 7 display aisles
 *   - keyword fallback routes common items when no category is known
 *   - tampons → personal care (Serra's explicit cross-link case)
 *   - unknown items default to "pantry & staples"
 *   - AISLE_ORDER is the approved 7, in store-walk order
 */

import { describe, it, expect } from 'vitest';
import { aisleFor, AISLE_ORDER } from './aisles';

describe('aisleFor — worker category wins', () => {
  it('maps the obvious buckets 1:1', () => {
    expect(aisleFor('bananas', 'produce')).toBe('produce');
    expect(aisleFor('sourdough', 'bakery')).toBe('bakery');
    expect(aisleFor('milk', 'dairy')).toBe('dairy');
    expect(aisleFor('peas', 'frozen')).toBe('frozen');
  });

  it('folds the extra buckets into the aisles', () => {
    expect(aisleFor('chicken breast', 'meat')).toBe('meat_fish');
    expect(aisleFor('orange juice', 'beverage')).toBe('pantry'); // no drinks aisle

    expect(aisleFor('vitamin d', 'wellness')).toBe('personal_care');
    expect(aisleFor('dish soap', 'cleaning')).toBe('household');
    expect(aisleFor('dog food', 'pet')).toBe('household');
    expect(aisleFor('shampoo', 'personal_care')).toBe('personal_care');
  });

  it('ignores an unknown category string and falls through to keywords', () => {
    expect(aisleFor('bread', 'no_such_category')).toBe('bakery');
  });
});

describe('aisleFor — keyword fallback (no category)', () => {
  it('routes common items by name', () => {
    expect(aisleFor('whole milk')).toBe('dairy');
    expect(aisleFor('white bread')).toBe('bakery');
    expect(aisleFor('roma tomatoes')).toBe('produce');
    expect(aisleFor('frozen pizza')).toBe('frozen');
    expect(aisleFor('paper towels')).toBe('household');
    expect(aisleFor('chicken thighs')).toBe('meat_fish');
    expect(aisleFor('salmon fillet')).toBe('meat_fish');
  });

  it('tampons → personal care', () => {
    expect(aisleFor('tampons')).toBe('personal_care');
    expect(aisleFor('panty liner')).toBe('personal_care');
  });

  it('defaults unknown items to pantry & staples', () => {
    expect(aisleFor('quinoa')).toBe('pantry');
    expect(aisleFor('antimatter')).toBe('pantry');
  });

  it('is case + whitespace tolerant', () => {
    expect(aisleFor('  TAMPONS ')).toBe('personal_care');
  });
});

describe('AISLE_ORDER', () => {
  it('is the approved aisles in store-walk order (meat & fish after bakery)', () => {
    expect(AISLE_ORDER.map((a) => a.key)).toEqual([
      'produce', 'bakery', 'meat_fish', 'dairy', 'pantry', 'frozen', 'personal_care', 'household',
    ]);
    // "pantry" renders as "pantry & staples", "personal_care" as "personal care".
    expect(AISLE_ORDER.find((a) => a.key === 'pantry')?.label).toBe('pantry & staples');
    expect(AISLE_ORDER.find((a) => a.key === 'personal_care')?.label).toBe('personal care');
  });
});
