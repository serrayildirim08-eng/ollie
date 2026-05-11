/**
 * @ollie/notifications · budget + per-category mute
 *
 * Reads `shared.settings.notification_budget` from the store. Writes
 * the rolling daily log to `shared._notification_log` so we can answer
 * "have we already used today's budget?" deterministically across boots.
 *
 * Pure functions where possible — the store is injected.
 */

import type { Store } from '@ollie/store';
import type {
  NotificationBudget,
  NotificationCategory,
  NotificationLogEntry,
} from './types';

export const DEFAULT_BUDGET: NotificationBudget = {
  daily_cap: 4,
  muted_categories: [],
  aggregation_window_ms: 30 * 60 * 1000,
};

const LOG_CAP = 500; // ring buffer cap

export function readBudget(store: Store): NotificationBudget {
  const cfg = store.get<Partial<NotificationBudget>>(
    'shared',
    'settings.notification_budget',
    {},
  ) ?? {};
  return {
    daily_cap: typeof cfg.daily_cap === 'number' ? cfg.daily_cap : DEFAULT_BUDGET.daily_cap,
    muted_categories: Array.isArray(cfg.muted_categories) ? cfg.muted_categories : [],
    aggregation_window_ms:
      typeof cfg.aggregation_window_ms === 'number'
        ? cfg.aggregation_window_ms
        : DEFAULT_BUDGET.aggregation_window_ms,
  };
}

export function isMuted(budget: NotificationBudget, category: NotificationCategory): boolean {
  return budget.muted_categories.includes(category);
}

/** Local-day boundary for a ts. Used to scope the daily cap. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function readLog(store: Store): NotificationLogEntry[] {
  return store.get<NotificationLogEntry[]>('shared', '_notification_log', []) ?? [];
}

export function countDeliveredToday(store: Store, now: number): number {
  const start = startOfLocalDay(now);
  const log = readLog(store);
  let n = 0;
  for (const e of log) {
    if (e.ts >= start && e.delivered) n++;
  }
  return n;
}

export function appendLog(store: Store, entry: NotificationLogEntry): void {
  const log = readLog(store);
  log.push(entry);
  if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
  store.set('shared', '_notification_log', log);
}

/**
 * Returns true if a notification with this dedupe_key was delivered or
 * suppressed within the last 24h. Prevents same-event double-fires
 * across boots.
 */
export function isRecentlySeen(store: Store, dedupeKey: string, now: number): boolean {
  const log = readLog(store);
  const cutoff = now - 24 * 60 * 60 * 1000;
  return log.some((e) => e.dedupe_key === dedupeKey && e.ts >= cutoff);
}
