/**
 * @ollie/logic · predict public API
 *
 * Generic Bayesian prediction engine. All functions are pure:
 * no wall-clock reads, no store access, no DOM.
 * `now` is always an explicit millisecond timestamp parameter.
 */

export * from './types';
export { DAY_MS, ALPHA_DEFAULT, ALPHA_AFTER_SHIFT, PRIORS, TIER_COPY } from './constants';
export { sum, mean, variance, sampleSd, median, toSeries, recencyWeights, daysBetween, daysSince, normalCdf, _invNormalCdf } from './math';
export { inferPrior, resolveOpts, detectChangePoint, robustStats, posterior, tierLabel } from './posterior';
export { forecast, forecastNextEvent } from './forecast';
export { joinStreams, correlate, stability, minDetectableEffect, mmrRank, bh } from './correlate';
