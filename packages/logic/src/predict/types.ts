/**
 * @ollie/logic · predict types
 */

export interface TimestampedObservation {
  value: number;
  ts: number;
}

export type Observation = number | TimestampedObservation;

export interface Series {
  values: number[];
  ts: number[];
  hasTs: boolean;
}

export interface Prior {
  mean: number;
  sd: number;
}

export interface PriorPreset {
  mean: number | null;
  sd: number | null;
  minSigma?: number;
  minSigmaFrac?: number;
  robustThreshold?: number;
  robustThresholdFrac?: number;
  domain: string;
}

export interface ForecastOpts {
  now?: number;
  preset?: PresetKey;
  prior?: { mean: number; sd: number };
  alpha?: number;
  halfLifeDays?: number;
  minSigma?: number;
  minSigmaFrac?: number;
  robustThreshold?: number;
  robustThresholdFrac?: number;
}

export type PresetKey =
  | 'cycleLength'
  | 'sleepHours'
  | 'billAmount'
  | 'habitInterval'
  | 'intervalDays';

export type TierLabel =
  | 'cold'
  | 'warming'
  | 'personalized'
  | 'variable'
  | 'shifting';

export type ForecastMethod =
  | 'prior'
  | 'posterior'
  | 'posterior_robust'
  | 'posterior_after_shift'
  | 'posterior_calendar';

export interface ForecastFlags {
  cold_start: boolean;
  change_point: boolean;
  robust: boolean;
  stale: boolean;
}

export interface RecencyMeta {
  daysSinceLast: number;
  spanDays: number;
  lastTs: number;
  firstTs: number;
  now: number;
  staleThresholdDays: number;
}

export interface ChangePointResult {
  detected: boolean;
  cutoff: number;
  delta: number;
  pooledSd: number;
}

export interface RobustStatsResult {
  useRobust: boolean;
  center: number | null;
  spread: number;
}

export interface PosteriorResult {
  mean: number;
  sd: number;
  ci95: [number, number];
  n_effective: number;
  cold_start: boolean;
}

export interface ForecastResult {
  mean: number;
  sd: number;
  ci95: [number, number];
  n_effective: number;
  n_observed: number;
  n_used: number;
  tier: TierLabel;
  method: ForecastMethod;
  flags: ForecastFlags;
  change_point: ChangePointResult;
  recency: RecencyMeta | null;
  dont_know_yet: boolean;
  explanation: string;
}

export interface JoinedPair {
  anchor: number;
  anchorTs: number;
  aggregate: number | null;
  n: number;
}

export interface CorrelationPair {
  x: number;
  y: number;
  ts: number;
}

export interface CorrelateResult {
  effect: number | null;
  r: number | null;
  pValue: number | null;
  n: number;
  se?: number | null;
  hasPattern: boolean;
  direction?: 'positive' | 'negative';
  reason: string | null;
  pairs?: CorrelationPair[];
}

export interface StabilityResult {
  stable: boolean | null;
  r_old?: number;
  r_new?: number;
  n_old?: number;
  n_new?: number;
  delta?: number;
  signs_agree?: boolean;
  reason: string | null;
}

export interface MmrCandidate {
  id: string;
  effect: number;
  modules?: string[];
}

export interface MmrOpts {
  topK?: number;
  lambda?: number;
  sim?: (a: MmrCandidate, b: MmrCandidate) => number;
}

export interface BhInput {
  id: string;
  p: number;
}

export interface NextEventForecast {
  nextTs: number | null;
  lastTs?: number;
  daysOut: number | null;
  daysSinceLast?: number;
  intervalDays?: number;
  sdDays?: number;
  ci95Ts?: [number, number];
  tier: TierLabel;
  method?: ForecastMethod;
  flags?: ForecastFlags;
  recency?: RecencyMeta | null;
  explanation: string;
  dont_know_yet: boolean;
  n_observed: number;
}
