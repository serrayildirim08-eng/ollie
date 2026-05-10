/**
 * @ollie/logic · predict posterior + robust stats + change-point detection
 *
 * Pure functions. No I/O, no clock reads.
 */

import type {
  ChangePointResult,
  ForecastOpts,
  Prior,
  PosteriorResult,
  RobustStatsResult,
  TierLabel,
} from './types';
import { ALPHA_DEFAULT, PRIORS } from './constants';
import { mean, sampleSd, variance, median, sum } from './math';

/** Synthesize a prior from observed values when no domain prior exists. */
export function inferPrior(observations: number[]): Prior {
  const obs = (observations ?? []).filter(x => typeof x === 'number' && isFinite(x));
  if (obs.length === 0) return { mean: 0, sd: 1 };
  if (obs.length === 1) {
    return { mean: obs[0]!, sd: Math.max(Math.abs(obs[0]!) * 0.2, 0.5) };
  }
  const m = mean(obs);
  const s = Math.max(sampleSd(obs), Math.abs(m) * 0.1, 0.5);
  return { mean: m, sd: s };
}

interface ResolvedOpts {
  prior: Prior;
  minSigma: number;
  robustThreshold: number;
  alpha: number;
}

/** Resolve ForecastOpts + observations into concrete prior / thresholds. */
export function resolveOpts(observations: number[], opts: ForecastOpts): ResolvedOpts {
  const o = opts ?? {};
  let prior: Prior;

  if (o.prior && o.prior.mean != null && o.prior.sd != null) {
    prior = { mean: o.prior.mean, sd: o.prior.sd };
  } else if (o.preset && PRIORS[o.preset]) {
    const p = PRIORS[o.preset]!;
    prior = p.mean != null ? { mean: p.mean as number, sd: p.sd as number } : inferPrior(observations);
    // Carry over threshold settings from preset when caller hasn't overridden.
    if (o.minSigma == null && p.minSigma != null) o.minSigma = p.minSigma;
    if (o.minSigmaFrac == null && p.minSigmaFrac != null) o.minSigmaFrac = p.minSigmaFrac;
    if (o.robustThreshold == null && p.robustThreshold != null) o.robustThreshold = p.robustThreshold;
    if (o.robustThresholdFrac == null && p.robustThresholdFrac != null) o.robustThresholdFrac = p.robustThresholdFrac;
  } else {
    prior = inferPrior(observations);
  }

  const refMean =
    Math.abs(prior.mean) ||
    (observations.length ? Math.abs(mean(observations)) : 1);

  const minSigma =
    o.minSigma != null
      ? o.minSigma
      : o.minSigmaFrac != null
      ? refMean * o.minSigmaFrac
      : 0;

  const robustThreshold =
    o.robustThreshold != null
      ? o.robustThreshold
      : o.robustThresholdFrac != null
      ? refMean * o.robustThresholdFrac
      : Math.max(refMean * 0.25, prior.sd * 2);

  const alpha = typeof o.alpha === 'number' ? o.alpha : ALPHA_DEFAULT;

  return { prior, minSigma, robustThreshold, alpha };
}

/** Change-point: last 6 vs prior 6 using pooled-sd rule. */
export function detectChangePoint(
  values: number[],
  _opts?: ForecastOpts,
): ChangePointResult {
  const arr = values ?? [];
  if (arr.length < 9) return { detected: false, cutoff: 0, delta: 0, pooledSd: 0 };
  const recent = arr.slice(-6);
  const older = arr.slice(-12, -6);
  const delta = Math.abs(mean(recent) - mean(older));
  const pooledSd = Math.sqrt((variance(recent) + variance(older)) / 2);
  const detected = delta > 2 * pooledSd && pooledSd > 0;
  return { detected, cutoff: detected ? arr.length - 6 : 0, delta, pooledSd };
}

/** Robust mode: median + MAD when empirical sd > threshold. */
export function robustStats(values: number[], opts?: ForecastOpts): RobustStatsResult {
  const arr = values ?? [];
  const resolved = resolveOpts(arr, opts ?? {});
  if (arr.length < 4) {
    return {
      useRobust: false,
      center: arr.length ? mean(arr) : null,
      spread: arr.length ? sampleSd(arr) : 0,
    };
  }
  const sd = sampleSd(arr);
  if (sd <= resolved.robustThreshold) return { useRobust: false, center: mean(arr), spread: sd };
  const med = median(arr);
  const mad = 1.4826 * median(arr.map(v => Math.abs(v - med)));
  return { useRobust: true, center: med, spread: Math.max(mad, resolved.minSigma) };
}

/**
 * Normal-Normal conjugate posterior with position-based EWMA weights.
 * Returns predictiveSd = sqrt(postVariance + sigmaUser²) so CI95 covers
 * the next observation, not the posterior mean.
 */
export function posterior(values: number[], opts?: ForecastOpts): PosteriorResult {
  const arr = values ?? [];
  const { prior, minSigma, alpha } = resolveOpts(arr, opts ?? {});
  const n = arr.length;

  if (n === 0) {
    return {
      mean: prior.mean,
      sd: prior.sd,
      ci95: [prior.mean - 1.96 * prior.sd, prior.mean + 1.96 * prior.sd],
      n_effective: 0,
      cold_start: true,
    };
  }

  const sigmaUser = n >= 3 ? Math.max(sampleSd(arr), minSigma) : Math.max(prior.sd, minSigma);
  const weights = arr.map((_, i) => Math.pow(alpha, n - 1 - i));
  const effN = sum(weights);
  const weightedSum = arr.reduce((acc, v, i) => acc + weights[i]! * v, 0);

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

export function tierLabel(
  nEff: number,
  nRaw: number,
  flags: { robust: boolean; change_point: boolean },
): TierLabel {
  if (nEff < 1) return 'cold';
  if (flags.robust) return 'variable';
  if (flags.change_point && nRaw < 4) return 'shifting';
  if (nRaw >= 6 || nEff >= 4.5) return 'personalized';
  return 'warming';
}
