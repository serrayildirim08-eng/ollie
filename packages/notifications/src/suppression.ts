/**
 * @ollie/notifications · suppression
 *
 * Pure, side-effect-free logic for two notification-suppression features:
 *
 *   1. QUIET HOURS — defer any notification whose fire time lands inside the
 *      user's sleep window to the window's end (wake time). Never drops.
 *
 *   2. FOCUS-SESSION SUPPRESSION — while a focus/deep-work session is active,
 *      defer PATTERN_ALERT / CONTENT_DELIVERY notifications to the session's
 *      end. REMINDER passes through (functional deadlines may interrupt).
 *
 * Everything here takes `now` and the relevant state as parameters so it is
 * fully unit-testable. Wiring (reading the store) lives at the call sites:
 *   - apps/web/src/store.ts · scheduleNotificationWrapper (orchestrator cues)
 *   - packages/notifications/src/index.ts · notify() (in-process path)
 */

import type { NotificationCategory } from './types';

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

/** Fallback sleep length when settings carry no usable target_hours. */
export const DEFAULT_TARGET_HOURS = 7.5;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const MINUTES_PER_DAY = 24 * 60;

// ──────────────────────────────────────────────────────────────────────────
// Input shapes (mirror the relevant store slices, kept loose on purpose)
// ──────────────────────────────────────────────────────────────────────────

/** Subset of the `sleep`/`settings` slice this module reads. */
export interface SleepSettingsLike {
  /** Target bedtime as "HH:MM" (24h). null → quiet hours disabled. */
  target_bedtime?: string | null;
  /** Target sleep length in hours. Defaults to DEFAULT_TARGET_HOURS. */
  target_hours?: number | null;
}

/** The `work`/`active_focus` slice: a running focus session, or null. */
export interface ActiveFocus {
  /** ms epoch the session started. */
  startedAt: number;
  /** ms epoch the session is scheduled to end. */
  endsAt: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Time-of-day parsing
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse an "HH:MM" 24h string into minutes-since-midnight (0..1439).
 * Returns null for anything malformed or out of range.
 */
export function parseHHMM(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Clamp target sleep length to a sane [4, 12]h, defaulting when absent. */
export function resolveTargetHours(hours: number | null | undefined): number {
  if (typeof hours === 'number' && Number.isFinite(hours)) {
    return Math.max(4, Math.min(12, hours));
  }
  return DEFAULT_TARGET_HOURS;
}

// ──────────────────────────────────────────────────────────────────────────
// Quiet-hours window
// ──────────────────────────────────────────────────────────────────────────

/**
 * A resolved quiet-hours window expressed in minutes-since-local-midnight.
 * `wrapsMidnight` is true when end < start (e.g. bedtime 23:00 → wake 06:30).
 */
export interface QuietWindow {
  /** Minutes-since-midnight the window opens (bedtime). */
  startMin: number;
  /** Minutes-since-midnight the window closes (wake time). */
  endMin: number;
  /** True when the window crosses midnight. */
  wrapsMidnight: boolean;
}

/**
 * Derive the quiet-hours window from sleep settings.
 * Returns null when quiet hours are OFF (no/invalid target_bedtime).
 */
export function resolveQuietWindow(
  settings: SleepSettingsLike | null | undefined,
): QuietWindow | null {
  const startMin = parseHHMM(settings?.target_bedtime ?? null);
  if (startMin === null) return null;

  const targetHours = resolveTargetHours(settings?.target_hours);
  const lengthMin = Math.round(targetHours * 60);

  // A window >= a full day collapses to "always quiet"; clamp to just under.
  const span = Math.min(lengthMin, MINUTES_PER_DAY - 1);
  const endMin = (startMin + span) % MINUTES_PER_DAY;

  return {
    startMin,
    endMin,
    wrapsMidnight: endMin <= startMin,
  };
}

/** Minutes-since-local-midnight for a ms-epoch timestamp. */
function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * True when `fireAt` lands inside the quiet window.
 * Window is start-inclusive, end-exclusive: a notification scheduled exactly
 * at wake time is NOT considered inside (it's the moment quiet hours lift).
 */
export function isInQuietWindow(fireAt: number, window: QuietWindow): boolean {
  const mins = minutesOfDay(fireAt);
  if (window.wrapsMidnight) {
    // e.g. 23:00 → 06:30 : inside if after bedtime OR before wake.
    return mins >= window.startMin || mins < window.endMin;
  }
  // Same-day window, e.g. 01:00 → 08:30.
  return mins >= window.startMin && mins < window.endMin;
}

/**
 * Given a `fireAt` inside the quiet window, return the ms-epoch of the next
 * window END (wake time) at or after `fireAt`. Pure date math, local TZ.
 *
 * If `fireAt` is NOT inside the window this returns `fireAt` unchanged, so it
 * is safe to call unconditionally.
 */
export function deferPastQuietWindow(fireAt: number, window: QuietWindow): number {
  if (!isInQuietWindow(fireAt, window)) return fireAt;

  const fireDate = new Date(fireAt);
  // Wake time on the SAME calendar day as fireAt.
  const wakeToday = new Date(fireDate);
  wakeToday.setHours(0, 0, 0, 0);
  const wakeTodayMs = wakeToday.getTime() + window.endMin * MS_PER_MINUTE;

  if (wakeTodayMs > fireAt) {
    // Wake time later today is the correct end (covers same-day windows and
    // the pre-midnight tail of a wrapping window fired in the early hours).
    return wakeTodayMs;
  }
  // Wake time already passed today → next occurrence is tomorrow. This is the
  // post-bedtime branch of a wrapping window (e.g. fired at 23:30, wake 06:30).
  return wakeTodayMs + MS_PER_DAY;
}

// ──────────────────────────────────────────────────────────────────────────
// Focus-session suppression
// ──────────────────────────────────────────────────────────────────────────

/** Categories that a focus session is allowed to defer. REMINDER is exempt. */
const FOCUS_DEFERRABLE: ReadonlySet<NotificationCategory> = new Set<NotificationCategory>([
  'PATTERN_ALERT',
  'CONTENT_DELIVERY',
]);

/**
 * True when an active focus session should defer this notification:
 *   - a session is running NOW (now within [startedAt, endsAt))
 *   - the notification fires before the session ends
 *   - the category is deferrable (PATTERN_ALERT / CONTENT_DELIVERY)
 */
export function shouldDeferForFocus(
  fireAt: number,
  category: NotificationCategory,
  focus: ActiveFocus | null | undefined,
  now: number,
): boolean {
  if (!focus) return false;
  if (!FOCUS_DEFERRABLE.has(category)) return false;
  const sessionActive = now >= focus.startedAt && now < focus.endsAt;
  if (!sessionActive) return false;
  return fireAt < focus.endsAt;
}

// ──────────────────────────────────────────────────────────────────────────
// Combined entry point
// ──────────────────────────────────────────────────────────────────────────

export interface SuppressionInput {
  /** Intended fire time (ms epoch). For an immediate notification, pass `now`. */
  fireAt: number;
  /** The notification's constitutional category. */
  category: NotificationCategory;
  /** Current time (ms epoch). */
  now: number;
  /** Sleep settings slice (`sleep`/`settings`), or null. */
  sleepSettings: SleepSettingsLike | null | undefined;
  /** Active focus session slice (`work`/`active_focus`), or null. */
  activeFocus: ActiveFocus | null | undefined;
}

export interface SuppressionResult {
  /** The adjusted fire time. Always >= the input fireAt. Never a drop. */
  fireAt: number;
  /** True when either rule shifted the fire time. */
  deferred: boolean;
  /** Which rule(s) applied — useful for logging / debugging. */
  reasons: Array<'quiet-hours' | 'focus-session'>;
}

/**
 * Apply both suppression rules to a notification's fire time.
 *
 * Rules compose: focus suppression runs first (its end may itself fall inside
 * quiet hours), then quiet hours runs on the result so the final fireAt is
 * never inside the sleep window. Both only ever DEFER — never drop.
 */
export function applySuppression(input: SuppressionInput): SuppressionResult {
  const { category, now, sleepSettings, activeFocus } = input;
  let fireAt = input.fireAt;
  const reasons: SuppressionResult['reasons'] = [];

  // 1. Focus-session suppression — push to the session end.
  if (shouldDeferForFocus(fireAt, category, activeFocus, now) && activeFocus) {
    fireAt = activeFocus.endsAt;
    reasons.push('focus-session');
  }

  // 2. Quiet hours — push to wake time. Runs on the (possibly already
  //    focus-shifted) fireAt, applies to ALL categories.
  const window = resolveQuietWindow(sleepSettings);
  if (window && isInQuietWindow(fireAt, window)) {
    fireAt = deferPastQuietWindow(fireAt, window);
    reasons.push('quiet-hours');
  }

  return { fireAt, deferred: reasons.length > 0, reasons };
}
