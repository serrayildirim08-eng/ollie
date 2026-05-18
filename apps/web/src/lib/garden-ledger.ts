/**
 * apps/web · garden resource ledger
 *
 * The garden earns resources from real life. Every burhan life-event
 * (the already-aggregated cross-module event stream) credits the garden:
 * +1 water each, +1 seed every Nth (see @ollie/garden/resources).
 *
 * This is the *earn* half of the core loop (GARDEN_GAME_DESIGN.md §2/§3).
 * The ledger is append-only and idempotent — `ledgerCount` on the garden
 * slice tracks how many events have already been credited, so a reload or
 * a duplicate subscription fire can never double-credit.
 */

import {
  applyCredit,
  creditForEvents,
  defaultGardenState,
  type GardenState,
} from '@ollie/garden';
import type { BurhanState } from '@ollie/logic/burhan';
import type { Store } from '@ollie/store';

const GARDEN = { mod: 'garden', key: 'state' };
const BURHAN = { mod: 'burhan', key: 'state' };

function reconcile(store: Store): void {
  const burhan = store.get<BurhanState>(BURHAN.mod, BURHAN.key, { events: [] });
  const garden = store.get<GardenState>(GARDEN.mod, GARDEN.key, defaultGardenState());
  const total = burhan.events.length;
  if (total <= garden.ledgerCount) return;
  const earned = creditForEvents(garden.ledgerCount, total);
  store.set(GARDEN.mod, GARDEN.key, applyCredit(garden, earned, total));
}

/**
 * Wire the ledger to the store. Reconciles once for events that already
 * exist, then on every burhan-state change. Returns an unsubscribe fn.
 */
export function bootGardenLedger(store: Store): () => void {
  reconcile(store);
  return store.subscribeKey<BurhanState>(BURHAN.mod, BURHAN.key, () => reconcile(store));
}
