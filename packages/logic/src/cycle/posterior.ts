/**
 * @ollie/logic · stats layers
 *
 * Layer 1 — Normal-Normal Bayesian posterior with EWMA-weighted sufficient
 *           stats. Predictive sd = √(postVar + σ_user²).
 * Layer 2 — Change-point detection: split last-6 vs prior-6, pooled-sd rule.
 * Layer 3 — Robust mode via median + MAD when empirical sd > 7.
 *
 * All three are pure functions. They take cycle lengths in days and return
 * structured results — no calls into store, events, or DOM.
 */

import type { Prior, Posterior, ChangePointResult, RobustStatsResult } from './types';
import { DEFAULT_PRIOR, EWMA_ALPHA, MIN_SIGMA_USER, ROBUST_SD_THRESHOLD, MAD_TO_SD } from './constants';
import { mean, sampleSd, median } from './math';

export function posteriorCycleLength(
  cycleLengths: readonly number[],
  prior: Prior = DEFAULT_PRIOR,
): Posterior {
  const n = cycleLengths.length;
  if (n === 0) {
    return {
      mean: prior.mean,
      sd: prior.sd,
      ci95: [prior.mean - 1.96 * prior.sd, prior.mean + 1.96 * prior.sd],
      n_effective: 0,
      cold_start: true,
    };
  }

  const sigmaUser = n >= 3 ? Math.max(sampleSd([...cycleLengths]), MIN_SIGMA_USER) : prior.sd;
  const weights = cycleLengths.map((_, i) => Math.pow(EWMA_ALPHA, n - 1 - i));
  const effN = weights.reduce((a, b) => a + b, 0);
  const weightedSum = cycleLengths.reduce((acc, L, i) => acc + weights[i] * L, 0);

  const priorPrec = 1 / (prior.sd * prior.sd);
  const dataPrec = effN / (sigmaUser * sigmaUser);
  const postPrec = priorPrec + dataPrec;
  const postVar = 1 / postPrec;
  const postMean = (prior.mean * priorPrec + weightedSum / (sigmaUser * sigmaUser)) / postPrec;
  const predictiveSd = Math.sqrt(postVar + sigmaUser * sigmaUser);

  return {
    mean: postMean,
    sd: predictiveSd,
    ci95: [postMean - 1.96 * predictiveSd, postMean + 1.96 * predictiveSd],
    n_effective: effN,
    cold_start: false,
  };
}

export function detectChangePoint(cycleLengths: readonly number[]): ChangePointResult {
  if (cycleLengths.length < 9) return { detected: false, cutoff: 0 };
  const recent = cycleLengths.slice(-6);
  const older = cycleLengths.slice(-12, -6);
  const delta = Math.abs(mean([...recent]) - mean([...older]));
  const variance = (arr: readonly number[]): number => {
    const m = mean([...arr]);
    return arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / arr.length;
  };
  const pooledSd = Math.sqrt((variance(recent) + variance(older)) / 2);
  const detected = delta > 2 * pooledSd;
  return { detected, cutoff: detected ? cycleLengths.length - 6 : 0, delta, pooledSd };
}

export function robustStats(cycleLengths: readonly number[]): RobustStatsResult {
  if (cycleLengths.length < 4) {
    return {
      useRobust: false,
      center: cycleLengths.length ? mean([...cycleLengths]) : null,
      spread: cycleLengths.length ? sampleSd([...cycleLengths]) : 0,
    };
  }
  const sd = sampleSd([...cycleLengths]);
  if (sd <= ROBUST_SD_THRESHOLD) {
    return { useRobust: false, center: mean([...cycleLengths]), spread: sd };
  }
  const med = median([...cycleLengths]);
  const mad = MAD_TO_SD * median(cycleLengths.map((L) => Math.abs(L - med)));
  return { useRobust: true, center: med, spread: Math.max(mad, 2.0) };
}
