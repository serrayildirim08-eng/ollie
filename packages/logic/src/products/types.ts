/**
 * @ollie/logic/products · types
 *
 * Period products — tampons, pads, liners, cup, disc, period underwear,
 * reusable pads. Inventory is forecasted from per-cycle use history.
 */

export type ProductType =
  | 'tampon'
  | 'pad'
  | 'liner'
  | 'cup'
  | 'disc'
  | 'period-underwear'
  | 'reusable-pad';

export interface ProductUse {
  ts: number;
  type: ProductType | string;
  count?: number;
}

export interface Forecast {
  source: 'fallback' | 'learned';
  totals: Record<string, number>;
}

export interface InventoryEntry {
  count: number;
  capacity: number;
  lastRestockedAt: number;
}

export type Inventory = Record<string, InventoryEntry>;
