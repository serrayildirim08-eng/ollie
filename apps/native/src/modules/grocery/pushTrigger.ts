/**
 * Grocery · push trigger gating logic.
 *
 * Pure function `shouldPushReminder(row, nowMs)`. Returns true when the
 * cadence scanner should fire a system notification for this pantry row.
 * Returns false when ANY of these block:
 *
 *   1. `remind_me === false`        — user opt-out (or default for non-critical)
 *   2. `predicted_out_at_ms === null` — no prediction signal yet
 *   3. now is BEFORE the fire window (more than 1 day ahead of prediction)
 *   4. now is AFTER the fire window (more than 6 hours past prediction)
 *   5. `pushed_at_ms !== null`      — already pushed this cycle
 *   6. quiet hours (08:00 < local hour OR local hour >= 22:00)
 *
 * Fire window: `[predictedOut - 24h, predictedOut - 6h]`. Locked by Serra
 * 2026-05-30 — push fires once per cycle, one day before predicted out,
 * never within quiet hours.
 *
 * Reset semantics: `pushed_at_ms` is cleared by `pantry.add()` whenever a
 * new purchase of the same canonical lands (cycle restart). The next
 * prediction window can then fire again.
 *
 * This module is pure — no side effects, no orchestrator coupling. The
 * cadence scanner imports it, runs it per pantry row each scan, and the
 * caller dispatches `ollie:notify` + records `pantry.markPushed()` when
 * this returns true.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Default quiet-window bounds. 08:00 inclusive — 22:00 exclusive (local). */
export const DEFAULT_QUIET_START_HOUR = 8;
export const DEFAULT_QUIET_END_HOUR = 22;

/** Default fire window: 1 day to 6 hours before predicted out. */
export const DEFAULT_FIRE_LEAD_MS = DAY_MS;
export const DEFAULT_FIRE_TAIL_MS = 6 * HOUR_MS;

/** Minimal shape — accept anything with these fields so the scanner can
 *  pass either a PantryItem or a raw DB row without remapping. */
export interface PushTriggerRow {
  remindMe: boolean;
  predictedOutAtMs: number | null;
  pushedAtMs: number | null;
}

export interface ShouldPushOptions {
  /** Override the fire-window lead time. Defaults to 24h. */
  leadMs?: number;
  /** Override the fire-window tail time. Defaults to 6h. */
  tailMs?: number;
  /** Override the quiet-hours start (inclusive). Defaults to 8. */
  quietStartHour?: number;
  /** Override the quiet-hours end (exclusive). Defaults to 22. */
  quietEndHour?: number;
  /**
   * Inject a clock that returns "what is now's local hour". Tests pass a
   * fixed function; production uses `new Date(nowMs).getHours()`. The
   * pure-function shape makes timezone tests deterministic without juggling
   * process-level TZ env vars.
   */
  localHourOf?: (nowMs: number) => number;
}

/**
 * Returns true when the local hour is within the daily fire window.
 * Default window is 08:00 (inclusive) → 22:00 (exclusive). The bounds are
 * configurable so a future per-user quiet-hours preference can override.
 */
export function isWithinDailyWindow(
  nowMs: number,
  startHour = DEFAULT_QUIET_START_HOUR,
  endHour = DEFAULT_QUIET_END_HOUR,
  localHourOf: (ms: number) => number = (ms) => new Date(ms).getHours(),
): boolean {
  const hour = localHourOf(nowMs);
  if (!Number.isFinite(hour)) return false;
  return hour >= startHour && hour < endHour;
}

/**
 * Gating predicate — all six rules must pass. See module docstring.
 */
export function shouldPushReminder(
  row: PushTriggerRow,
  nowMs: number,
  opts: ShouldPushOptions = {},
): boolean {
  // 1. opt-out gate
  if (!row.remindMe) return false;

  // 2. no prediction → no fire
  if (typeof row.predictedOutAtMs !== 'number' || !Number.isFinite(row.predictedOutAtMs)) {
    return false;
  }

  // 5. already pushed this cycle
  if (row.pushedAtMs !== null && typeof row.pushedAtMs === 'number') {
    return false;
  }

  // 3 + 4. inside the fire window?
  const leadMs = typeof opts.leadMs === 'number' ? opts.leadMs : DEFAULT_FIRE_LEAD_MS;
  const tailMs = typeof opts.tailMs === 'number' ? opts.tailMs : DEFAULT_FIRE_TAIL_MS;
  const fireFrom = row.predictedOutAtMs - leadMs;
  const fireUntil = row.predictedOutAtMs - tailMs;
  if (nowMs < fireFrom) return false;
  if (nowMs >= fireUntil) return false;

  // 6. quiet hours — block fire while local hour is outside [start, end).
  const quietStart = opts.quietStartHour ?? DEFAULT_QUIET_START_HOUR;
  const quietEnd = opts.quietEndHour ?? DEFAULT_QUIET_END_HOUR;
  if (!isWithinDailyWindow(nowMs, quietStart, quietEnd, opts.localHourOf)) {
    return false;
  }

  return true;
}

/** Constants exported for test readability. */
export const PUSH_TRIGGER_DAY_MS = DAY_MS;
export const PUSH_TRIGGER_HOUR_MS = HOUR_MS;
