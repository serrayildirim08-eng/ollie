/**
 * apps/web · F2 · savings monthly digest
 *
 * Opt-in PATTERN_ALERT that fires on the last day of each calendar
 * month. The user toggles `shared.settings.notify_savings_digest` to
 * turn it on (default off — constitutional: no engagement push unless
 * explicit consent).
 *
 * The scheduler runs in-process. On every boot we compute the next
 * fire time (23:00 local on the last day of the month) and call
 * notify({ schedule_at }) — the notifications package owns
 * persistence + the platform-native schedule + budget enforcement.
 *
 * Copy goes through @ollie/logic/finance buildMonthlyDigestCopy →
 * passive voice, factual. Banned-phrase scanner runs over the source
 * on every PR.
 */

import { notify, cancel } from '@ollie/notifications';
import {
  buildMonthlyDigestCopy,
  cancellationsAccruedThisMonth,
  computeSavings,
  savingsThisMonth,
} from '@ollie/logic/finance';
import type { Cancellation } from '@ollie/logic/finance';
import { store } from '../store';

const DEDUPE_KEY_PREFIX = 'savings-digest';

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * Next fire ts: 23:00 local on the last day of this month if still in
 * the future, else 23:00 local on the last day of next month.
 */
export function nextDigestFireAt(now: number): number {
  const d = new Date(now);
  const lastThis = new Date(
    d.getFullYear(),
    d.getMonth(),
    lastDayOfMonth(d.getFullYear(), d.getMonth()),
    23, 0, 0, 0,
  );
  if (lastThis.getTime() > now) return lastThis.getTime();
  const lastNext = new Date(
    d.getFullYear(),
    d.getMonth() + 1,
    lastDayOfMonth(d.getFullYear(), d.getMonth() + 1),
    23, 0, 0, 0,
  );
  return lastNext.getTime();
}

function isEnabled(): boolean {
  return Boolean(store.get<boolean>('shared', 'settings.notify_savings_digest', false));
}

function dedupeKeyFor(fireAt: number): string {
  const d = new Date(fireAt);
  return `${DEDUPE_KEY_PREFIX}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildDigestSpec(now: number) {
  const cancellations = store.get<Cancellation[]>('finance', 'cancellations', []) ?? [];
  const totals = computeSavings(cancellations, now);
  const thisMonth = savingsThisMonth(cancellations, now);
  const monthCancels = cancellationsAccruedThisMonth(cancellations, now);
  const fireAt = nextDigestFireAt(now);
  return {
    title: buildMonthlyDigestCopy(totals, monthCancels, thisMonth),
    fireAt,
    dedupeKey: dedupeKeyFor(fireAt),
  };
}

/**
 * Call once at boot. Idempotent — same fire ts produces the same
 * dedupe_key, so re-scheduling won't double-fire.
 *
 * Returns the dedupe_key when scheduled, null when opt-out.
 */
export async function scheduleSavingsDigest(now: number = Date.now()): Promise<string | null> {
  if (!isEnabled()) {
    // Make sure no stale digest is lingering after the user toggles off.
    const stale = store.get<string | null>('shared', '_savings_digest_pending', null);
    if (stale) {
      cancel(stale);
      store.set('shared', '_savings_digest_pending', null);
    }
    return null;
  }

  const { title, fireAt, dedupeKey } = buildDigestSpec(now);
  if (!title) return null;

  await notify({
    title,
    category: 'PATTERN_ALERT',
    dedupe_key: dedupeKey,
    schedule_at: fireAt,
    extra: { feature: 'savings-digest' },
  });
  store.set('shared', '_savings_digest_pending', dedupeKey);
  return dedupeKey;
}

/**
 * Convenience: install a re-scheduler that runs scheduleSavingsDigest()
 * after each fire window (1h after the planned fire ts) so the next
 * month's digest is queued. Idempotent.
 */
export function installSavingsDigestLoop(): void {
  void scheduleSavingsDigest();
  // Recheck once a day at app focus — cheap and avoids missing the
  // monthly transition if the app is left open for weeks.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void scheduleSavingsDigest();
    });
  }
}
