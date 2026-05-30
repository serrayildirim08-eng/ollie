/**
 * Grocery · predicted-out timestamp computation.
 *
 * Pure, synchronous helper that turns a pantry row's last-purchase ts +
 * the two cadence signals into a `predictedOutAtMs`. Called whenever:
 *   - the pantry list loads (pantry.list / listActive)
 *   - a new purchase is logged (pantry.add succeeds)
 *   - a fresh cadence estimate lands from the worker
 *
 * Priority (locked 2026-05-30):
 *   1. observed cadence (sampleSize >= 2 from `/replenishment/:user`)
 *   2. static shelf life (from `/shelf-life/all` cache, or the worker's
 *      low-data fallback)
 *   3. null — we don't have enough signal yet; UI shows no prediction.
 *
 * Returned ts is `lastPurchaseMs + chosenDays * DAY_MS`. The push trigger
 * (pushTrigger.ts) gates fire to `[predictedOut - 1d, predictedOut - 6h]`
 * so a prediction in the past still fires once when the scanner catches up.
 *
 * `staleAtMs` is an optional cap: if the chosen cadence would push the
 * prediction beyond `staleAtMs` days, return null instead. Useful when the
 * shelf life is "indefinite-capped-at-365" (honey, salt) — we don't want
 * a prediction 365 days from purchase muddying the Shop "≈ likely needed"
 * list. Default cap = 180 days; pass Infinity to disable.
 *
 * The function NEVER reads the DOM, network, or storage — pass everything
 * in. Tests inject all inputs deterministically.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_CAP_DAYS = 180;

export interface PredictOutInput {
  /** Last purchase timestamp in ms-since-epoch. */
  lastPurchaseMs: number;
  /**
   * Observed median interval from `/replenishment/:user` when sampleSize >= 2.
   * Pass null when the user has only one (or zero) recorded purchase for
   * this canonical — `shelfLifeDays` is the fallback.
   */
  cadenceDays: number | null;
  /**
   * Static shelf-life days from the `/shelf-life/all` cache (or the
   * grocery_pantry_estimates RPC low-data fallback). Pass null when this
   * canonical isn't in the dataset — combined with a null cadence the
   * prediction is null too.
   */
  shelfLifeDays: number | null;
  /**
   * Days cap: predictions beyond this far in the future return null. Use
   * to suppress "you'll need salt in 365 days" noise. Defaults to 180.
   */
  staleAtDays?: number;
}

/**
 * Returns the predicted-out timestamp in ms-since-epoch, or null when we
 * don't have enough signal (no cadence AND no shelf life), or when the
 * prediction would exceed `staleAtDays` from `lastPurchaseMs`.
 *
 * Never throws. Negative / non-finite inputs return null.
 */
export function predictOutAt(opts: PredictOutInput): number | null {
  const { lastPurchaseMs, cadenceDays, shelfLifeDays } = opts;
  const staleAtDays = typeof opts.staleAtDays === 'number'
    ? opts.staleAtDays
    : DEFAULT_STALE_CAP_DAYS;

  // Sanity: ts must be a finite ms-since-epoch.
  if (!Number.isFinite(lastPurchaseMs) || lastPurchaseMs <= 0) {
    return null;
  }

  // Pick the cadence: observed wins over shelf life. Both must be > 0 to
  // count as a usable signal — a 0-day prediction is meaningless.
  let chosenDays: number | null = null;
  if (typeof cadenceDays === 'number' && Number.isFinite(cadenceDays) && cadenceDays > 0) {
    chosenDays = cadenceDays;
  } else if (typeof shelfLifeDays === 'number' && Number.isFinite(shelfLifeDays) && shelfLifeDays > 0) {
    chosenDays = shelfLifeDays;
  }

  if (chosenDays === null) return null;

  // Stale cap — past this, the prediction is too far out to be useful.
  // `Infinity` disables the cap intentionally.
  if (Number.isFinite(staleAtDays) && chosenDays > staleAtDays) {
    return null;
  }

  // Math: round to nearest ms is fine — the day granularity dominates.
  return Math.round(lastPurchaseMs + chosenDays * DAY_MS);
}

/** Test-only: re-export the day constant so test cases stay readable. */
export const PREDICT_DAY_MS = DAY_MS;
