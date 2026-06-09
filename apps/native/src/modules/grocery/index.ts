/**
 * Grocery module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { pantry, cadence as cadenceRepo } from './repo';

export { groceryHandler } from './handler';
export { migrateGrocery } from './migrate';
export { pantry, shopping, cadence } from './repo';
export { GroceryBox } from './GroceryBox';
export type { PantryItem, ShoppingItem, Unit } from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per pantry
 * canonical — the scanner decides which are overdue + dispatches the
 * notification. Caller (app boot) wires this into the root orchestrator
 * via `cadenceSources.grocery`.
 *
 * Failure mode: a per-item cadence read that throws is swallowed; the
 * scan continues with the remaining items.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const items = await pantry.list();
  const out: CadenceTrackedEntry[] = [];
  for (const item of items) {
    try {
      const estimate = await cadenceRepo.getCadenceFor(item.name);
      out.push({
        module: 'grocery',
        key: item.name,
        label: item.name,
        estimate,
      });
    } catch {
      /* skip a single broken row, don't kill the scan */
    }
  }
  return out;
}
