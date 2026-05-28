/**
 * Finance module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every FinanceAction the
 * router emits to a real repository call. Notes are kept short — the dump
 * UX is silent ("okay!" only); these notes are for dev logging + any
 * future surface that wants to show what happened.
 *
 * Missing fields are handled gracefully: a `log_transaction` with no
 * amount still persists (the user said "paid rent" without a number); a
 * `savings_note` with no amount stores just the note as a zero-amount
 * transaction tagged with a "savings" merchant so it surfaces in the box.
 */

import type { FinanceAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateFinance } from './migrate';
import { bills, subscriptions, transactions } from './repo';

export const financeHandler: ModuleHandler<'finance'> = {
  module: 'finance',
  async apply(fragment): Promise<HandlerResult> {
    await migrateFinance();
    const p = fragment.payload as FinanceAction;
    switch (p.action) {
      case 'log_transaction': {
        const tx = await transactions.add({
          amount: p.amount ?? null,
          currency: p.currency ?? null,
          merchant: p.merchant ?? null,
        });
        const label = tx.merchant ?? 'transaction';
        return {
          ok: true,
          note: `logged ${label}`,
          deepLink: '/box/finance',
        };
      }

      case 'add_bill': {
        const bill = await bills.add({
          merchant: p.merchant,
          amount: p.amount ?? null,
          cadence: p.cadence ?? null,
        });
        return {
          ok: true,
          note: `added bill: ${bill.merchant}`,
          deepLink: '/box/finance',
        };
      }

      case 'savings_note': {
        // Stored as a transaction with a "savings" merchant tag so the box
        // surfaces it. Amount nullable; note is dev-only for now (no
        // dedicated notes column yet).
        await transactions.add({
          amount: p.amount ?? null,
          merchant: 'savings',
        });
        return {
          ok: true,
          note: p.note ? `savings: ${p.note}` : 'savings noted',
          deepLink: '/box/finance',
        };
      }

      case 'subscription_log': {
        // amount + currency are forward-compat — the router prompt only
        // emits `name` today, but the column is here so the burn headline
        // picks them up the moment the prompt is taught to extract them.
        const sub = await subscriptions.add({
          name: p.name,
          amount: p.amount ?? null,
          currency: p.currency ?? null,
        });
        return {
          ok: true,
          note: `tracked subscription: ${sub.name}`,
          deepLink: '/box/finance',
        };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`finance: unhandled action ${JSON.stringify(p)}`);
}
