/**
 * Finance module · domain types.
 *
 * Mirrors the router's FinanceAction surface:
 *   - Transaction: a single spend ("paid rent", "spent $40 at sephora").
 *     Amount + currency + merchant are all individually nullable because the
 *     router often only catches one or two of them from a casual dump.
 *   - Bill: a recurring obligation. Cadence is a soft enum that can stay null
 *     if the user didn't say.
 *   - Subscription: a named service. Deduped by lowercased name in the repo.
 *   - Income: money IN — paychecks, freelance, gifts. New 2026-05-31.
 *   - Refund: money returned from a prior purchase. New 2026-05-31.
 *   - SpendingReflection: a user's reflection on a SPENDING PATTERN (not a
 *     single transaction). Surfaces in a future "patterns I've noticed"
 *     card. New 2026-05-31.
 *   - PendingDecision: a money decision the user hasn't made yet. Surfaces
 *     in the To-Do aggregate alongside admin.recurring_decision until the
 *     user marks it decided. New 2026-05-31.
 *
 * All timestamps are ms-since-epoch.
 */

export type Cadence = 'monthly' | 'yearly' | 'weekly';
export type ReflectionSentiment = 'concerned' | 'satisfied' | 'neutral';

export interface FinanceTransaction {
  id: string;
  amount: number | null;
  currency: string | null;  // ISO 4217 if known; null when the user said "$" with no symbol
  merchant: string | null;
  /**
   * Soft spending category — one of FINANCE_CATEGORIES or any freeform
   * label the user typed. Null when no category was captured (brain-dump
   * spends rarely name one). Feeds the category-keyed Layer-2 watchers
   * (hyperfocus burst, duplicate-by-category) via the bridge → finance.records.
   */
  category: string | null;
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
  /** Per-cycle cost, amortised to monthly via `cadence` for burn math. */
  amount: number | null;
  currency: string | null;
  /** Billing cadence. Null = unknown; burn math treats null as monthly. */
  cadence: Cadence | null;
  addedAt: number;
}

/**
 * Money IN. Source is whoever paid (a payer name like "akalan", or a generic
 * "salary" / "freelance"). Distinct from FinanceRefund (which is money back
 * from a prior purchase, not new income).
 */
export interface FinanceIncome {
  id: string;
  amount: number | null;
  currency: string | null;
  source: string | null;
  receivedAt: number;
}

/**
 * Money came back from a prior purchase. `originalItem` is the returned
 * item when the user named it ("returned the scarf"); merchant is the
 * payer ("amazon refunded me"). Both individually nullable since the
 * router catches only what the user says.
 */
export interface FinanceRefund {
  id: string;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  originalItem: string | null;
  refundedAt: number;
}

/**
 * A reflection on a spending PATTERN, not a single transaction. `note` is
 * the reflection itself (required); `category` is what's being reflected
 * on; `sentiment` lets the future "patterns I've noticed" surface pick a
 * tone. Defaults: sentiment = 'concerned' for pattern-marker reflections.
 */
export interface FinanceSpendingReflection {
  id: string;
  note: string;
  category: string | null;
  sentiment: ReflectionSentiment;
  notedAt: number;
}

// Note: the canonical pending-decision row type is `PendingDecisionRow`
// in repo.ts (predates this expansion and is what the /todo aggregate
// already consumes). The dump-routed fields (amount/currency/deadline/
// decidedAtMs) were grafted onto that type rather than duplicated.

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

/**
 * Preset spending categories offered in the tap-to-log picker. The user can
 * still type a freeform label, so this is a convenience list, NOT a closed
 * enum — `normaliseCategory` accepts anything. Kept lowercase to match how
 * the category-keyed watchers group (patterns.ts lowercases on read).
 */
export const FINANCE_CATEGORIES = [
  'groceries',
  'dining',
  'transport',
  'health',
  'shopping',
  'subscriptions',
  'other',
] as const;

export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

/**
 * Normalise a category label: trimmed lowercase, single spaces. Accepts any
 * freeform string (not just FINANCE_CATEGORIES); returns null for empty/blank
 * so the column stays honestly nullable. No "other" coercion — an unset
 * category and an explicit "other" are different signals to the watchers.
 */
export function normaliseCategory(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return cleaned.length === 0 ? null : cleaned;
}

const KNOWN_SENTIMENTS: ReflectionSentiment[] = ['concerned', 'satisfied', 'neutral'];
/** Normalise a reflection sentiment from the router. Defaults to "concerned"
 *  because the trigger phrases ("too much", "again", "Nth time") are
 *  inherently concerned. Defensive: bad/missing strings fall back rather
 *  than crash the handler. */
export function normaliseSentiment(raw: string | undefined | null): ReflectionSentiment {
  if (!raw) return 'concerned';
  const lower = raw.toLowerCase().trim();
  if ((KNOWN_SENTIMENTS as string[]).includes(lower)) return lower as ReflectionSentiment;
  return 'concerned';
}

