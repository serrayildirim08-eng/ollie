/**
 * money-v2 · useMoneyActions — write bridge
 *
 * The handful of mutations the v2 money screens perform, written through
 * the SAME store keys + shapes the live FinanceModule uses. Keeping these
 * shape-compatible means data logged through the v2 preview is visible to
 * the live module and vice-versa — they share one finance store.
 *
 * Records are written in the `FinanceRecord` shape `finance.records`
 * already holds (see DATA_SCHEMA.md / FinanceModule StoredTransaction is
 * separate; the v2 spend log appends a real FinanceRecord so safeToSpend
 * + adhd-tax detection pick it up).
 */
import { useCallback } from 'react';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import type { FinanceRecord } from '@ollie/logic/finance';
import type { StoredBill, StoredGoal, StoredSub, PrivacyState } from './selectors';

const EMPTY_PRIVACY: PrivacyState = { enabled: false, unlockedUntil: 0 };
const UNLOCK_WINDOW_MS = 5 * 60 * 1000;

export interface LogSpendInput {
  amount: number;
  category: string;
  /** mark this spend as an adhd-tax cost */
  adhdTax?: boolean;
}

export interface MoneyActions {
  /** append an out-direction FinanceRecord — feeds safeToSpend + adhd-tax */
  logSpend: (input: LogSpendInput) => void;
  /** add a stored bill */
  addBill: (b: Omit<StoredBill, 'id' | 'ts'>) => void;
  /** add a stored subscription */
  addSubscription: (s: Omit<StoredSub, 'id' | 'ts'>) => void;
  /** mark a subscription to cancel */
  markSubCancel: (id: string) => void;
  /** add money to the first savings goal (or create one) */
  addToSavings: (amount: number, goalName?: string) => void;
  /** toggle the privacy mask on/off */
  setPrivacyEnabled: (enabled: boolean) => void;
  /** unlock the mask for the standard window */
  unlockPrivacy: () => void;
}

export function useMoneyActions(now: number): MoneyActions {
  const [records, setRecords] = useStoreSlice<FinanceRecord[]>('finance', 'records', []);
  const [bills, setBills] = useStoreSlice<StoredBill[]>('finance', 'bills', []);
  const [subs, setSubs] = useStoreSlice<StoredSub[]>('finance', 'subscriptions', []);
  const [goals, setGoals] = useStoreSlice<StoredGoal[]>('finance', 'goals', []);
  const [privacy, setPrivacy] = useStoreSlice<PrivacyState>('finance', 'privacy', EMPTY_PRIVACY);

  const isoToday = new Date(now).toISOString().slice(0, 10);

  const logSpend = useCallback(
    ({ amount, category, adhdTax }: LogSpendInput) => {
      if (!(amount > 0)) return;
      const rec: FinanceRecord = {
        id: mkId(),
        created_at: now,
        last_edited_at: now,
        event_date: isoToday,
        amount,
        currency: 'USD',
        merchant: category,
        merchant_normalized: category.toLowerCase(),
        category,
        direction: 'out',
        is_adhd_tax: adhdTax ?? false,
        adhd_tax_type: adhdTax ? 'duplicate' : null,
      };
      setRecords([...(records ?? []), rec]);
    },
    [records, setRecords, now, isoToday],
  );

  const addBill = useCallback(
    (b: Omit<StoredBill, 'id' | 'ts'>) => {
      setBills([...(bills ?? []), { ...b, id: mkId(), ts: now }]);
    },
    [bills, setBills, now],
  );

  const addSubscription = useCallback(
    (s: Omit<StoredSub, 'id' | 'ts'>) => {
      setSubs([...(subs ?? []), { ...s, id: mkId(), ts: now }]);
    },
    [subs, setSubs, now],
  );

  const markSubCancel = useCallback(
    (id: string) => {
      setSubs(
        (subs ?? []).map((s) =>
          s.id === id ? { ...s, marked_to_cancel_at: now } : s,
        ),
      );
    },
    [subs, setSubs, now],
  );

  const addToSavings = useCallback(
    (amount: number, goalName?: string) => {
      if (!(amount > 0)) return;
      const list = goals ?? [];
      if (list.length === 0) {
        setGoals([
          {
            id: mkId(),
            name: goalName ?? 'a goal',
            target: Math.max(amount * 4, 1000),
            saved: amount,
            contributions: [{ amount, ts: now }],
            ts: now,
          },
        ]);
        return;
      }
      const [first, ...rest] = list;
      setGoals([
        {
          ...first,
          saved: (first.saved ?? 0) + amount,
          contributions: [...(first.contributions ?? []), { amount, ts: now }],
        },
        ...rest,
      ]);
    },
    [goals, setGoals, now],
  );

  const setPrivacyEnabled = useCallback(
    (enabled: boolean) => {
      setPrivacy({ enabled, unlockedUntil: enabled ? 0 : now + UNLOCK_WINDOW_MS });
    },
    [setPrivacy, now],
  );

  const unlockPrivacy = useCallback(() => {
    setPrivacy({ ...(privacy ?? EMPTY_PRIVACY), unlockedUntil: now + UNLOCK_WINDOW_MS });
  }, [privacy, setPrivacy, now]);

  return {
    logSpend,
    addBill,
    addSubscription,
    markSubCancel,
    addToSavings,
    setPrivacyEnabled,
    unlockPrivacy,
  };
}
