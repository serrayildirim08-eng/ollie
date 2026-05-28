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
  addedAt: number;
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

/** Normalise a currency code: ISO uppercase ("usd" → "USD") or null. */
export function normaliseCurrency(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Pass symbols through so the UI can still render "$15"; uppercase
  // 3-letter alpha codes for normalised storage.
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
