/**
 * Grocery module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every grocery action the
 * router emits to a real repository call. Notes are kept short — the dump
 * UX is silent ("okay!" only); these notes are for dev logging + any
 * future surface that wants to show what happened.
 */

import type { GroceryAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateGrocery } from './migrate';
import { pantry, shopping } from './repo';
import { migrateFinance } from '../finance/migrate';
import { transactions as financeTransactions } from '../finance/repo';

export const groceryHandler: ModuleHandler<'grocery'> = {
  module: 'grocery',
  async apply(fragment): Promise<HandlerResult> {
    await migrateGrocery();
    const p = fragment.payload as GroceryAction;
    switch (p.action) {
      case 'pantry_add': {
        const item = await pantry.add({
          name: p.item,
          quantity: (p as { quantity?: number | null }).quantity ?? null,
          unit: (p as { unit?: string | null }).unit ?? null,
        });

        // Downstream multi-route: when the user said "bought milk for $5"
        // the router classifies as grocery.pantry_add with `price` +
        // `currency` on the payload. Mirror that to finance so the spend
        // shows up in both boxes. Per ARCH_DECISION_NEEDED.md (Serra,
        // 2026-05-28): grocery is the primary, finance is the side effect,
        // only when a price is actually present.
        const price = (p as { price?: number | null }).price;
        const currency = (p as { currency?: string | null }).currency ?? null;
        if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
          try {
            await migrateFinance();
            await financeTransactions.add({
              amount: price,
              currency,
              merchant: item.name,
            });
          } catch (err) {
            console.error('[grocery] finance mirror failed', err);
          }
        }

        return {
          ok: true,
          note: `added ${item.name} to your pantry`,
          deepLink: '/box/grocery',
        };
      }

      case 'shopping_list_add': {
        const item = await shopping.add({
          name: p.item,
          quantity: (p as { quantity?: number | null }).quantity ?? null,
          unit: (p as { unit?: string | null }).unit ?? null,
        });
        return {
          ok: true,
          note: `added ${item.name} to your shopping list`,
          deepLink: '/box/grocery',
        };
      }

      case 'pantry_use': {
        await pantry.use({ name: p.item });
        return { ok: true, note: `marked ${p.item} as used`, deepLink: '/box/grocery' };
      }

      case 'pantry_low_flag': {
        await pantry.flagLow(p.item);
        return { ok: true, note: `flagged ${p.item} as running low`, deepLink: '/box/grocery' };
      }

      case 'meal_request':
        // No persistence yet — meal suggestions land in a follow-up sprint
        // when the meal-plan repo lands. For now just acknowledge.
        return { ok: true, note: `looking into "${p.query}"` };

      case 'recipe_cooked':
        // Same — recipe history needs its own table, deferred.
        return { ok: true, note: `logged tonight's cook: ${p.name}` };

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`grocery: unhandled action ${JSON.stringify(p)}`);
}
