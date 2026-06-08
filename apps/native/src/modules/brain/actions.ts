/**
 * apps/native · modules/brain/actions.ts  —  offers really act (Sprint 3)
 *
 * DECISION 2 — when a noticing offers an action and she accepts it, the
 * assistant ACTUALLY does the thing. The pure layer (@ollie/logic/brain
 * actions) owns the serialisable descriptor (kind + label + payload); THIS is
 * the generic dispatcher that turns a descriptor into a real side effect.
 *
 * Today the only wired action is the milk/replenish noticing →
 * `add_to_grocery_list`, which really inserts each item into the grocery
 * shopping list (grocery/repo.ts `shopping.add` — the same call the user's own
 * "add milk" dump takes, deduped by name). The dispatcher is a thin switch over
 * `action.kind`, so future noticings attach an action by adding a kind in the
 * pure layer + a case here.
 *
 * Returns whether the action succeeded so the caller can clear the noticing
 * only on success. Best-effort: a thrown repo error is caught + reported false.
 */

import type { NoticingAction } from '@ollie/logic/brain';
import { shopping } from '../grocery/repo';
import { migrateGrocery } from '../grocery/migrate';

/** Run a noticing's suggested action for real. Returns true on success. */
export async function executeAction(action: NoticingAction): Promise<boolean> {
  try {
    switch (action.payload.kind) {
      case 'add_to_grocery_list': {
        await migrateGrocery();
        const names = action.payload.names.filter(Boolean);
        if (names.length === 0) return false;
        // Insert each item onto the shopping list. shopping.add dedupes by
        // name, so re-accepting is harmless (just refreshes the timestamp).
        for (const name of names) {
          await shopping.add({ name });
        }
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    console.error('[brain] executeAction failed (non-fatal):', err);
    return false;
  }
}
