/**
 * Grocery · pantry aisles.
 *
 * The pantry is browsed like a grocery store — organised BY AISLE, in a fixed
 * walk order (produce → bakery → dairy → pantry & staples → frozen → personal
 * care → household). This module is the pure, deterministic categoriser: given
 * an item name (and, when known, its shelf-life category from the worker's
 * 721-item table) it returns which aisle the item lives on.
 *
 * Two signals, in priority order:
 *   1. The worker's ShelfCategory (11 storage buckets) → mapped to a display
 *      aisle. This is the high-quality signal — the table is research-backed.
 *   2. A small keyword fallback for items the table doesn't know, so a freshly
 *      dumped "tampons" or "dish soap" still lands in the right aisle.
 *   3. Default → "pantry & staples", the catch-all middle of the store.
 *
 * No emojis (Serra's call) — the UI marks each aisle with a tiny olive dot.
 * `tampons` deliberately routes to personal care (+ the cycle module cross-links
 * to it elsewhere).
 */

/** The eight display aisles, in store-walk order. */
export type Aisle =
  | 'produce'
  | 'bakery'
  | 'meat_fish'
  | 'dairy'
  | 'pantry'
  | 'frozen'
  | 'personal_care'
  | 'household';

/** Render order + human label for each aisle. */
export const AISLE_ORDER: ReadonlyArray<{ key: Aisle; label: string }> = [
  { key: 'produce', label: 'produce' },
  { key: 'bakery', label: 'bakery' },
  { key: 'meat_fish', label: 'meat & fish' },
  { key: 'dairy', label: 'dairy' },
  { key: 'pantry', label: 'pantry & staples' },
  { key: 'frozen', label: 'frozen' },
  { key: 'personal_care', label: 'personal care' },
  { key: 'household', label: 'household' },
];

/**
 * Worker ShelfCategory → display aisle. The worker has 11 storage buckets; we
 * fold them into the 7 approved aisles:
 *   - meat → its own "meat & fish" aisle (Serra added it 2026-06-23).
 *   - beverage → pantry & staples (no dedicated drinks aisle).
 *   - wellness (OTC/vitamins) → personal care.
 *   - cleaning + pet → household.
 */
const CATEGORY_TO_AISLE: Record<string, Aisle> = {
  produce: 'produce',
  bakery: 'bakery',
  dairy: 'dairy',
  meat: 'meat_fish',
  pantry: 'pantry',
  beverage: 'pantry',
  frozen: 'frozen',
  personal_care: 'personal_care',
  wellness: 'personal_care',
  cleaning: 'household',
  pet: 'household',
};

/**
 * Keyword fallback — substring match against a normalised name. Order within
 * an aisle doesn't matter; the FIRST aisle (in this list's order) with a hit
 * wins, so more-specific aisles are listed before the generic pantry. Lists are
 * intentionally small + high-signal — the worker category covers the long tail.
 */
const KEYWORD_AISLES: ReadonlyArray<{ aisle: Aisle; words: string[] }> = [
  {
    aisle: 'personal_care',
    words: [
      'tampon', 'pad', 'liner', 'shampoo', 'conditioner', 'soap', 'body wash',
      'toothpaste', 'toothbrush', 'floss', 'deodorant', 'razor', 'lotion',
      'sunscreen', 'makeup', 'vitamin', 'ibuprofen', 'advil', 'tylenol',
      'acetaminophen', 'medicine', 'contact solution', 'diaper', 'wipes',
    ],
  },
  {
    aisle: 'household',
    words: [
      'detergent', 'dish soap', 'dishwasher', 'paper towel', 'toilet paper',
      'trash bag', 'garbage bag', 'cleaner', 'bleach', 'sponge', 'battery',
      'batteries', 'light bulb', 'bulb', 'foil', 'ziploc', 'cling film',
      'plastic wrap', 'napkin', 'tissue',
    ],
  },
  {
    aisle: 'dairy',
    words: [
      'milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'egg', 'eggs',
      'kefir',
    ],
  },
  {
    aisle: 'bakery',
    words: [
      'bread', 'bagel', 'croissant', 'tortilla', 'bun', 'pita', 'baguette',
      'muffin', 'roll',
    ],
  },
  {
    aisle: 'meat_fish',
    words: [
      'chicken', 'beef', 'pork', 'lamb', 'turkey', 'bacon', 'sausage', 'mince',
      'steak', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'cod',
    ],
  },
  {
    aisle: 'frozen',
    words: ['frozen', 'ice cream', 'popsicle'],
  },
  {
    aisle: 'produce',
    words: [
      'apple', 'banana', 'tomato', 'onion', 'lettuce', 'spinach', 'carrot',
      'potato', 'garlic', 'pepper', 'lemon', 'lime', 'avocado', 'cucumber',
      'broccoli', 'fruit', 'vegetable', 'herb', 'salad', 'orange', 'berries',
      'berry', 'grape',
    ],
  },
];

/** Normalise a name the same way the rest of grocery does. */
function normalise(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Which aisle does this item belong to?
 *   - `category` (the worker ShelfCategory) wins when known + mappable.
 *   - else a keyword match on the name.
 *   - else "pantry & staples" (the catch-all).
 */
export function aisleFor(name: string, category?: string | null): Aisle {
  if (category) {
    const mapped = CATEGORY_TO_AISLE[category];
    if (mapped) return mapped;
  }
  const key = normalise(name);
  for (const { aisle, words } of KEYWORD_AISLES) {
    if (words.some((w) => key.includes(w))) return aisle;
  }
  return 'pantry';
}
