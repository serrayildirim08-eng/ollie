/**
 * Stale-subscription signal · bridge + panel-visibility tests
 *
 * Background: FinanceModule computes `staleSubs` from the current recurring
 * patterns and publishes it to the `finance.staleSubs` store key. A sibling
 * component, FinanceSignalsSection, reads that key and renders the "quiet
 * subscriptions" panel. Before the bridge was wired the key was never
 * written, so the panel was permanently dead.
 *
 * Covered:
 *   computeStaleSubs (the bridge selector):
 *     1. flags a subscription/bill not seen in 90+ days
 *     2. returns [] when every pattern was seen recently
 *     3. honours a custom threshold from finance.settings
 *     4. drops patterns whose id is in dismissed_stale_pattern_ids
 *     5. ignores non-subscription/bill kinds (income)
 *   FinanceSignalsSection (the consumer):
 *     6. renders the "quiet subscriptions" panel when finance.staleSubs is set
 *     7. does NOT render it when finance.staleSubs is empty
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { RecurringPattern, StaleSubscription } from '@ollie/logic/finance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ───────────────────────────────────────────────────────────────
// FinanceModule imports `../../store`, which boots the full orchestrator at
// module load. Stub it with a Map-backed store that has a working setter.

const storeData = new Map<string, unknown>();

vi.mock('../../store', () => ({
  store: {
    get: (mod: string, key: string, fallback: unknown) => {
      const k = `${mod}:${key}`;
      return storeData.has(k) ? storeData.get(k) : fallback;
    },
    set: (mod: string, key: string, value: unknown) => {
      storeData.set(`${mod}:${key}`, value);
    },
    subscribe: () => () => {},
    subscribeKey: () => () => {},
  },
  useStoreSlice: <T,>(mod: string, key: string, defaultValue: T): [T, (v: T) => void] => {
    const k = `${mod}:${key}`;
    const val = (storeData.has(k) ? storeData.get(k) : defaultValue) as T;
    const setter = (v: T) => storeData.set(k, v);
    return [val, setter];
  },
  reminderScheduler: { add: () => {}, init: () => {} },
}));

vi.mock('@ollie/events', () => ({ emit: vi.fn() }));

// ─── imports (after mocks) ────────────────────────────────────────────────────

import {
  computeStaleSubs,
  FinanceSignalsSection,
  type FinanceSettings,
} from './FinanceModule';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 4, 18); // fixed clock

function pattern(over: Partial<RecurringPattern> = {}): RecurringPattern {
  return {
    id: 'p-netflix',
    merchant_normalized: 'netflix',
    display_name: 'Netflix',
    record_ids: ['r1', 'r2', 'r3'],
    cadence: 'monthly',
    interval_days_median: 30,
    interval_days_mad: 1,
    amount_median: 15.99,
    amount_mad: 0,
    last_at: NOW - 30 * DAY, // seen recently by default
    first_seen_at: NOW - 200 * DAY,
    last_seen_at: NOW - 30 * DAY,
    status: 'mature',
    kind: 'subscription',
    user_dismissed_stale: false,
    ...over,
  };
}

// ─── computeStaleSubs · the bridge selector ───────────────────────────────────

describe('computeStaleSubs', () => {
  it('flags a subscription not seen in 90+ days', () => {
    const stale = computeStaleSubs([pattern({ last_at: NOW - 120 * DAY })], {}, NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].pattern_id).toBe('p-netflix');
    expect(stale[0].days_since).toBe(120);
  });

  it('returns [] when the pattern was seen recently', () => {
    const stale = computeStaleSubs([pattern({ last_at: NOW - 20 * DAY })], {}, NOW);
    expect(stale).toEqual([]);
  });

  it('honours a custom threshold from finance.settings', () => {
    const recurring = [pattern({ last_at: NOW - 45 * DAY })];
    // 45 days < default 90 → not stale
    expect(computeStaleSubs(recurring, {}, NOW)).toEqual([]);
    // but stale under a 30-day threshold
    const settings: FinanceSettings = { stale_subscription_threshold_days: 30 };
    expect(computeStaleSubs(recurring, settings, NOW)).toHaveLength(1);
  });

  it('drops patterns listed in dismissed_stale_pattern_ids', () => {
    const recurring = [pattern({ last_at: NOW - 120 * DAY })];
    const settings: FinanceSettings = { dismissed_stale_pattern_ids: ['p-netflix'] };
    expect(computeStaleSubs(recurring, settings, NOW)).toEqual([]);
  });

  it('ignores non-subscription/bill kinds', () => {
    const income = pattern({ id: 'p-salary', kind: 'income', last_at: NOW - 200 * DAY });
    expect(computeStaleSubs([income], {}, NOW)).toEqual([]);
  });

  it('tolerates null / undefined inputs', () => {
    expect(computeStaleSubs(null, null, NOW)).toEqual([]);
    expect(computeStaleSubs(undefined, undefined, NOW)).toEqual([]);
  });
});

// ─── FinanceSignalsSection · the consumer ─────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  storeData.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('FinanceSignalsSection · quiet-subscriptions panel', () => {
  it('renders the panel when finance.staleSubs is populated', () => {
    const staleSubs: StaleSubscription[] = [
      { pattern_id: 'p-netflix', display_name: 'Netflix', days_since: 120, cadence: 'monthly' },
    ];
    storeData.set('finance:staleSubs', staleSubs);

    act(() => { root.render(<FinanceSignalsSection />); });

    expect(container.textContent).toContain('quiet subscriptions');
    expect(container.textContent).toContain('Netflix');
  });

  it('does NOT render the panel when finance.staleSubs is empty', () => {
    storeData.set('finance:staleSubs', []);

    act(() => { root.render(<FinanceSignalsSection />); });

    // No stale subs and no other signal → the whole section returns null.
    expect(container.textContent).not.toContain('quiet subscriptions');
    expect(container.querySelector('section')).toBeNull();
  });
});
