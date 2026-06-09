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
import {
  bills,
  income,
  pending,
  reflections,
  refunds,
  subscriptions,
  transactions,
} from './repo';
import { migrateAdmin } from '../admin/migrate';
import { renewals as adminRenewals } from '../admin/repo';

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

        // Cross-module mirror (Approach B): when the payment is explicitly for
        // a renewal-able document, also log an admin renewal so the upcoming
        // event surfaces in the admin box + /todo aggregate.
        // If the mirror fails we log but do NOT roll back the primary write.
        const ALLOWED_RENEWAL_TYPES = new Set([
          'passport', 'license', 'visa', 'lease', 'insurance',
          'id', 'work_permit', 'residency_permit',
        ]);
        let adminRenewalId: string | null = null;
        if (p.renewal_for && ALLOWED_RENEWAL_TYPES.has(p.renewal_for)) {
          try {
            await migrateAdmin();
            const ren = await adminRenewals.add({ renewalType: p.renewal_for, dueDate: null });
            adminRenewalId = ren.id;
          } catch (err) {
            console.error('[finance] admin renewal mirror failed', err);
          }
        }

        const label = tx.merchant ?? 'transaction';
        return {
          ok: true,
          note: `logged ${label}`,
          deepLink: '/box/finance',
          undo: async () => {
            // Remove admin mirror first (reverse order), then primary row.
            if (adminRenewalId) {
              try { await adminRenewals.remove(adminRenewalId); } catch { /* best-effort */ }
            }
            await transactions.remove(tx.id);
          },
        };
      }

      case 'add_bill': {
        const bill = await bills.add({
          merchant: p.merchant,
          amount: p.amount ?? null,
          cadence: p.cadence ?? null,
        });
        // NOTE: bills.add is an upsert — undo removes the row even if it was
        // a refresh-of-existing rather than a fresh insert. The trade-off is
        // intentional: the user said "undo what I just dumped" and the
        // visible state delta is the merchant row regardless of whether it
        // existed before. Same pattern as subscriptions below.
        return {
          ok: true,
          note: `added bill: ${bill.merchant}`,
          deepLink: '/box/finance',
          undo: () => bills.remove(bill.id),
        };
      }

      case 'savings_note': {
        // Stored as a transaction with a "savings" merchant tag so the box
        // surfaces it. Amount nullable; note is dev-only for now (no
        // dedicated notes column yet).
        const tx = await transactions.add({
          amount: p.amount ?? null,
          merchant: 'savings',
        });
        return {
          ok: true,
          note: p.note ? `savings: ${p.note}` : 'savings noted',
          deepLink: '/box/finance',
          undo: () => transactions.remove(tx.id),
        };
      }

      case 'subscription_log': {
        // amount/currency/cadence are stored when the user states them
        // ("netflix $15/month") so the burn headline amortises correctly.
        const sub = await subscriptions.add({
          name: p.name,
          amount: p.amount ?? null,
          currency: p.currency ?? null,
          cadence: p.cadence ?? null,
        });
        return {
          ok: true,
          note: `tracked subscription: ${sub.name}`,
          deepLink: '/box/finance',
          undo: () => subscriptions.remove(sub.id),
        };
      }

      case 'log_income': {
        const row = await income.add({
          amount: p.amount ?? null,
          currency: p.currency ?? null,
          source: p.source ?? null,
        });
        const label = row.source ?? 'income';
        return {
          ok: true,
          note: `logged income: ${label}`,
          deepLink: '/box/finance',
          undo: () => income.remove(row.id),
        };
      }

      case 'log_refund': {
        const row = await refunds.add({
          amount: p.amount ?? null,
          currency: p.currency ?? null,
          merchant: p.merchant ?? null,
          originalItem: p.originalItem ?? null,
        });
        const label = row.originalItem ?? row.merchant ?? 'refund';
        return {
          ok: true,
          note: `logged refund: ${label}`,
          deepLink: '/box/finance',
          undo: () => refunds.remove(row.id),
        };
      }

      case 'spending_reflection': {
        // `note` is REQUIRED at the schema level; the handler treats it
        // defensively and falls back to a generic label if the worker
        // somehow emits an empty string. We do NOT skip — the user took
        // the time to dump a reflection; silently dropping it is worse
        // than persisting a slightly-thin row.
        const note = (p.note ?? '').trim() || 'spending reflection';
        const row = await reflections.add({
          note,
          category: p.category ?? null,
          sentiment: p.sentiment ?? null,
        });
        return {
          ok: true,
          note: row.category
            ? `reflection: ${row.category}`
            : 'reflection logged',
          deepLink: '/box/finance',
          undo: () => reflections.remove(row.id),
        };
      }

      case 'pending_decision': {
        // Lands in the To-Do aggregate alongside admin.recurring_decision.
        // `what` is REQUIRED at the schema level; defensive fallback as
        // above. amount / currency / deadline pass through when present.
        const what = (p.what ?? '').trim() || 'pending decision';
        const row = await pending.add({
          what,
          amount: p.amount ?? null,
          currency: p.currency ?? null,
          deadline: p.deadline ?? null,
        });
        return {
          ok: true,
          note: `pending: ${row.what}`,
          deepLink: '/box/finance',
          undo: () => pending.remove(row.id),
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
