/**
 * apps/web · app-lock state
 *
 * The "soft lock" that covers the whole app UI on cold boot and on
 * resume-after-idle, gated behind a platform-biometric (Face ID /
 * fingerprint / Windows Hello) check.
 *
 * WHAT THIS IS — a convenience re-entry gate, the same shape banking apps
 * ship: the user is ALREADY signed in, data is ALREADY decrypted in the
 * session. This is a curtain drawn over the UI so a borrowed/unattended
 * phone doesn't show ollie's contents. It does NOT replace the passphrase
 * and does NOT touch any encryption key. Disabling it loses nothing.
 *
 * WHAT THIS IS NOT — it is not auth. A locked app holds a live session.
 * The biometric check is purely "is the device owner here?".
 *
 * State (two keys, `shared` slice, mirrors NotificationPrimer's pattern):
 *   - `app_lock.enabled`    boolean · the user opted in (default OFF)
 *   - `app_lock.locked`     boolean · the curtain is currently down
 *
 * `locked` is intentionally PERSISTED, not session-only: if the tab is
 * killed while locked, the next cold boot should still come up locked.
 * The gate also re-locks on resume after `RELOCK_AFTER_MS` of background.
 * `app_lock.backgrounded_at` (epoch ms) records when the app last went to
 * the background so resume can measure the gap.
 */

import { store } from '../store';

/** Store coordinates. All three live in the `shared` module slice. */
export const APP_LOCK_SLICE = 'shared';
export const APP_LOCK_ENABLED_KEY = 'app_lock.enabled';
export const APP_LOCK_LOCKED_KEY = 'app_lock.locked';
export const APP_LOCK_BACKGROUNDED_AT_KEY = 'app_lock.backgrounded_at';

/**
 * How long the app may sit in the background before a resume re-locks it.
 * 60s — long enough that flipping to another app and back doesn't nag,
 * short enough that a phone left on a table re-locks promptly.
 */
export const RELOCK_AFTER_MS = 60_000;

/** True when the user has opted the app-lock feature on. Default OFF. */
export function isAppLockEnabled(): boolean {
  return Boolean(store.get<boolean>(APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY, false));
}

/** Opt the feature on or off. Turning it off also clears any live lock. */
export function setAppLockEnabled(on: boolean): void {
  store.set(APP_LOCK_SLICE, APP_LOCK_ENABLED_KEY, on);
  if (!on) {
    // Don't strand the user behind a curtain for a feature they just
    // disabled.
    store.set(APP_LOCK_SLICE, APP_LOCK_LOCKED_KEY, false);
  }
}

/** True when the curtain is currently down. */
export function isAppLocked(): boolean {
  return Boolean(store.get<boolean>(APP_LOCK_SLICE, APP_LOCK_LOCKED_KEY, false));
}

/** Draw the curtain — no-op when the feature is disabled. */
export function lockApp(): void {
  if (!isAppLockEnabled()) return;
  store.set(APP_LOCK_SLICE, APP_LOCK_LOCKED_KEY, true);
}

/** Lift the curtain. Called after a successful biometric/passphrase pass. */
export function unlockApp(): void {
  store.set(APP_LOCK_SLICE, APP_LOCK_LOCKED_KEY, false);
}

/** Record the moment the app went to the background. */
export function markBackgrounded(now: number = Date.now()): void {
  store.set(APP_LOCK_SLICE, APP_LOCK_BACKGROUNDED_AT_KEY, now);
}

/**
 * On resume: decide whether the idle gap warrants re-locking, and apply
 * the lock if so. Returns true when it locked. No-op when the feature is
 * off, or already locked, or the gap is under the threshold.
 */
export function relockIfIdle(
  now: number = Date.now(),
  threshold: number = RELOCK_AFTER_MS,
): boolean {
  if (!isAppLockEnabled()) return false;
  if (isAppLocked()) return false;
  const since = store.get<number>(APP_LOCK_SLICE, APP_LOCK_BACKGROUNDED_AT_KEY, 0);
  if (!since) return false;
  if (now - since < threshold) return false;
  lockApp();
  return true;
}

/**
 * Cold-boot seed: when the feature is enabled, the app should come up
 * locked. Idempotent — safe to call once on first render. Returns the
 * lock state after seeding.
 */
export function seedColdBootLock(): boolean {
  if (isAppLockEnabled()) {
    store.set(APP_LOCK_SLICE, APP_LOCK_LOCKED_KEY, true);
  }
  return isAppLocked();
}
