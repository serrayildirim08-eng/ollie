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

/**
 * Split a comma / newline-delimited grocery item string into individual item
 * names. The dump router classifies a whole fragment as ONE grocery action
 * (e.g. "rice, tomato paste, olive oil" → pantry_add with that full string as
 * `item`), because pass-2 segmentation treats a same-intent list as a single
 * unit. Without this split each list lands as one giant card. We itemize here,
 * deterministically, so every item gets its own card AND inherits the action
 * (pantry vs shopping) the router already decided for the fragment — no extra
 * AI call, so it never rate-limits.
 *
 * Number-grouping guard: a comma is only a delimiter when it is NOT sitting
 * between two digits, so "$1,500" / "1,000 ml" survive as one token.
 */
const LIST_DELIM_RE = /\s*\r?\n\s*|\s*,(?=\s*(?:\D|$))\s*/g;
export function splitGroceryList(raw: string): string[] {
  return raw
    .split(LIST_DELIM_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const groceryHandler: ModuleHandler<'grocery'> = {
  module: 'grocery',
  async apply(fragment): Promise<HandlerResult> {
    await migrateGrocery();
    const p = fragment.payload as GroceryAction;
    switch (p.action) {
      case 'pantry_add': {
        // Multi-item list ("rice, tomato paste, olive oil") — itemize into
        // separate pantry cards, each inheriting this fragment's pantry intent.
        // We drop quantity/unit/price here: those describe the whole fragment
        // and can't be safely attributed to one item in a list. Single-item
        // dumps fall through to the rich path below (qty + finance mirror).
        const names = splitGroceryList(p.item);
        if (names.length > 1) {
          const added: Array<{ id: string; name: string }> = [];
          for (const name of names) {
            const it = await pantry.add({ name });
            try {
              await pantry.refreshPrediction(it.id);
            } catch (err) {
              console.error('[grocery] refreshPrediction failed', err);
            }
            added.push({ id: it.id, name: it.name });
          }
          return {
            ok: true,
            note: `added ${added.length} items to your pantry`,
            deepLink: '/box/grocery',
            undo: async () => {
              for (const it of added) {
                try { await pantry.remove(it.id); } catch { /* best-effort */ }
              }
            },
          };
        }

        const item = await pantry.add({
          name: p.item,
          quantity: (p as { quantity?: number | null }).quantity ?? null,
          unit: (p as { unit?: string | null }).unit ?? null,
        });

        // Replenishment wire: recompute the predicted out-date from this
        // item's cadence (purchase log) / shelf life and persist it. This is
        // what lights up the Shop "≈ likely needed" section + the out-of-stock
        // push — the prediction is null (cleared) when there's no clean signal,
        // so we never fabricate a date. Best-effort: a failure here must not
        // block the add from acknowledging.
        try {
          await pantry.refreshPrediction(item.id);
        } catch (err) {
          console.error('[grocery] refreshPrediction failed', err);
        }

        // Downstream multi-route: when the user said "bought milk for $5"
        // the router classifies as grocery.pantry_add with `price` +
        // `currency` on the payload. Mirror that to finance so the spend
        // shows up in both boxes. Per ARCH_DECISION_NEEDED.md (Serra,
        // 2026-05-28): grocery is the primary, finance is the side effect,
        // only when a price is actually present.
        const price = p.price;
        const currency = p.currency ?? null;
        let financeRowId: string | null = null;
        if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
          try {
            await migrateFinance();
            const tx = await financeTransactions.add({
              amount: price,
              currency,
              merchant: item.name,
            });
            financeRowId = tx.id;
          } catch (err) {
            console.error('[grocery] finance mirror failed', err);
          }
        }

        return {
          ok: true,
          note: `added ${item.name} to your pantry`,
          deepLink: '/box/grocery',
          undo: async () => {
            await pantry.remove(item.id);
            if (financeRowId) {
              try { await financeTransactions.remove(financeRowId); } catch { /* best-effort */ }
            }
          },
        };
      }

      case 'shopping_list_add': {
        // Multi-item list — itemize into separate shopping cards, each
        // inheriting this fragment's shopping intent. See pantry_add note.
        const names = splitGroceryList(p.item);
        if (names.length > 1) {
          const added: Array<{ id: string; name: string }> = [];
          for (const name of names) {
            const it = await shopping.add({ name });
            added.push({ id: it.id, name: it.name });
          }
          return {
            ok: true,
            note: `added ${added.length} items to your shopping list`,
            deepLink: '/box/grocery',
            undo: async () => {
              for (const it of added) {
                try { await shopping.remove(it.id); } catch { /* best-effort */ }
              }
            },
          };
        }

        const item = await shopping.add({
          name: p.item,
          quantity: (p as { quantity?: number | null }).quantity ?? null,
          unit: (p as { unit?: string | null }).unit ?? null,
        });
        return {
          ok: true,
          note: `added ${item.name} to your shopping list`,
          deepLink: '/box/grocery',
          undo: () => shopping.remove(item.id),
        };
      }

      case 'pantry_use': {
        // Undo intentionally omitted — pantry.use deletes (or decrements)
        // the row; rebuilding the prior quantity from a dump card is more
        // surface area than we want for the silent-dump UX. The user can
        // re-add via a fresh dump.
        await pantry.use({ name: p.item });
        return { ok: true, note: `marked ${p.item} as used`, deepLink: '/box/grocery' };
      }

      case 'pantry_depleted': {
        // "Out of X" — the user has run out: clear it from the pantry AND put
        // it on the shopping list in one move. Undo only restores the shopping
        // row (pantry-restore is omitted for the same reason as pantry_use).
        await pantry.use({ name: p.item });
        const item = await shopping.add({ name: p.item });
        return {
          ok: true,
          note: `out of ${item.name} — cleared the pantry, added to your list`,
          deepLink: '/box/grocery',
          undo: () => shopping.remove(item.id),
        };
      }

      case 'pantry_low_flag': {
        // Undo intentionally omitted — flipping `low_flag` back to 0 isn't
        // a clean inverse (we don't know whether the row was flagged before
        // we touched it, and flagLow may have inserted a placeholder row).
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
