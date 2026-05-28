/**
 * Finance module · domain types.
 *
 * Three narrow record types that mirror the router's FinanceAction surface:
 *   - Transaction: a single spend ("paid rent", "spent $40 at sephora").
 *     Amount + currency + merchant are all individually nullable because the
 *     router often only catches one or two of them from a casual dump.
 *   - Bill: a recurring obligation. Cadence is a soft enum that can stay null
 *     if the user didn't say.
 *   - Subscription: a named service. Deduped by lowercased name in the repo.
 *
 * All timestamps are ms-since-epoch.
 */

export type Cadence = 'monthly' | 'yearly' | 'weekly';

export interface FinanceTransaction {
  id: string;
  amount: number | null;
  currency: string | null;  // ISO 4217 if known; null when the user said "$" with no symbol
  merchant: string | null;
  occurredAt: number;       // ms since epoch
}

export interface FinanceBill {
  id: string;
  merchant: string;
  amount: number | null;
  currency: string | null;
  cadence: Cadence | null;
  addedAt: number;
}

export interface FinanceSubscription {
  id: string;
  name: string;
  /** Per-cycle cost. Treated as monthly for burn math (the dominant cadence). */
  amount: number | null;
  currency: string | null;
  addedAt: number;
}

/**
 * Typed breakdown of the current calendar month's true commitment.
 * `transactions` are spends actually logged this month; `subscriptions` is
 * the monthly cost of every active subscription; `billsDue` is the
 * monthly-equivalent of every bill (monthly = full amount, yearly = /12,
 * weekly = *52/12). All three are summed into `total`.
 */
export interface MonthlyBurn {
  currency: string | null;
  transactions: number;
  subscriptions: number;
  billsDue: number;
  total: number;
}

export const KNOWN_CADENCES: Cadence[] = ['monthly', 'yearly', 'weekly'];

/** Normalise a cadence string from the router into our enum, or null. */
export function normaliseCadence(raw: string | undefined | null): Cadence | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if ((KNOWN_CADENCES as string[]).includes(lower)) return lower as Cadence;
  if (['month', 'mo', 'mth'].includes(lower)) return 'monthly';
  if (['year', 'yr', 'annual', 'annually'].includes(lower)) return 'yearly';
  if (['week', 'wk', 'weekly'].includes(lower)) return 'weekly';
  return null;
}

/** Normalise a currency code to its canonical ISO form so totals group cleanly. */
export function normaliseCurrency(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Coerce common natural-language variants to ISO codes — the router
  // sometimes returns "dollars" / "$" / "lira" alongside proper "USD" /
  // "TRY", which previously caused "this month" to NOT add them together.
  const lower = trimmed.toLowerCase();
  if (['$', 'dollar', 'dollars', 'usd'].includes(lower)) return 'USD';
  if (['€', 'euro', 'euros', 'eur'].includes(lower)) return 'EUR';
  if (['£', 'pound', 'pounds', 'gbp'].includes(lower)) return 'GBP';
  if (['₺', 'tl', 'lira', 'turkish lira', 'try'].includes(lower)) return 'TRY';
  if (['¥', 'yen', 'jpy'].includes(lower)) return 'JPY';
  if (/^[a-zA-Z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  return trimmed;
}

/** Normalise a merchant: trimmed lowercase, single spaces. */
export function normaliseMerchant(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return cleaned.length === 0 ? null : cleaned;
}

/** Normalise a subscription name: trimmed lowercase, single spaces. */
export function normaliseSubscriptionName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}
