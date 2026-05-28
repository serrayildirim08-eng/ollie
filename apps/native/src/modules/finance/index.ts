/**
 * Finance module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { transactions, cadence as cadenceRepo } from './repo';
import { canonicalMerchantKey } from './recurring';

export { financeHandler } from './handler';
export { migrateFinance } from './migrate';
export { bills, getMonthlyBurn, subscriptions, transactions, cadence } from './repo';
export { FinanceBox } from './FinanceBox';
export type {
  Cadence,
  FinanceBill,
  FinanceSubscription,
  FinanceTransaction,
  MonthlyBurn,
} from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per distinct
 * merchant in the transaction stream, keyed by the canonical merchant
 * label (`canonicalMerchantKey`) so the scanner's dedupe + the recurring
 * detector agree on the surface. Transactions with no merchant are
 * skipped — no useful key to scan against.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const list = await transactions.list();
  const merchants = new Set<string>();
  for (const t of list) {
    const key = canonicalMerchantKey(t.merchant);
    if (key) merchants.add(key);
  }

  const out: CadenceTrackedEntry[] = [];
  for (const merchant of merchants) {
    try {
      const estimate = await cadenceRepo.getMerchantCadenceFor(merchant);
      out.push({
        module: 'finance',
        key: merchant,
        label: merchant,
        estimate,
      });
    } catch {
      /* skip one broken merchant, keep scanning */
    }
  }
  return out;
}
