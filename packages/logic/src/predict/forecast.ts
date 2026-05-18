/**
 * @ollie/logic · predict forecast
 *
 * Master forecast function. Chains change-point → robust-stats → posterior.
 * All pure — no Date.now(), no window globals; `now` is always explicit.
 */

import type {
  ForecastFlags,
  ForecastMethod,
  ForecastOpts,
  ForecastResult,
  NextEventForecast,
  Observation,
  PosteriorResult,
  TierLabel,
} from './types';
import { ALPHA_AFTER_SHIFT, DAY_MS, TIER_COPY } from './constants';
import { recencyWeights, sampleSd, sum, toSeries } from './math';
import {
  detectChangePoint,
  posterior,
  resolveOpts,
  robustStats,
  tierLabel,
} from './posterior';

export function forecast(
  observations: Observation[],
  opts?: ForecastOpts & { now?: number; halfLifeDays?: number },
): ForecastResult {
  const series = toSeries(observations);
  const obs = series.values;
  const o = Object.assign({}, opts ?? {});
  const now = typeof o.now === 'number' ? o.now : 0; // callers must always pass now
  const halfLifeDays = typeof o.halfLifeDays === 'number' ? o.halfLifeDays : 60;

  const cp = detectChangePoint(obs, o);
  const effective = cp.detected ? obs.slice(cp.cutoff) : obs;
  const effectiveTs = cp.detected && series.hasTs ? series.ts.slice(cp.cutoff) : series.ts;

  if (cp.detected && o.alpha == null) o.alpha = ALPHA_AFTER_SHIFT;

  const robust = robustStats(effective, o);

  let post: PosteriorResult;

  if (effective.length === 0) {
    const { prior } = resolveOpts(effective, o);
    post = {
      mean: prior.mean,
      sd: prior.sd,
      ci95: [prior.mean - 1.96 * prior.sd, prior.mean + 1.96 * prior.sd],
      n_effective: 0,
      cold_start: true,
    };
  } else if (robust.useRobust) {
    const resolved = resolveOpts(effective, o);
    const pr = resolved.prior;
    const alpha = resolved.alpha;
    const n = effective.length;
    const weights = series.hasTs
      ? recencyWeights(effectiveTs, now, halfLifeDays)
      : effective.map((_, i) => Math.pow(alpha, n - 1 - i));
    const effN = sum(weights);
    const sigmaUser = robust.spread;
    const priorPrec = 1 / (pr.sd * pr.sd);
    const dataPrec = effN / (sigmaUser * sigmaUser);
    const postPrec = priorPrec + dataPrec;
    const postVar = 1 / postPrec;
    const postMean = (pr.mean * priorPrec + (robust.center! * dataPrec)) / postPrec;
    const predictiveSd = Math.sqrt(postVar + sigmaUser * sigmaUser);
    post = {
      mean: postMean,
      sd: predictiveSd,
      ci95: [postMean - 1.96 * predictiveSd, postMean + 1.96 * predictiveSd],
      n_effective: effN,
      cold_start: false,
    };
  } else if (series.hasTs) {
    // Calendar-weighted posterior branch.
    const resolved = resolveOpts(effective, o);
    const pr = resolved.prior;
    const n = effective.length;
    const weights = recencyWeights(effectiveTs, now, halfLifeDays);
    const effN = sum(weights);
    const sigmaUser =
      n >= 3 ? Math.max(sampleSd(effective), resolved.minSigma) : Math.max(pr.sd, resolved.minSigma);
    const weightedSum = effective.reduce((acc, v, i) => acc + weights[i]! * v, 0);
    const priorPrec = 1 / (pr.sd * pr.sd);
    const dataPrec = effN / (sigmaUser * sigmaUser);
    const postPrec = priorPrec + dataPrec;
    const postVar = 1 / postPrec;
    const postMean = (pr.mean * priorPrec + weightedSum / (sigmaUser * sigmaUser)) / postPrec;
    const predictiveSd = Math.sqrt(postVar + sigmaUser * sigmaUser);
    post = {
      mean: postMean,
      sd: predictiveSd,
      ci95: [postMean - 1.96 * predictiveSd, postMean + 1.96 * predictiveSd],
      n_effective: effN,
      cold_start: false,
    };
  } else {
    post = posterior(effective, o);
  }

  const flags: ForecastFlags = {
    cold_start: post.cold_start,
    change_point: cp.detected,
    robust: robust.useRobust,
    stale: false,
  };

  let recency = null;
  if (series.hasTs && series.ts.length > 0) {
    const lastTs = series.ts[series.ts.length - 1]!;
    const firstTs = series.ts[0]!;
    const daysSinceLast = (now - lastTs) / DAY_MS;
    const spanDays = (lastTs - firstTs) / DAY_MS;
    recency = { daysSinceLast, spanDays, lastTs, firstTs, now, staleThresholdDays: halfLifeDays };
    if (daysSinceLast > halfLifeDays) flags.stale = true;
  }

  const tier: TierLabel = tierLabel(post.n_effective, effective.length, flags);

  const method: ForecastMethod = post.cold_start
    ? 'prior'
    : robust.useRobust
    ? 'posterior_robust'
    : cp.detected
    ? 'posterior_after_shift'
    : series.hasTs
    ? 'posterior_calendar'
    : 'posterior';

  const dontKnowYet = obs.length === 0 || (obs.length === 1 && !series.hasTs);

  const explanation = dontKnowYet
    ? 'not enough logged yet to say much. keep going.'
    : flags.stale
    ? `last logged ${Math.round(recency!.daysSinceLast)} days ago. confidence has decayed.`
    : TIER_COPY[tier]!;

  return {
    mean: post.mean,
    sd: post.sd,
    ci95: post.ci95,
    n_effective: post.n_effective,
    n_observed: obs.length,
    n_used: effective.length,
    tier,
    method,
    flags,
    change_point: cp,
    recency,
    dont_know_yet: dontKnowYet,
    explanation,
  };
}

/**
 * Forecast the next event from a sorted array of event timestamps (epoch ms)
 * or objects with `.ts`. Intervals fed into the posterior engine; result
 * expressed in calendar terms.
 */
export function forecastNextEvent(
  timestamps: (number | { ts: number })[],
  opts?: ForecastOpts & { now?: number },
): NextEventForecast {
  const raw = (timestamps ?? [])
    .map(x => (typeof x === 'number' ? x : typeof x.ts === 'number' ? x.ts : null))
    .filter((t): t is number => typeof t === 'number' && isFinite(t))
    .slice()
    .sort((a, b) => a - b);

  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now : 0;

  if (raw.length === 0) {
    return {
      nextTs: null,
      daysOut: null,
      tier: 'cold',
      explanation: 'no events logged yet.',
      n_observed: 0,
      dont_know_yet: true,
    };
  }

  const tsIntervals = [];
  for (let i = 1; i < raw.length; i++) {
    tsIntervals.push({ value: (raw[i]! - raw[i - 1]!) / DAY_MS, ts: raw[i]! });
  }

  const f = forecast(tsIntervals, Object.assign({ preset: 'intervalDays' as const }, o));
  const lastTs = raw[raw.length - 1]!;
  const nextTs = lastTs + f.mean * DAY_MS;
  const daysOut = (nextTs - now) / DAY_MS;

  return {
    nextTs,
    lastTs,
    daysOut,
    daysSinceLast: (now - lastTs) / DAY_MS,
    intervalDays: f.mean,
    sdDays: f.sd,
    ci95Ts: [lastTs + f.ci95[0] * DAY_MS, lastTs + f.ci95[1] * DAY_MS],
    tier: f.tier,
    method: f.method,
    flags: f.flags,
    recency: f.recency,
    explanation: f.explanation,
    dont_know_yet: f.dont_know_yet,
    n_observed: raw.length,
  };
}
