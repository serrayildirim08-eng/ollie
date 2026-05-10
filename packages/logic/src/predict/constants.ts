/**
 * @ollie/logic · predict constants
 */

import type { PresetKey, PriorPreset } from './types';

export const DAY_MS = 86_400_000;

export const ALPHA_DEFAULT = 0.85;
export const ALPHA_AFTER_SHIFT = 0.70;

export const PRIORS: Record<PresetKey, PriorPreset> = {
  cycleLength:   { mean: 28.5, sd: 4.0,  minSigma: 2.0,  robustThreshold: 7.0,  domain: 'days' },
  sleepHours:    { mean: 7.5,  sd: 1.0,  minSigma: 0.3,  robustThreshold: 1.5,  domain: 'hours' },
  billAmount:    { mean: null, sd: null,  minSigmaFrac: 0.05,  robustThresholdFrac: 0.25, domain: 'amount' },
  habitInterval: { mean: null, sd: null,  minSigmaFrac: 0.20,  robustThresholdFrac: 0.35, domain: 'days' },
  intervalDays:  { mean: null, sd: null,  minSigmaFrac: 0.15,  robustThresholdFrac: 0.30, domain: 'days' },
};

export const TIER_COPY: Record<string, string> = {
  cold:        'first guess — based on a typical range. will tighten as you log.',
  warming:     'learning your pattern. confidence improves with more data.',
  personalized:'based on your own recent data.',
  variable:    'your data is variable. this is a rough range, by design.',
  shifting:    'your pattern shifted recently. using recent data only.',
};
