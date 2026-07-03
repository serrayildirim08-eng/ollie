/**
 * recurringMonthlyTotal — sum bills + subscriptions into one monthly figure
 * for the "bills & recurring" box header (Serra 2026-07-03).
 *
 * Each item is normalised to its monthly-equivalent (yearly ÷ 12, weekly ×
 * 52/12, monthly/unknown as-is), then summed PER CURRENCY (we never fake an
 * FX). Returns the lead currency's total — the one with the largest monthly
 * sum — so the header reads "₺18,210 / month". null when nothing has an amount.
 */

export interface RecurringItem {
  amount: number | null;
  currency: string | null;
  cadence: 'monthly' | 'yearly' | 'weekly' | null;
}

function toMonthly(amount: number, cadence: RecurringItem['cadence']): number {
  switch (cadence) {
    case 'yearly':
      return amount / 12;
    case 'weekly':
      return amount * (52 / 12);
    default:
      // monthly or unknown cadence — treat as a monthly figure.
      return amount;
  }
}

export function recurringMonthlyTotal(
  items: readonly RecurringItem[],
): { amount: number; currency: string | null } | null {
  // Key by currency ('' = no currency tag) so mixed currencies don't add up
  // into a nonsense number.
  const byCurrency = new Map<string, number>();
  for (const it of items) {
    if (it.amount == null || !Number.isFinite(it.amount)) continue;
    const key = it.currency ?? '';
    byCurrency.set(key, (byCurrency.get(key) ?? 0) + toMonthly(it.amount, it.cadence));
  }
  if (byCurrency.size === 0) return null;

  let leadKey = '';
  let leadVal = -Infinity;
  for (const [k, v] of byCurrency) {
    if (v > leadVal) {
      leadVal = v;
      leadKey = k;
    }
  }
  return { amount: leadVal, currency: leadKey === '' ? null : leadKey };
}
