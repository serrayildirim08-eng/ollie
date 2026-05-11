/**
 * @ollie/logic · grocery · E8 interest-capture detector
 *
 * Replaces / complements the existing cascade detector (which counts
 * total rebuys of consumables — milk, eggs). This one captures the
 * ADHD-flavored novelty/interest pattern:
 *
 *   "you bought 3 keyboards in 21 days"  → interest capture
 *   "you bought 3 milks in 21 days"      → cascade (existing detector)
 *
 * Heuristic:
 *   - group by category (NOT by name — interest captures swap brands)
 *   - count distinct names within 21d window
 *   - threshold: 3+ distinct names in the same NON-consumable category
 *
 * "Non-consumable category" means: not in CONSUMABLE_CATEGORIES. Those
 * are filtered out because milk × 3 is cascade, not novelty.
 *
 * Pure — `now` injected, no store / events / DOM.
 */

import type { PantryItem, ShoppingItem } from './types';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 21;
const DEFAULT_THRESHOLD = 3;

// Categories that ARE consumables. Repeat purchases of these are
// existing-supply cascades, not novelty captures.
const CONSUMABLE_CATEGORIES = new Set<string>([
  'dairy', 'meat', 'deli', 'produce', 'drinks', 'pantry', 'frozen',
  'snacks', 'supplements',
]);

export interface InterestCaptureSignal {
  pattern: 'grocery-interest-capture';
  category: string;
  count: number;
  window_days: number;
  distinct_names: string[];
  copy: string;
}

interface PurchaseEvent {
  category: string;
  name: string;
  ts: number;
}

function purchasesFrom(
  pantry: PantryItem[],
  items: ShoppingItem[],
): PurchaseEvent[] {
  const out: PurchaseEvent[] = [];
  for (const p of pantry ?? []) {
    if (!p || typeof p.boughtTs !== 'number') continue;
    const cat = (p.category ?? 'other').toLowerCase();
    const name = (p.normalizedName ?? p.name ?? '').toLowerCase();
    if (!name) continue;
    out.push({ category: cat, name, ts: p.boughtTs });
  }
  for (const it of items ?? []) {
    // Checked items in the shopping list = purchased.
    if (!it?.checked || typeof it.ts !== 'number') continue;
    const cat = (it.category ?? 'other').toLowerCase();
    const name = (it.normalizedName ?? it.name ?? '').toLowerCase();
    if (!name) continue;
    out.push({ category: cat, name, ts: it.ts });
  }
  return out;
}

export function detectInterestCapture(
  input: { pantry?: PantryItem[]; items?: ShoppingItem[]; now: number },
  opts: { windowDays?: number; threshold?: number } = {},
): InterestCaptureSignal[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const cutoff = input.now - windowDays * DAY_MS;
  const purchases = purchasesFrom(input.pantry ?? [], input.items ?? [])
    .filter((p) => p.ts >= cutoff && p.ts <= input.now);

  const byCategory = new Map<string, Map<string, number>>();
  for (const p of purchases) {
    if (CONSUMABLE_CATEGORIES.has(p.category)) continue;
    if (!byCategory.has(p.category)) byCategory.set(p.category, new Map());
    const names = byCategory.get(p.category)!;
    names.set(p.name, (names.get(p.name) ?? 0) + 1);
  }

  const out: InterestCaptureSignal[] = [];
  for (const [cat, names] of byCategory) {
    if (names.size < threshold) continue;
    const distinct = Array.from(names.keys()).slice(0, 6);
    out.push({
      pattern: 'grocery-interest-capture',
      category: cat,
      count: names.size,
      window_days: windowDays,
      distinct_names: distinct,
      copy: `${windowDays / 7} weeks of ${cat} — pattern, not medical.`,
    });
  }
  return out;
}
