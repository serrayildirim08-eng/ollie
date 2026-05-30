/**
 * Grocery module · domain types.
 *
 * Kept narrow because the AI router lands a small vocabulary. Items have a
 * normalised `name` (lowercase, singular-ish — the router cleans before
 * routing) plus optional quantity + unit. Unit is a soft enum: we recognise
 * a few common ones for UI grouping, anything else falls into `other`.
 */

export type Unit =
  | 'piece'      // count: 12 eggs
  | 'liter'      // 2 L milk
  | 'milliliter' // 500 mL juice
  | 'kilogram'   // 1 kg flour
  | 'gram'       // 200 g cheese
  | 'pack'       // 1 pack pasta
  | 'bottle'     // 2 bottles wine
  | 'can'        // 4 cans tomato
  | 'other';

/**
 * One item the user has at home. `addedAt` lets the UI sort by recency;
 * `lowFlag` is a soft "running low" hint surfaced as a quiet badge —
 * never a blocker.
 *
 * `archivedAtMs` is set when an item ages out (≥ shelfLife × 2.0) OR the
 * user marks it gone from the "still here?" prompt. Archived rows leave
 * the active pantry list but are recoverable from the collapsed archived
 * section. Never null on archived rows; always null on active rows.
 */
export interface PantryItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  addedAt: number;   // ms since epoch — doubles as the aging clock
  lowFlag: boolean;
  archivedAtMs: number | null;
}

/** One thing on the shopping list. Smaller surface than pantry items. */
export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  addedAt: number;
}

export const KNOWN_UNITS: Unit[] = [
  'piece',
  'liter',
  'milliliter',
  'kilogram',
  'gram',
  'pack',
  'bottle',
  'can',
  'other',
];

export function normaliseUnit(raw: string | undefined | null): Unit | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  // Common aliases the router may surface.
  if (['l', 'liter', 'liters', 'litre', 'litres'].includes(lower)) return 'liter';
  if (['ml', 'milliliter', 'milliliters'].includes(lower)) return 'milliliter';
  if (['kg', 'kilogram', 'kilograms', 'kilo'].includes(lower)) return 'kilogram';
  if (['g', 'gram', 'grams'].includes(lower)) return 'gram';
  if (['pc', 'pcs', 'piece', 'pieces', 'count', 'unit', 'units'].includes(lower))
    return 'piece';
  if (['pack', 'packs', 'package', 'packages'].includes(lower)) return 'pack';
  if (['bottle', 'bottles'].includes(lower)) return 'bottle';
  if (['can', 'cans'].includes(lower)) return 'can';
  if ((KNOWN_UNITS as string[]).includes(lower)) return lower as Unit;
  return 'other';
}

export function normaliseName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}
