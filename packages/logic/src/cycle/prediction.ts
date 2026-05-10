/**
 * @ollie/logic · cycle prediction
 *
 * predictNextPeriod composes the three stat layers (posterior, change-point,
 * robust) into a single prediction with a confidence range, an explanation,
 * and a fertile-window suggestion. CYCLE_ALGORITHM.md §8 documents the
 * output shape.
 *
 * predictOvulation, fertileWindow, detectAdherenceIssue all build on
 * predictNextPeriod (or its inputs) so a UI never has to combine layers
 * itself.
 */

import type {
  AdherenceIssue,
  CycleRecord,
  FertileWindowDays,
  OvulationPrediction,
  Posterior,
  Prediction,
  Prior,
} from './types';
import { DAY_MS, DEFAULT_PRIOR, EWMA_ALPHA, LUTEAL_DAYS } from './constants';
import { detectChangePoint, posteriorCycleLength, robustStats } from './posterior';

type StartsLike = ReadonlyArray<CycleRecord | { ts: number }>;

function extractStarts(input: StartsLike | undefined | null): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c) => {
      if (!c) return null;
      if (typeof (c as CycleRecord).cycleStartTs === 'number') return (c as CycleRecord).cycleStartTs;
      if (typeof (c as { ts: number }).ts === 'number') return (c as { ts: number }).ts;
      return null;
    })
    .filter((ts): ts is number => ts !== null)
    .sort((a, b) => a - b);
}

export function predictNextPeriod(
  input: StartsLike | undefined | null,
  populationPrior: Prior = DEFAULT_PRIOR,
): Prediction {
  const prior = populationPrior;
  const starts = extractStarts(input);

  const cycleLengths: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    cycleLengths.push((starts[i] - starts[i - 1]) / DAY_MS);
  }

  // Layer 2: change-point
  const cp = detectChangePoint(cycleLengths);
  const effective = cp.detected ? cycleLengths.slice(cp.cutoff) : cycleLengths;

  // Layer 3: robust
  const robust = robustStats(effective);

  // Layer 1: posterior. For robust mode, feed median+MAD as sufficient stats.
  let layer1: Posterior;
  if (robust.useRobust && robust.center !== null) {
    const n = effective.length;
    const weights = effective.map((_, i) => Math.pow(EWMA_ALPHA, n - 1 - i));
    const effN = weights.reduce((a, b) => a + b, 0);
    const sigmaUser = robust.spread;
    const priorPrec = 1 / (prior.sd * prior.sd);
    const dataPrec = effN / (sigmaUser * sigmaUser);
    const postPrec = priorPrec + dataPrec;
    const postVar = 1 / postPrec;
    const postMean = (prior.mean * priorPrec + robust.center * dataPrec) / postPrec;
    const predictiveSd = Math.sqrt(postVar + sigmaUser * sigmaUser);
    layer1 = {
      mean: postMean,
      sd: predictiveSd,
      ci95: [postMean - 1.96 * predictiveSd, postMean + 1.96 * predictiveSd],
      n_effective: effN,
      cold_start: false,
    };
  } else {
    layer1 = posteriorCycleLength(effective, prior);
  }

  // Algorithm-shape tier
  const tierAlg =
    layer1.n_effective < 1
      ? 'cold'
      : robust.useRobust
        ? 'variable'
        : cp.detected && layer1.n_effective < 4
          ? 'shifting'
          : layer1.n_effective >= 6
            ? 'personalized'
            : 'warming';

  // UI-shape mapping
  const confidenceLevel: 'cold' | 'warm' | 'hot' =
    tierAlg === 'cold' ? 'cold' : tierAlg === 'personalized' ? 'hot' : 'warm';

  // Layer 4: fertile window
  let fertile: FertileWindowDays | null = null;
  if (!layer1.cold_start && layer1.sd <= 5 && cycleLengths.length >= 2) {
    const widen = Math.max(0, Math.round(layer1.sd - 2));
    const ovulationDay = Math.round(layer1.mean) - LUTEAL_DAYS;
    fertile = {
      startDay: ovulationDay - 5 - widen,
      endDay: ovulationDay + 1 + widen,
      center: ovulationDay,
      widenedBy: widen,
    };
  }

  const lastStart = starts.length ? starts[starts.length - 1] : null;
  const expectedStart = lastStart !== null ? new Date(lastStart + layer1.mean * DAY_MS) : null;
  const confidenceRange: [Date, Date] | null = expectedStart
    ? [
        new Date(expectedStart.getTime() - 1.96 * layer1.sd * DAY_MS),
        new Date(expectedStart.getTime() + 1.96 * layer1.sd * DAY_MS),
      ]
    : null;

  const explanation = layer1.cold_start
    ? `based on a typical ${prior.mean}-day cycle (population prior). will tighten as you log.`
    : robust.useRobust
      ? `your cycles are variable. using median + MAD for an honest range.`
      : cp.detected
        ? `your cycle pattern shifted recently. predictions based on last 6 cycles.`
        : cycleLengths.length < 3
          ? `based on ${cycleLengths.length} logged cycle${cycleLengths.length === 1 ? '' : 's'} blended with a population prior. will tighten at 3+ cycles.`
          : `bayesian posterior over ${cycleLengths.length} logged cycles. predictive sd ${layer1.sd.toFixed(1)}d.`;

  return {
    next_period: { mean: layer1.mean, sd: layer1.sd, ci95: layer1.ci95, confidence: tierAlg },
    fertile_window: fertile,
    flags: {
      cold_start: layer1.cold_start,
      change_point: cp.detected,
      irregular: robust.useRobust,
      nowcasting_active: false,
    },
    layers_used: {
      posterior: true,
      change_point: cp.detected,
      robust: robust.useRobust,
      covariate: false,
      nowcast: false,
    },
    expectedStart,
    confidenceRange,
    confidenceLevel,
    mean: layer1.mean,
    sd: layer1.sd,
    cyclesUsed: cycleLengths.length,
    explanation,
    tier: confidenceLevel,
    avgCycle: Math.round(layer1.mean),
    stdev: layer1.sd,
    confidence: confidenceLevel === 'hot' ? 0.85 : confidenceLevel === 'warm' ? 0.6 : 0.3,
    confidenceRangeDays: Math.max(2, Math.round(2 * 1.96 * layer1.sd)),
    nextTs: expectedStart ? expectedStart.getTime() : null,
  };
}

/**
 * Ovulation estimate — wrapper around the fertile window center.
 * Never exposed as a single day in the UI (principle 2.8).
 */
export function predictOvulation(
  cycles: StartsLike | undefined | null,
  populationPrior: Prior = DEFAULT_PRIOR,
): OvulationPrediction {
  const pred = predictNextPeriod(cycles, populationPrior);
  if (!pred.nextTs) {
    return {
      ovulationTs: null,
      confidence: 0,
      explanation: 'need at least one full cycle to estimate.',
    };
  }
  return {
    ovulationTs: pred.nextTs - LUTEAL_DAYS * DAY_MS,
    confidence: Math.max(0, pred.confidence - 0.1),
    explanation: 'ovulation tends to land ~14 days before the next period.',
  };
}

/**
 * Fertile window as a [Date, Date] tuple for UI consumption.
 * Returns null for <2 cycles or when predictive sd > 5 (rule 2.8).
 */
export function fertileWindow(
  cycles: StartsLike | undefined | null,
  populationPrior: Prior = DEFAULT_PRIOR,
): [Date, Date] | null {
  const pred = predictNextPeriod(cycles, populationPrior);
  if (!pred.fertile_window || !pred.nextTs) return null;
  const starts = extractStarts(cycles);
  if (starts.length === 0) return null;
  const lastStart = starts[starts.length - 1];
  const start = new Date(lastStart + pred.fertile_window.startDay * DAY_MS);
  const end = new Date(lastStart + pred.fertile_window.endDay * DAY_MS);
  return [start, end];
}

/**
 * Adherence check: flag an anomalously long cycle — likely missed log.
 * Robust stats keep the threshold honest in the face of one wild outlier
 * (teens, perimenopause). Principle 2.7.
 */
export function detectAdherenceIssue(cycles: readonly CycleRecord[] | undefined | null): AdherenceIssue {
  if (!Array.isArray(cycles) || cycles.length < 2) return { hasIssue: false };
  const closed = cycles.filter((c): c is CycleRecord => !!c && typeof c.cycleLengthDays === 'number');
  if (closed.length < 2) return { hasIssue: false };
  const lastClosed = closed[closed.length - 1];
  const prior = closed.slice(0, -1);
  if (prior.length === 0) return { hasIssue: false };
  const priorLengths = prior.map((c) => c.cycleLengthDays as number);
  const robust = robustStats(priorLengths);
  const center = robust.center ?? 28;
  const spread = Math.max(robust.spread ?? 0, 2);
  const threshold = center + 3 * spread;
  if ((lastClosed.cycleLengthDays as number) > threshold) {
    const splitTs = lastClosed.cycleStartTs + Math.round(center) * DAY_MS;
    return {
      hasIssue: true,
      cycle: lastClosed,
      observedLength: lastClosed.cycleLengthDays,
      typicalLength: Math.round(center),
      suggestedSplit: splitTs,
    };
  }
  return { hasIssue: false };
}
