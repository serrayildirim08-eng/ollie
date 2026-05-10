/**
 * @ollie/logic/products · period-product forecasting + inventory
 *
 * Three pure functions:
 *   - forecast: EWMA-per-type prediction of next cycle's needs
 *   - computeDailyUse: average per-day use across the user's history
 *   - deriveInventory: re-build an inventory snapshot from use events
 *     when no manual inventory record exists
 *
 * Falls back to population averages (tampon 20, pad 12, liner 5) for
 * cold-start users with no product-use history.
 */

import type { CycleRecord } from '../cycle/types';
import type { Forecast, Inventory, ProductUse } from './types';

export const PRODUCT_FALLBACK: Record<string, number> = {
  tampon: 20,
  pad: 12,
  liner: 5,
};

export const PRODUCT_LABELS: Record<string, string> = {
  tampon: 'tampons',
  pad: 'pads',
  liner: 'liners',
  cup: 'cups',
  disc: 'discs',
  'period-underwear': 'period underwear',
  'reusable-pad': 'reusable pads',
};

export function forecast(
  cycles: readonly CycleRecord[] | undefined | null,
  productUseEvents: readonly ProductUse[] | undefined | null,
): Forecast {
  const uses = productUseEvents || [];
  if (uses.length === 0) return { source: 'fallback', totals: { ...PRODUCT_FALLBACK } };

  const starts = (cycles || [])
    .map((c) => c?.cycleStartTs)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b);

  const perCycle: Record<number, Record<string, number>> = {};
  for (const p of uses) {
    if (!p || typeof p.ts !== 'number' || !p.type) continue;
    let idx = -1;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= p.ts) idx = i;
      else break;
    }
    if (idx < 0) continue;
    (perCycle[idx] ||= {});
    perCycle[idx][p.type] = (perCycle[idx][p.type] || 0) + (p.count || 1);
  }

  const byType: Record<string, number[]> = {};
  for (const cycleData of Object.values(perCycle)) {
    for (const [type, count] of Object.entries(cycleData)) {
      (byType[type] ||= []).push(count);
    }
  }

  const totals: Record<string, number> = {};
  for (const [type, arr] of Object.entries(byType)) {
    if (arr.length === 0) continue;
    let m = arr[0];
    for (let i = 1; i < arr.length; i++) m = 0.3 * arr[i] + 0.7 * m;
    totals[type] = Math.ceil(m);
  }

  if (Object.keys(totals).length === 0) return { source: 'fallback', totals: { ...PRODUCT_FALLBACK } };
  return { source: 'learned', totals };
}

export function computeDailyUse(
  cycles: readonly CycleRecord[] | undefined | null,
  productUseEvents: readonly ProductUse[] | undefined | null,
): Record<string, number> {
  const records = cycles || [];
  const uses = productUseEvents || [];
  if (records.length === 0 || uses.length === 0) return {};
  const totalDays = records.reduce((s, c) => s + (c?.cycleLengthDays ?? 28), 0);
  if (totalDays === 0) return {};
  const sums: Record<string, number> = {};
  for (const p of uses) {
    if (!p || !p.type) continue;
    sums[p.type] = (sums[p.type] || 0) + (p.count || 1);
  }
  const out: Record<string, number> = {};
  for (const [type, total] of Object.entries(sums)) {
    out[type] = +(total / totalDays).toFixed(2);
  }
  return out;
}

export function deriveInventory(
  productUseEvents: readonly ProductUse[] | undefined | null,
  storedInventory: Inventory | undefined | null,
): Inventory {
  if (storedInventory && Object.keys(storedInventory).length > 0) return storedInventory;
  const result: Inventory = {};
  for (const p of productUseEvents || []) {
    if (!p || !p.type || !p.count) continue;
    const existing = result[p.type];
    if (!existing || p.ts > existing.lastRestockedAt) {
      result[p.type] = { count: p.count, capacity: p.count, lastRestockedAt: p.ts };
    }
  }
  return result;
}

export type { Forecast, Inventory, InventoryEntry, ProductUse, ProductType } from './types';
