/**
 * shelf-life.test.ts — coverage + invariants for the shelf-life dataset.
 *
 * Source policy (research notes echo grocery.config.ts):
 *   USDA FoodKeeper / FoodSafety.gov for fresh foods; manufacturer guidelines
 *   for shelf-stable. When sources range, prefer the SHORTER bound. Indefinite
 *   shelf-life items (honey, salt, sugar) capped at 365d so the aging UI has
 *   a finite tick.
 */

import { describe, it, expect } from 'vitest';
import {
  SHELF_LIFE_MAP,
  SHELF_LIFE_DETAIL,
  ALIAS_MAP,
  lookupShelfLife,
  lookupShelfLifeDetail,
  type ShelfCategory,
} from '../src/modules/grocery.config';

describe('shelf-life dataset', () => {
  it('SHELF_LIFE_MAP has at least 500 canonical entries', () => {
    expect(Object.keys(SHELF_LIFE_MAP).length).toBeGreaterThanOrEqual(500);
  });

  it('SHELF_LIFE_MAP is derived flat number map from SHELF_LIFE_DETAIL', () => {
    expect(Object.keys(SHELF_LIFE_MAP)).toEqual(Object.keys(SHELF_LIFE_DETAIL));
    for (const [k, v] of Object.entries(SHELF_LIFE_MAP)) {
      expect(typeof v).toBe('number');
      expect(v).toBe(SHELF_LIFE_DETAIL[k].days);
    }
  });

  it('every entry has finite positive days within [1, 1825]', () => {
    // 1825 = 5 years, the longest justified entry (tampons / FDA; menstrual cup).
    for (const [k, entry] of Object.entries(SHELF_LIFE_DETAIL)) {
      expect(Number.isFinite(entry.days), `${k} days finite`).toBe(true);
      expect(entry.days, `${k} days >= 1`).toBeGreaterThanOrEqual(1);
      expect(entry.days, `${k} days <= 1825`).toBeLessThanOrEqual(1825);
    }
  });

  it('openedDays (when present) is <= days', () => {
    for (const [k, entry] of Object.entries(SHELF_LIFE_DETAIL)) {
      if (typeof entry.openedDays === 'number') {
        expect(entry.openedDays, `${k} openedDays <= days`).toBeLessThanOrEqual(entry.days);
        expect(entry.openedDays).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('shelf-life manual spot checks (USDA / FoodSafety.gov anchors)', () => {
  // Eight canonical examples — research-anchored bounds.
  it('milk fridge life <= 14 days (USDA ~1wk past sell-by)', () => {
    expect(SHELF_LIFE_MAP.milk).toBeLessThanOrEqual(14);
    expect(SHELF_LIFE_MAP.milk).toBeGreaterThanOrEqual(3);
  });

  it('garlic (whole bulb) >= 60 days (USDA 3-5mo dry storage)', () => {
    expect(SHELF_LIFE_MAP.garlic).toBeGreaterThanOrEqual(60);
  });

  it('honey == 365 (USDA indefinite, capped at 365)', () => {
    expect(SHELF_LIFE_MAP.honey).toBe(365);
  });

  it('chicken raw <= 2 days (FoodSafety.gov 1-2d fridge)', () => {
    expect(SHELF_LIFE_MAP.chicken).toBeLessThanOrEqual(2);
  });

  it('rice (dry white) == 365 (USDA indefinite, capped)', () => {
    expect(SHELF_LIFE_MAP.rice).toBe(365);
  });

  it('strawberry <= 7 days (USDA 5-7d fridge)', () => {
    expect(SHELF_LIFE_MAP.strawberry).toBeLessThanOrEqual(7);
  });

  it('olive oil sealed >= 180 days (USDA 1-2y sealed)', () => {
    expect(SHELF_LIFE_MAP['olive oil']).toBeGreaterThanOrEqual(180);
  });

  it('tampons == 1825 (FDA 5y expiration)', () => {
    expect(SHELF_LIFE_MAP.tampons).toBe(1825);
  });
});

describe('alias resolution (TR + ES → EN canonical)', () => {
  it('lookupShelfLife("süt") === lookupShelfLife("milk")', () => {
    expect(lookupShelfLife('süt')).toBe(lookupShelfLife('milk'));
    expect(lookupShelfLife('süt')).toBeDefined();
  });

  it('lookupShelfLife("leche") === lookupShelfLife("milk")', () => {
    expect(lookupShelfLife('leche')).toBe(lookupShelfLife('milk'));
  });

  it('lookupShelfLife("yoğurt") resolves to yogurt', () => {
    expect(lookupShelfLife('yoğurt')).toBe(SHELF_LIFE_MAP.yogurt);
  });

  it('lookupShelfLife("yogur") (ES) resolves to yogurt', () => {
    expect(lookupShelfLife('yogur')).toBe(SHELF_LIFE_MAP.yogurt);
  });

  it('lookupShelfLife("aceite de oliva") resolves to olive oil', () => {
    expect(lookupShelfLife('aceite de oliva')).toBe(SHELF_LIFE_MAP['olive oil']);
  });

  it('lookupShelfLife("zeytinyağı") resolves to olive oil', () => {
    expect(lookupShelfLife('zeytinyağı')).toBe(SHELF_LIFE_MAP['olive oil']);
  });

  it('lookupShelfLife("evoo") (EN abbrev) resolves to olive oil', () => {
    expect(lookupShelfLife('evoo')).toBe(SHELF_LIFE_MAP['olive oil']);
  });

  it('lookupShelfLife("tp") (abbrev) resolves to toilet paper', () => {
    expect(lookupShelfLife('tp')).toBe(SHELF_LIFE_MAP['toilet paper']);
  });

  it('lookupShelfLife("pb") (abbrev) resolves to peanut butter', () => {
    expect(lookupShelfLife('pb')).toBe(SHELF_LIFE_MAP['peanut butter']);
  });

  it('lookupShelfLife is case-insensitive', () => {
    expect(lookupShelfLife('MILK')).toBe(SHELF_LIFE_MAP.milk);
    expect(lookupShelfLife('  Milk  ')).toBe(SHELF_LIFE_MAP.milk);
  });

  it('lookupShelfLife returns undefined for unknown', () => {
    expect(lookupShelfLife('xyz-nonsense-123')).toBeUndefined();
    expect(lookupShelfLife('')).toBeUndefined();
  });

  it('lookupShelfLifeDetail returns category + openedDays', () => {
    const milk = lookupShelfLifeDetail('milk');
    expect(milk?.category).toBe('dairy');
    expect(milk?.openedDays).toBeDefined();
    const oil = lookupShelfLifeDetail('olive oil');
    expect(oil?.category).toBe('pantry');
    expect(oil?.openedDays).toBeGreaterThan(0);
  });

  it('every ALIAS_MAP value points to a real canonical key', () => {
    for (const [alias, canonical] of Object.entries(ALIAS_MAP)) {
      expect(
        SHELF_LIFE_DETAIL[canonical],
        `alias "${alias}" → "${canonical}" must exist in SHELF_LIFE_DETAIL`,
      ).toBeDefined();
    }
  });
});

describe('category coverage (each declared category has >= 5 entries)', () => {
  // The aging UI switches on these eleven categories — losing one would silently
  // drop a whole class of items into a default bucket.
  const expectedCategories: ShelfCategory[] = [
    'dairy', 'produce', 'meat', 'pantry', 'frozen',
    'bakery', 'beverage', 'cleaning', 'personal_care', 'wellness', 'pet',
  ];

  for (const cat of expectedCategories) {
    it(`category "${cat}" has >= 5 entries`, () => {
      const count = Object.values(SHELF_LIFE_DETAIL).filter((e) => e.category === cat).length;
      expect(count).toBeGreaterThanOrEqual(5);
    });
  }

  it('only declared categories are used (no typos)', () => {
    const allowed = new Set<string>(expectedCategories);
    for (const [k, entry] of Object.entries(SHELF_LIFE_DETAIL)) {
      expect(allowed.has(entry.category), `${k} uses undeclared category "${entry.category}"`).toBe(true);
    }
  });
});

describe('backward compatibility', () => {
  it('legacy canonical keys still present (replenishment.ts consumer)', () => {
    // These were the entries in the pre-2026-05-30 SHELF_LIFE_MAP. The
    // replenishment SQL function emits these canonicals; they MUST still
    // key-into SHELF_LIFE_MAP or the static-tier fallback breaks.
    const legacy = [
      'milk', 'yogurt', 'cheese', 'feta', 'butter', 'cream', 'egg',
      'mozzarella', 'parmesan',
      'chicken', 'ground beef', 'beef', 'lamb', 'pork', 'fish', 'shrimp',
      'sausage', 'bacon', 'ham', 'salami',
      'tomato', 'onion', 'garlic', 'potato', 'sweet potato', 'carrot',
      'celery', 'cucumber', 'zucchini', 'eggplant', 'bell pepper',
      'spinach', 'lettuce',
      'apple', 'banana', 'lemon', 'lime', 'orange',
      'bread', 'pasta', 'rice', 'flour', 'oats',
    ];
    for (const k of legacy) {
      expect(SHELF_LIFE_MAP[k], `legacy canonical "${k}" must still exist`).toBeDefined();
      expect(typeof SHELF_LIFE_MAP[k]).toBe('number');
    }
  });
});
