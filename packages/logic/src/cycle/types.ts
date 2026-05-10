/**
 * @ollie/logic · cycle types
 */

export type CycleAction = 'started' | 'ended' | 'symptom' | 'log';

export interface CycleItem {
  ts: number;
  action: CycleAction;
  text?: string;
}

export interface CycleRecord {
  cycleStartTs: number;
  cycleEndTs?: number;
  cycleLengthDays?: number;
  periodLengthDays?: number;
}

export interface SymptomEvent {
  ts: number;
  text?: string;
}

export interface Prior {
  mean: number;
  sd: number;
}

export interface Posterior {
  mean: number;
  sd: number;
  ci95: [number, number];
  n_effective: number;
  cold_start: boolean;
}

export interface ChangePointResult {
  detected: boolean;
  cutoff: number;
  delta?: number;
  pooledSd?: number;
}

export interface RobustStatsResult {
  useRobust: boolean;
  center: number | null;
  spread: number;
}

export interface FertileWindowDays {
  startDay: number;
  endDay: number;
  center: number;
  widenedBy: number;
}

export type ConfidenceLevel = 'cold' | 'warm' | 'hot';
export type AlgorithmTier =
  | 'cold'
  | 'variable'
  | 'shifting'
  | 'personalized'
  | 'warming';

export interface Prediction {
  next_period: {
    mean: number;
    sd: number;
    ci95: [number, number];
    confidence: AlgorithmTier;
  };
  fertile_window: FertileWindowDays | null;
  flags: {
    cold_start: boolean;
    change_point: boolean;
    irregular: boolean;
    nowcasting_active: boolean;
  };
  layers_used: {
    posterior: boolean;
    change_point: boolean;
    robust: boolean;
    covariate: boolean;
    nowcast: boolean;
  };
  expectedStart: Date | null;
  confidenceRange: [Date, Date] | null;
  confidenceLevel: ConfidenceLevel;
  mean: number;
  sd: number;
  cyclesUsed: number;
  explanation: string;
  tier: ConfidenceLevel;
  avgCycle: number;
  stdev: number;
  confidence: number;
  confidenceRangeDays: number;
  nextTs: number | null;
}

export interface OvulationPrediction {
  ovulationTs: number | null;
  confidence: number;
  explanation: string;
}

export interface AdherenceIssue {
  hasIssue: boolean;
  cycle?: CycleRecord;
  observedLength?: number;
  typicalLength?: number;
  suggestedSplit?: number;
}

export interface CycleStats {
  cycles_logged_count: number;
  mean_length: number | null;
  sd_length: number;
  mean_bleed: number | null;
  irregular_flag: boolean;
  last_period_start: number | null;
}

export type Phase =
  | 'menstrual'
  | 'follicular'
  | 'ovulation window'
  | 'luteal'
  | 'unknown';

export interface SymptomCorrelation {
  hasPattern: boolean;
  phase?: Phase;
  occurrences?: number;
  cycles?: number;
  reason?: string;
}

export type HealthFlagSeverity = 'low' | 'medium';

export interface HealthFlag {
  id: 'long-cycles' | 'short-cycles' | 'long-bleed' | 'amenorrhea' | 'dysmenorrhea';
  severity: HealthFlagSeverity;
  observation: string;
  reference: string;
  suggestion: string;
  sources: string[];
}
