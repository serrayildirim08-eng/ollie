/**
 * apps/native · modules/grocery/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The grocery Layer-2 watcher (packages/orchestrator/src/grocery.ts) reads
 * `grocery.pantry` + `grocery.items` and computes `grocery.patterns` +
 * `grocery.interest_captures` (the duplicate-buy, expiration-drift,
 * stockout-cascade, stale-list, shopping-cadence detectors). Native captures
 * pantry + shopping list into SQLite (grocery/repo.ts) and never wrote the
 * store keys, so every detector ran on an empty input. This mirror fills them.
 *
 * Store keys written (INPUT to the watcher — read-replace):
 *   grocery.pantry  — pantry inventory mapped to the logic PantryItem shape
 *                     ({ name, normalizedName, boughtTs, shelfLifeDays,
 *                       checked, ts }). LOAD-BEARING for duplicate +
 *                       expiration-drift + cadence detectors.
 *   grocery.items   — shopping-list items mapped to ShoppingItem shape.
 *
 * NOT written here (OUTPUT the watcher owns — clobbering them would erase the
 * detector results): grocery.patterns, grocery.interest_captures,
 * grocery.patternsLastComputedAt, grocery._*.
 *
 * `boughtTs`/`ts` ← the native row's `addedAt` (its aging clock = last
 * restock). `shelfLifeDays` ← the shelf-life cache when loaded (null lets the
 * detector fall back to its own ALIAS_TABLE). Pantry rows are owned items so
 * `checked` is true; shopping rows are still-to-buy so `checked` is false.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import type { PantryItem as LogicPantryItem, ShoppingItem as LogicShoppingItem } from '@ollie/logic/grocery';
import { migrateGrocery } from './migrate';
import { pantry, shopping } from './repo';
import { normaliseName } from './types';
import { lookupDays } from './shelfLifeCache';

export async function syncToStore(store: Store): Promise<void> {
  await migrateGrocery();

  const [pantryRows, shoppingRows] = await Promise.all([
    pantry.list(),
    shopping.list(),
  ]);

  const mirroredPantry: LogicPantryItem[] = pantryRows.map((p) => {
    const normalizedName = normaliseName(p.name);
    const shelf = lookupDays(p.name);
    return {
      name: p.name,
      normalizedName,
      boughtTs: p.addedAt,
      ts: p.addedAt,
      // shelfLifeDays drives expiration-drift + the detector's "still fresh?"
      // gate; null when the cache hasn't loaded — the detector then falls
      // back to its own alias table, so a null is safe (not a wrong number).
      ...(shelf != null ? { shelfLifeDays: shelf } : {}),
      // Cadence/shelf-life run-out prediction — load-bearing for the
      // replenish-needed detector (the "milk noticing"). pantry.list() returns
      // only active rows, so archived is always false here; set it explicitly
      // so the detector's gate is honest regardless of the source query.
      predictedOutAtMs: p.predictedOutAtMs ?? null,
      archived: false,
      // A pantry row IS an owned item — model it as "checked" (bought) so the
      // duplicate detector treats it as in-stock.
      checked: true,
    };
  });

  const mirroredItems: LogicShoppingItem[] = shoppingRows.map((s) => ({
    name: s.name,
    normalizedName: normaliseName(s.name),
    ts: s.addedAt,
    boughtTs: s.addedAt,
    // Shopping-list rows are still to buy — not yet in the pantry.
    checked: false,
  }));

  store.set('grocery', 'pantry', mirroredPantry);
  store.set('grocery', 'items', mirroredItems);
}
