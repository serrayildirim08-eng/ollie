/**
 * @ollie/logic · grocery types
 *
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Item shapes ─────────────────────────────────────────────────────────

export type GroceryCategory =
  | 'dairy'
  | 'meat'
  | 'deli'
  | 'produce'
  | 'drinks'
  | 'pantry'
  | 'cleaning'
  | 'frozen'
  | 'snacks'
  | 'supplements'
  | 'other';

export type GroceryIntent = 'ADD' | 'BOUGHT' | 'REMOVE' | 'UNKNOWN';

export interface AliasEntry {
  aliases: string[];
  category: GroceryCategory;
  shelfLifeDays: number;
}

export interface RecipeEntry {
  aliases: string[];
  cuisine: string;
  ingredients: string[];
}

export interface NormalizeResult {
  canonical: string | null;
  confidence: 'high' | 'medium' | 'low';
  method: 'exact' | 'alias' | 'prefix' | 'edit' | 'fail';
}

export interface ParsedGroceryItem {
  name: string;
  normalizedName: string | null;
  category: GroceryCategory | 'other';
  intent: GroceryIntent;
  qty?: number;
  unit?: string;
}

// ─── Pantry / history shapes ─────────────────────────────────────────────

export interface PantryItem {
  name?: string;
  normalizedName?: string;
  category?: string;
  boughtTs?: number;
  shelfLifeDays?: number;
  checked?: boolean;
  ts?: number;
  /**
   * Cadence/shelf-life-derived guess at when this row runs out, ms-since-epoch.
   * Null while we don't have enough signal. When this is in the PAST and the
   * row is still unarchived, the replenish-needed detector offers to re-add it.
   * (Mirrored from the native grocery_pantry.predicted_out_at_ms column.)
   */
  predictedOutAtMs?: number | null;
  /** True when the pantry row has been archived (gone / used up). */
  archived?: boolean;
}

export interface ShoppingItem extends PantryItem {
  text?: string;
}

export interface GroceryHistory {
  now?: number;
  pantry?: PantryItem[];
  items?: ShoppingItem[];
  dishHint?: string;
}

export interface GroceryOpts {
  now?: number;
  newCanonical?: string;
  windowDays?: number;
  minRebuys?: number;
  minDays?: number;
  minCount?: number;
  minEvents?: number;
  dishHint?: string;
}

// ─── Pattern / signal shapes ─────────────────────────────────────────────

export interface DuplicateSignal {
  pattern: 'grocery-duplicate-buy';
  confidence: 'high' | 'medium';
  sample_n: 1;
  name: string;
  days_since_purchase: number;
  copy: string;
  source: string;
}

export interface ExpirationDriftSignal {
  pattern: 'grocery-expiration-drift';
  confidence: 'high' | 'medium';
  sample_n: number;
  items: Array<{ name: string; days: number }>;
  copy: string;
  source: string;
}

export interface StockoutCascadeSignal {
  pattern: 'grocery-stockout-cascade';
  confidence: 'high' | 'medium';
  sample_n: number;
  items: Array<{ name: string; count: number }>;
  name: string;
  copy: string;
  source: string;
}

export interface RecipeInferredSignal {
  pattern: 'grocery-recipe-inferred';
  found: boolean;
  dish: string | null;
  cuisine?: string;
  ingredients?: string[];
  have?: string[];
  missing?: string[];
  drifters_count?: number;
  copy?: string;
  source?: string;
}

export interface ReplenishNeededSignal {
  pattern: 'grocery-replenish-needed';
  confidence: 'high' | 'medium';
  sample_n: number;
  items: Array<{ name: string; days: number }>;
  /** Soonest (most-overdue) predicted run-out ms — the brain reads it as urgencyAt. */
  predictedOutAtMs: number | null;
  copy: string;
}

export interface StaleListSignal {
  pattern: 'stale-shopping-list';
  confidence: 'high' | 'medium';
  sample_n: number;
  stale_count: number;
  sample_names: string[];
  copy: string;
}

export interface ShoppingCadenceSignal {
  pattern: 'shopping-cadence';
  confidence: 'high' | 'medium';
  sample_n: number;
  trips_count: number;
  avg_gap_days: number;
  copy: string;
}

export type GroceryPattern =
  | ExpirationDriftSignal
  | StockoutCascadeSignal
  | ReplenishNeededSignal
  | StaleListSignal
  | ShoppingCadenceSignal;

// ─── Known-store shape ───────────────────────────────────────────────────

export interface KnownStore {
  lat: number;
  lng: number;
  visitCount: number;
  lastSeenTs: number;
}

export interface GeoCoords {
  lat: number;
  lng: number;
}
