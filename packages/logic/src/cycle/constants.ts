/**
 * @ollie/logic · cycle constants
 *
 * All cycle-related thresholds and priors live here so they can be
 * surfaced in research docs and tweaked without hunting through code.
 */

import type { Prior } from './types';

/** Population prior — Urteaga 2021 / Bull 2019 on Natural Cycles data. */
export const DEFAULT_PRIOR: Prior = { mean: 28.5, sd: 4.0 };

// DAY_MS is re-exported from the shared util module — single definition.
export { DAY_MS } from '../util';

/**
 * Medical-impossibility floor: two "period started" events less than this
 * many days apart cannot both be real cycle starts. Drops the later one.
 */
export const MIN_CYCLE_DAYS = 10;

/** EWMA decay for sufficient stats — most recent cycle weighted 1.0. */
export const EWMA_ALPHA = 0.85;

/** Minimum within-user sigma even when sample sd is tiny — prevents collapse. */
export const MIN_SIGMA_USER = 2.0;

/**
 * Measurement-noise floor for the change-point pooled sd (days). When both
 * comparison windows have zero variance the pooled sd is 0 and `delta > 2*sd`
 * would fire on any nonzero shift; this floor requires a meaningful jump.
 */
export const MIN_SIGMA_CHANGEPOINT = 1.0;

/** Standard luteal phase length, in days. */
export const LUTEAL_DAYS = 14;

/** Health-flag cooldown — suppress flags for cycles edited in the last 72h. */
export const HEALTH_FLAG_COOLDOWN_MS = 72 * 3600 * 1000;

/** Robust-stats kicks in when empirical sd exceeds this many days. */
export const ROBUST_SD_THRESHOLD = 7;

/** MAD scaling factor to estimate sd from MAD under Normal assumption. */
export const MAD_TO_SD = 1.4826;
