/**
 * Finance module · recurring detection adapter.
 *
 * Thin wrapper around @ollie/cadence/detectRecurring that:
 *   - Reads from finance_transactions (sole writer of the spend stream).
 *   - Canonicalises the merchant key via `normaliseMerchant` so the keying
 *     matches what the repo writes (lowercase, trim, single-space; we also
 *     strip lightweight punctuation here so "Sephora!" and "sephora" agree
 *     even when the router-stored merchant retained punctuation).
 *   - Maps the generic RecurringPattern → finance-shaped RecurringSuggestion
 *     (Cadence enum, currency carried through from the most recent tx).
 *
 * No writes. This is read-only surfacing — promotion to a real bill /
 * subscription happens in a separate user-driven flow (see the TODO in
 * FinanceBox where the tap-handler should land).
 *
 * The detection helper itself is module-agnostic and lives in @ollie/cadence
 * — the same pattern will later feed habits ("you've done X 3 weeks
 * running"), medication ("dose 1×/day for 14 days"), and pets ("feed
 * twice a day, last 10 days").
 */

import { detectRecurring, type RecurringPattern } from '@ollie/cadence';
import { transactions } from './repo';
import { normaliseMerchant } from './types';
import type { Cadence, FinanceTransaction } from './types';

/** One recurring suggestion surfaced under the transaction history. */
export interface RecurringSuggestion {
  /** Canonical merchant key — already lowercase + trimmed + de-punctuated. */
  merchant: string;
  /** Median amount across the matched group, or null when none of the rows
   *  carried an amount. We show "amount unknown" copy in that case. */
  medianAmount: number | null;
  /**
   * Currency from the most recent qualifying transaction. Sometimes null
   * (router didn't catch one) — UI handles by falling back to "$".
   */
  currency: string | null;
  /** Classified cycle — drives the UI copy and the promotion target. */
  cadence: Cadence;
  /** Cadence confidence — 'observed' or 'stable'. */
  confidence: 'observed' | 'stable';
  /** Sample size — surfaced as the "3 charges seen" caption. */
  sampleSize: number;
}

/**
 * Canonicalise more aggressively than `normaliseMerchant` does on its own.
 * The repo stores `normaliseMerchant` output already (lowercase, single-
 * space) — we extend by stripping trailing punctuation so a user typing
 * "Sephora!" and "Sephora" don't drift into separate groups. Kept here
 * (not in types.ts) because it only matters for detection grouping; the
 * stored value stays user-recognisable on the row.
 */
export function canonicalMerchantKey(raw: string | null | undefined): string | null {
  const base = normaliseMerchant(raw);
  if (!base) return null;
  // Drop punctuation other than apostrophes inside words ("trader joe's").
  // Collapse residual whitespace after stripping.
  const stripped = base
    .replace(/[!?,.;:"()[\]{}*~`#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length === 0 ? null : stripped;
}

/**
 * Detect recurring patterns across the current spend stream.
 *
 * Reads from `finance_transactions` (via repo.transactions.list) and runs
 * detection in memory — N is small (max a few hundred rows even after a
 * year of dogfood), so we don't need a query-side aggregation pass yet.
 */
export async function detectFinanceRecurring(): Promise<RecurringSuggestion[]> {
  const txs = await transactions.list();
  return detectFromTransactions(txs);
}

/**
 * Pure variant of `detectFinanceRecurring` — takes the rows as input so
 * the caller can re-use a fetch it already did. The FinanceBox uses this
 * to avoid a second DB read in the same poll tick.
 */
export function detectFromTransactions(
  txs: FinanceTransaction[],
): RecurringSuggestion[] {
  const events = txs
    .map((t) => {
      const key = canonicalMerchantKey(t.merchant);
      if (!key) return null;
      return {
        key,
        ts: t.occurredAt,
        amount: t.amount,
      };
    })
    .filter((x): x is { key: string; ts: number; amount: number | null } => x !== null);

  const patterns = detectRecurring(events);

  // Build a key → most-recent-tx map so we can pull a currency through.
  // We walk sorted-desc by occurredAt to land on the freshest currency.
  const sortedDesc = [...txs].sort((a, b) => b.occurredAt - a.occurredAt);
  const currencyByKey = new Map<string, string | null>();
  for (const t of sortedDesc) {
    const k = canonicalMerchantKey(t.merchant);
    if (!k) continue;
    if (!currencyByKey.has(k)) currencyByKey.set(k, t.currency);
  }

  return patterns.map((p) => patternToSuggestion(p, currencyByKey.get(p.key) ?? null));
}

function patternToSuggestion(
  p: RecurringPattern,
  currency: string | null,
): RecurringSuggestion {
  return {
    merchant: p.key,
    medianAmount: p.medianAmount,
    currency,
    cadence: cycleToCadence(p.cycle),
    confidence: p.confidence,
    sampleSize: p.sampleSize,
  };
}

/**
 * Map @ollie/cadence RecurringCycle → finance Cadence enum. The two enums
 * happen to share the same value set today, but keeping the switch keeps us
 * type-honest if either side gains a new variant.
 */
function cycleToCadence(cycle: RecurringPattern['cycle']): Cadence {
  switch (cycle) {
    case 'weekly':  return 'weekly';
    case 'monthly': return 'monthly';
    case 'yearly':  return 'yearly';
  }
}
