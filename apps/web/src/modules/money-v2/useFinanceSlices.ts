/**
 * money-v2 · useFinanceSlices — live store bridge
 *
 * Subscribes to the EXISTING `finance.*` store slices (the same keys the
 * live FinanceModule writes) and returns them as a single `FinanceSlices`
 * object for the v2 selectors. Read-only here; mutations go through the
 * dedicated action hooks (useMoneyActions).
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes.
 */
import { useStoreSlice } from '../../store';
import type {
  FinanceRecord,
  FinanceSettings,
  SpendBand,
} from '@ollie/logic/finance';
import type {
  FinanceSlices,
  StoredBill,
  StoredSub,
  StoredGoal,
  StoredTax,
  PrivacyState,
} from './selectors';

const EMPTY_PRIVACY: PrivacyState = { enabled: false, unlockedUntil: 0 };

export function useFinanceSlices(): FinanceSlices {
  const [records] = useStoreSlice<FinanceRecord[]>('finance', 'records', []);
  const [bills] = useStoreSlice<StoredBill[]>('finance', 'bills', []);
  const [subscriptions] = useStoreSlice<StoredSub[]>('finance', 'subscriptions', []);
  const [goals] = useStoreSlice<StoredGoal[]>('finance', 'goals', []);
  const [adhd_tax] = useStoreSlice<StoredTax[]>('finance', 'adhd_tax', []);
  const [settings] = useStoreSlice<FinanceSettings>('finance', 'settings', {});
  const [privacy] = useStoreSlice<PrivacyState>('finance', 'privacy', EMPTY_PRIVACY);
  const [safeToSpendBand] = useStoreSlice<SpendBand | null>('finance', 'safeToSpend', null);

  return {
    records,
    bills,
    subscriptions,
    goals,
    adhd_tax,
    settings,
    privacy,
    safeToSpend: safeToSpendBand,
  };
}
