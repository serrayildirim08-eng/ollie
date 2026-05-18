import { describe, it, expect } from 'vitest';
import {
  foldDiacritics,
  stripPlural,
  lev,
  normalizeItemName,
  parseGroceryItem,
  detectDuplicate,
  detectExpirationDrift,
  detectStockoutCascade,
  detectStaleListItems,
  detectShoppingCadence,
  detectPatterns,
  inferRecipe,
  learnKnownStore,
  type PantryItem,
  type ShoppingItem,
  type KnownStore,
  type GeoCoords,
} from '../src/grocery';

const DAY = 86_400_000;
const NOW = 1_000 * DAY;

// ─── 1. foldDiacritics ───────────────────────────────────────────────────

describe('foldDiacritics', () => {
  it('folds Turkish ı → i', () => {
    expect(foldDiacritics('ıspanak')).toBe('ispanak');
  });
  it('folds ş → s, ç → c, ğ → g', () => {
    expect(foldDiacritics('şeker')).toBe('seker');
    expect(foldDiacritics('çay')).toBe('cay');
    expect(foldDiacritics('yoğurt')).toBe('yogurt');
  });
  it('returns empty string for non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(foldDiacritics(null)).toBe('');
  });
});

// ─── 2. stripPlural ──────────────────────────────────────────────────────

describe('stripPlural', () => {
  it('strips -es suffix (apples → appl via regex: non-vowel+es)', () => {
    // apples → 'appl' because the regex strips the whole -es from non-vowel+es
    // The function is a port of the original void logic; test the actual behaviour.
    expect(stripPlural('apples')).toBe('appl');
  });
  it('converts -ies → -y', () => {
    expect(stripPlural('strawberries')).toBe('strawberry');
  });
  it('strips plain -s', () => {
    expect(stripPlural('carrots')).toBe('carrot');
  });
  it('leaves short words alone', () => {
    expect(stripPlural('oat')).toBe('oat');
  });
  it('strips Turkish -lar/-ler only when > 4 chars', () => {
    // 'elmaları' contains 'ı' not 'r' at end — no -lar/-ler suffix, returns as-is
    expect(stripPlural('elmaları')).toBe('elmaları');
    // 'elmalar' ends with -lar, length 7 > 4 → stripped
    expect(stripPlural('elmalar')).toBe('elma');
    // 'lalar' length 5 > 4, ends -lar → stripped
    expect(stripPlural('lalar')).toBe('la');
  });
});

// ─── 3. lev ──────────────────────────────────────────────────────────────

describe('lev', () => {
  it('returns 0 for identical strings', () => {
    expect(lev('milk', 'milk')).toBe(0);
  });
  it('returns 1 for single substitution', () => {
    expect(lev('milk', 'silk')).toBe(1);
  });
  it('reports an over-budget distance ( > 2 ) when more than 2 edits apart', () => {
    // lev is capped at 2 edits; anything further returns an over-budget
    // value. The sole caller only checks `d <= 2`, so the exact sentinel
    // does not matter — what matters is that it fails the <= 2 check.
    expect(lev('a', 'abcde')).toBeGreaterThan(2);
  });
});

// ─── 4. normalizeItemName ────────────────────────────────────────────────

describe('normalizeItemName', () => {
  it('exact alias — English', () => {
    const r = normalizeItemName('milk');
    expect(r.canonical).toBe('milk');
    expect(r.method).toBe('exact');
    expect(r.confidence).toBe('high');
  });
  it('exact alias — Turkish (süt)', () => {
    const r = normalizeItemName('süt');
    expect(r.canonical).toBe('milk');
  });
  it('plural form', () => {
    const r = normalizeItemName('eggs');
    expect(r.canonical).toBe('egg');
  });
  it('strips ADD verb before matching', () => {
    const r = normalizeItemName('need bread');
    expect(r.canonical).toBe('bread');
  });
  it('returns null for gibberish', () => {
    const r = normalizeItemName('xyzqwerty');
    expect(r.canonical).toBeNull();
    expect(r.method).toBe('fail');
  });
  it('returns null for empty string', () => {
    const r = normalizeItemName('');
    expect(r.canonical).toBeNull();
  });
});

// ─── 5. parseGroceryItem ─────────────────────────────────────────────────

describe('parseGroceryItem', () => {
  it('parses plain "milk" as ADD intent', () => {
    const r = parseGroceryItem('milk');
    expect(r).not.toBeNull();
    expect(r!.intent).toBe('ADD');
    expect(r!.normalizedName).toBe('milk');
    expect(r!.category).toBe('dairy');
  });
  it('parses "got milk" as BOUGHT', () => {
    const r = parseGroceryItem('got milk');
    expect(r!.intent).toBe('BOUGHT');
  });
  it('parses "remove eggs" as REMOVE', () => {
    const r = parseGroceryItem('remove eggs');
    expect(r!.intent).toBe('REMOVE');
    expect(r!.normalizedName).toBe('egg');
  });
  it('parses quantity + unit', () => {
    const r = parseGroceryItem('2 kg chicken');
    expect(r).not.toBeNull();
    expect(r!.qty).toBe(2);
    expect(r!.unit).toBe('kg');
    expect(r!.normalizedName).toBe('chicken');
  });
  it('dozen expands to 12 count', () => {
    const r = parseGroceryItem('1 dozen eggs');
    expect(r!.qty).toBe(12);
    expect(r!.unit).toBe('count');
  });
  it('returns null for past-consumption phrase', () => {
    expect(parseGroceryItem('had some milk this morning')).toBeNull();
  });
  it('returns null for "have a nice day"', () => {
    expect(parseGroceryItem('have a nice day')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(parseGroceryItem('')).toBeNull();
  });
});

// ─── 6. detectDuplicate ──────────────────────────────────────────────────

describe('detectDuplicate', () => {
  it('fires when item bought within shelf life', () => {
    const pantry: PantryItem[] = [{ normalizedName: 'milk', boughtTs: NOW - 3 * DAY, shelfLifeDays: 7 }];
    const result = detectDuplicate({ pantry, now: NOW }, { newCanonical: 'milk' });
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('grocery-duplicate-buy');
    expect(result!.name).toBe('milk');
  });
  it('returns null when shelf life has passed', () => {
    const pantry: PantryItem[] = [{ normalizedName: 'milk', boughtTs: NOW - 10 * DAY, shelfLifeDays: 7 }];
    const result = detectDuplicate({ pantry, now: NOW }, { newCanonical: 'milk' });
    expect(result).toBeNull();
  });
  it('returns null when pantry is empty', () => {
    expect(detectDuplicate({ pantry: [], now: NOW }, { newCanonical: 'milk' })).toBeNull();
  });
  it('confidence is high when bought < half shelf life ago', () => {
    const pantry: PantryItem[] = [{ normalizedName: 'egg', boughtTs: NOW - 3 * DAY, shelfLifeDays: 28 }];
    const r = detectDuplicate({ pantry, now: NOW }, { newCanonical: 'egg' });
    expect(r!.confidence).toBe('high');
  });
});

// ─── 7. detectExpirationDrift ────────────────────────────────────────────

describe('detectExpirationDrift', () => {
  it('detects item expiring in 2 days (within 3-day window)', () => {
    const pantry: PantryItem[] = [
      { normalizedName: 'milk', boughtTs: NOW - 5 * DAY, shelfLifeDays: 7 },
    ];
    const r = detectExpirationDrift({ pantry, now: NOW });
    expect(r).not.toBeNull();
    expect(r!.pattern).toBe('grocery-expiration-drift');
    expect(r!.items[0].name).toBe('milk');
  });
  it('returns null when nothing is expiring', () => {
    const pantry: PantryItem[] = [
      { normalizedName: 'rice', boughtTs: NOW - 1 * DAY, shelfLifeDays: 730 },
    ];
    expect(detectExpirationDrift({ pantry, now: NOW })).toBeNull();
  });
  it('confidence is high when 2+ items drifting', () => {
    const pantry: PantryItem[] = [
      { normalizedName: 'milk', boughtTs: NOW - 6 * DAY, shelfLifeDays: 7 },
      { normalizedName: 'cream', boughtTs: NOW - 9 * DAY, shelfLifeDays: 10 },
    ];
    const r = detectExpirationDrift({ pantry, now: NOW });
    expect(r!.confidence).toBe('high');
  });
});

// ─── 8. detectStockoutCascade ────────────────────────────────────────────

describe('detectStockoutCascade', () => {
  it('fires when item bought 3+ times in window', () => {
    const items: ShoppingItem[] = [
      { normalizedName: 'milk', boughtTs: NOW - 10 * DAY, checked: true },
      { normalizedName: 'milk', boughtTs: NOW - 20 * DAY, checked: true },
      { normalizedName: 'milk', boughtTs: NOW - 30 * DAY, checked: true },
    ];
    const r = detectStockoutCascade({ items, pantry: [], now: NOW }, { windowDays: 60, minRebuys: 3 });
    expect(r).not.toBeNull();
    expect(r!.name).toBe('milk');
  });
  it('returns null below threshold', () => {
    const items: ShoppingItem[] = [
      { normalizedName: 'milk', boughtTs: NOW - 10 * DAY, checked: true },
      { normalizedName: 'milk', boughtTs: NOW - 20 * DAY, checked: true },
    ];
    const r = detectStockoutCascade({ items, pantry: [], now: NOW }, { windowDays: 60, minRebuys: 3 });
    expect(r).toBeNull();
  });
});

// ─── 9. detectStaleListItems ─────────────────────────────────────────────

describe('detectStaleListItems', () => {
  it('detects stale items older than 14 days', () => {
    const items: ShoppingItem[] = Array.from({ length: 4 }, (_, i) => ({
      name: `item${i}`,
      ts: NOW - 20 * DAY,
      checked: false,
    }));
    const r = detectStaleListItems({ items, pantry: [], now: NOW });
    expect(r).not.toBeNull();
    expect(r!.stale_count).toBe(4);
  });
  it('returns null when count below minCount', () => {
    const items: ShoppingItem[] = [
      { name: 'a', ts: NOW - 20 * DAY, checked: false },
      { name: 'b', ts: NOW - 20 * DAY, checked: false },
    ];
    expect(detectStaleListItems({ items, pantry: [], now: NOW })).toBeNull();
  });
  it('ignores checked items', () => {
    const items: ShoppingItem[] = Array.from({ length: 5 }, (_, i) => ({
      name: `item${i}`,
      ts: NOW - 20 * DAY,
      checked: true,
    }));
    expect(detectStaleListItems({ items, pantry: [], now: NOW })).toBeNull();
  });
});

// ─── 10. detectShoppingCadence ───────────────────────────────────────────

describe('detectShoppingCadence', () => {
  it('computes avg gap from 6 trips on different days', () => {
    // 6 items each on a different day, ~7 days apart
    const items: ShoppingItem[] = Array.from({ length: 6 }, (_, i) => ({
      boughtTs: NOW - (5 - i) * 7 * DAY,
    }));
    const r = detectShoppingCadence({ items, pantry: [], now: NOW }, { minEvents: 6, windowDays: 90 });
    expect(r).not.toBeNull();
    expect(r!.avg_gap_days).toBeGreaterThan(0);
  });
  it('returns null with fewer than minEvents', () => {
    const items: ShoppingItem[] = [{ boughtTs: NOW - 5 * DAY }];
    expect(detectShoppingCadence({ items, pantry: [], now: NOW })).toBeNull();
  });
});

// ─── 11. detectPatterns (batch) ──────────────────────────────────────────

describe('detectPatterns', () => {
  it('returns array (may be empty)', () => {
    const r = detectPatterns({ pantry: [], items: [], now: NOW });
    expect(Array.isArray(r)).toBe(true);
  });
  it('returns multiple patterns when applicable', () => {
    const pantry: PantryItem[] = [
      { normalizedName: 'milk', boughtTs: NOW - 6 * DAY, shelfLifeDays: 7 },
    ];
    const items: ShoppingItem[] = Array.from({ length: 4 }, (_, i) => ({
      name: `stale${i}`, ts: NOW - 20 * DAY, checked: false,
    }));
    const r = detectPatterns({ pantry, items, now: NOW });
    const patterns = r.map(p => p.pattern);
    expect(patterns).toContain('grocery-expiration-drift');
    expect(patterns).toContain('stale-shopping-list');
  });
});

// ─── 12. inferRecipe ─────────────────────────────────────────────────────

describe('inferRecipe', () => {
  it('finds carbonara by dishHint', () => {
    const r = inferRecipe({ pantry: [], now: NOW }, { dishHint: 'carbonara' });
    expect(r).not.toBeNull();
    expect(r!.found).toBe(true);
    expect(r!.dish).toBe('carbonara');
  });
  it('reports missing ingredients', () => {
    const pantry: PantryItem[] = [{ normalizedName: 'pasta' }, { normalizedName: 'egg' }];
    const r = inferRecipe({ pantry, now: NOW }, { dishHint: 'carbonara' });
    expect(r!.missing).toContain('bacon');
  });
  it('returns found:false for unknown dish', () => {
    const r = inferRecipe({ pantry: [], now: NOW }, { dishHint: 'xyzzy frizzle' });
    expect(r!.found).toBe(false);
  });
  it('auto-infers recipe from pantry without hint', () => {
    // omelet needs egg + butter
    const pantry: PantryItem[] = [
      { normalizedName: 'egg' }, { normalizedName: 'butter' },
      { normalizedName: 'salt' }, { normalizedName: 'black pepper' },
    ];
    const r = inferRecipe({ pantry, now: NOW });
    expect(r).not.toBeNull();
    expect(r!.found).toBe(true);
  });
  it('returns null when pantry empty and no dishHint', () => {
    expect(inferRecipe({ pantry: [], now: NOW })).toBeNull();
  });
});

// ─── 13. learnKnownStore ─────────────────────────────────────────────────

describe('learnKnownStore', () => {
  const store: KnownStore = { lat: 41.0, lng: 29.0, visitCount: 1, lastSeenTs: NOW - DAY };
  it('increments visitCount when within 80m', () => {
    // same coords → haversine ≈ 0
    const result = learnKnownStore({ lat: 41.0, lng: 29.0 }, [store], NOW);
    expect(result[0].visitCount).toBe(2);
    expect(result[0].lastSeenTs).toBe(NOW);
  });
  it('adds new entry for distant coords', () => {
    const far: GeoCoords = { lat: 41.1, lng: 29.1 }; // ~14km away
    const result = learnKnownStore(far, [store], NOW);
    expect(result.length).toBe(2);
    expect(result[1].lat).toBe(41.1);
  });
  it('returns unchanged list for null coords', () => {
    const result = learnKnownStore(null, [store], NOW);
    expect(result).toEqual([store]);
  });
});
