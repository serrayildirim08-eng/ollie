/**
 * Medication cabinet · low-stock logic.
 *
 * Low-stock is decided by BOTH signals, with the manual flag winning:
 *   1. MANUAL OVERRIDE — `lowFlag` is the user's explicit "running low" / "have"
 *      switch ("running low on vitamin d"). When set true it ALWAYS reads low;
 *      when the user later says "got more" / "have it" it clears the flag.
 *   2. AUTO COUNT-DOWN — when BOTH a `qty` (pills remaining) and a daily
 *      schedule (doses/day) are known, we can project how many days of supply
 *      remain and flag low at a small threshold. No qty entered → no auto
 *      signal, the cabinet degrades to manual-only.
 *
 * Deterministic (brain/body split): the decrement happens in the handler on a
 * "taken" event; this module is the pure predicate the repo + UI read.
 *
 * Tone: a low flag is a calm amber dot, never a red alarm — health data.
 */

/** Days-of-supply at or below this threshold reads as "running low". */
export const LOW_DAYS_THRESHOLD = 5;

/** Absolute pill count at or below this reads low even with no schedule known
 *  (a handful of pills left is low regardless of how often you take it). */
export const LOW_QTY_FLOOR = 3;

export interface LowStockInput {
  /** Manual override flag — the user said "running low" (true) or "have" (false). */
  lowFlag: boolean;
  /** Pills / units remaining, or null/undefined when the user never entered a count. */
  qty?: number | null;
  /** Doses per day from the linked schedule (schedule.length), or 0 when no schedule. */
  dosesPerDay?: number;
}

/**
 * Is this cabinet item running low?
 *   - manual `lowFlag` true → always low (override).
 *   - else, when qty is known:
 *       · qty ≤ LOW_QTY_FLOOR → low (almost out, regardless of schedule).
 *       · qty + a daily schedule → low when projected days-of-supply ≤ threshold.
 *   - else (no qty) → not auto-low; manual-only (lowFlag governs).
 */
export function isLow(input: LowStockInput): boolean {
  if (input.lowFlag) return true;

  const qty = normaliseQty(input.qty);
  if (qty == null) return false; // manual-only: no count → no auto signal

  if (qty <= LOW_QTY_FLOOR) return true;

  const perDay = normalisePerDay(input.dosesPerDay);
  if (perDay > 0) {
    const daysLeft = qty / perDay;
    if (daysLeft <= LOW_DAYS_THRESHOLD) return true;
  }
  return false;
}

/**
 * Projected days of supply remaining, or null when it can't be computed
 * (no qty, or no daily schedule). For a calm "~N days left" sub-line.
 */
export function daysOfSupply(input: LowStockInput): number | null {
  const qty = normaliseQty(input.qty);
  if (qty == null) return null;
  const perDay = normalisePerDay(input.dosesPerDay);
  if (perDay <= 0) return null;
  return Math.floor(qty / perDay);
}

/**
 * Decrement a qty by one "taken" dose. Returns the new qty, floored at 0.
 * No-op (returns the input unchanged) when qty is unknown — auto count-down
 * only applies once the user has entered a count.
 */
export function decrementQty(qty: number | null | undefined): number | null {
  const n = normaliseQty(qty);
  if (n == null) return null;
  return Math.max(0, n - 1);
}

/** Coerce a stored qty into a safe non-negative integer, or null when absent. */
function normaliseQty(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < 0) return 0;
  return Math.floor(raw);
}

/** Coerce doses-per-day into a safe non-negative integer (0 = no schedule). */
function normalisePerDay(raw: number | null | undefined): number {
  if (raw == null || typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.floor(raw);
}
