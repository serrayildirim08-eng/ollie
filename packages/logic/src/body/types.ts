/**
 * @ollie/logic · body types
 *
 * All interfaces/types for the body sub-namespace.
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Shared ──────────────────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low';

export interface PatternSource {
  citation: string;
  url: string;
}

export interface DateRange {
  start: number | string;
  end: number | string;
}

// ─── Input shapes ────────────────────────────────────────────────────────────

export interface DumpEntry {
  ts: number;
  rawText?: string;
  text?: string;
}

/** Water log entry: either a bare timestamp (number) or an object. */
export type WaterEntry = number | { ts: number; glasses?: number };

export interface SupplementLogEntry {
  ts: number;
  [k: string]: unknown;
}

export interface FocusSession {
  start: number;
  end: number;
  [k: string]: unknown;
}

/** Sleep record keyed by night_of (YYYY-MM-DD). */
export interface SleepRecord {
  night_of: string;
  tst_min: number;
  is_skipped?: boolean;
}

/** Cycle phase marker (step-function: phase is active from ts until the next marker). */
export interface CyclePhaseMarker {
  ts: number;
  phase: string;
}

/** Extended cycle phase range (used by _detectSymptomPhaseCoupling). */
export interface CyclePhaseRange {
  start: number;
  end: number;
  name: string;
}

export type AnyCyclePhaseEntry = CyclePhaseMarker | CyclePhaseRange;

export interface BodySettings {
  tracking_meal_timing?: boolean;
  tracking_gi?: boolean;
  menstruation?: 'not_anymore' | string;
  energy_envelope?: boolean;
  [k: string]: unknown;
}

/** History bag passed to every pattern detector. */
export interface BodyHistory {
  now?: number;
  dumps?: DumpEntry[];
  waterLog?: WaterEntry[];
  supplementLog?: SupplementLogEntry[];
  focusSessions?: FocusSession[];
  sleepRecords?: SleepRecord[];
  cyclePhases?: AnyCyclePhaseEntry[];
  settings?: BodySettings;
}

// ─── Pattern results ─────────────────────────────────────────────────────────

export interface HeadacheHydrationPattern {
  pattern: 'headache-hydration';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: string; end: string };
  r: number;
  cooccurrences: number;
  copy: string;
  source?: PatternSource;
}

export interface InteroceptionDriftPattern {
  pattern: 'interoception_drift';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: number; end: number };
  cv: number;
  min_gap_min: number;
  max_gap_min: number;
  median_gap_min: number;
  copy: string;
  source?: PatternSource;
}

export interface HyperfocusDehydrationPattern {
  pattern: 'hyperfocus_dehydration';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: string; end: string };
  in_focus_rate: number;
  out_focus_rate: number;
  ratio: number;
  copy: string;
  copy_envelope?: string;
  source?: PatternSource;
}

export interface AfternoonCrashWindowPattern {
  pattern: 'afternoon_crash_window';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: string; end: string };
  peak_block: { start_hour: number; end_hour: number };
  peak_mentions: number;
  peak_share: number;
  unique_days_in_peak: number;
  copy: string;
  source?: PatternSource;
}

export interface SupplementDriftPattern {
  pattern: 'supplement_drift';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: number; end: number };
  recent_days: number;
  prior_days: number;
  drop_ratio: number;
  copy: string;
  source?: PatternSource;
}

export interface MultiSymptomRecurrencePattern {
  pattern: 'multi_symptom_recurrence';
  symptom: string;
  confidence: Confidence;
  sample_n: number;
  date_range: { start: number; end: number };
  correlations: string[];
  phase_dominant: string | null;
  copy: string;
  source?: PatternSource;
}

export interface HungerThirstConfusionPattern {
  pattern: 'hunger_thirst_confusion';
  confidence: Confidence;
  sample_n: number;
  burst_count: number;
  burst_ratio: number;
  date_range: { start: number; end: number };
  copy: string;
  source?: PatternSource;
}

export interface CaffeineWaterTradeoffPattern {
  pattern: 'caffeine_water_tradeoff';
  confidence: Confidence;
  sample_n: number;
  rho: number;
  mean_caffeine: number;
  mean_water: number;
  date_range: { start: string; end: string };
  copy: string;
  source?: PatternSource;
}

export interface MealSkipPattern {
  pattern: 'meal_skip';
  confidence: Confidence;
  sample_n: number;
  skip_days: number;
  morning_food_days: number;
  date_range: { start: number; end: number };
  copy: string;
  source?: PatternSource;
}

export interface GISymptomCyclePhasePattern {
  pattern: 'gi_cycle_phase';
  confidence: Confidence;
  sample_n: number;
  cycles_observed: number;
  phase_dominant: string;
  phase_share: number;
  date_range: { start: number; end: number };
  copy: string;
  source?: PatternSource;
}

export interface MovementGapPattern {
  pattern: 'movement_gap';
  confidence: Confidence;
  sample_n: number;
  movement_days: number;
  date_range: { start: number; end: number };
  copy: string;
  source?: PatternSource;
}

export interface VasomotorPattern {
  pattern: 'vasomotor_pattern';
  confidence: Confidence;
  sample_n: number;
  symptom_days: number;
  date_range: { start: number; end: number };
  copy: string;
  source?: PatternSource;
}

export interface SymptomPhaseCouplingPattern {
  pattern: 'symptom_phase_coupling';
  luteal_symptom_rate: number;
  other_symptom_rate: number;
  lift: number | null;
  luteal_days: number;
  other_days: number;
  sample_n: number;
  confidence: Confidence;
  copy: string;
  source?: PatternSource;
}

export interface SleepDebtSymptomLagPattern {
  pattern: 'sleep_debt_symptom_lag';
  short_symptom_rate: number;
  baseline_symptom_rate: number;
  lift: number | null;
  short_nights: number;
  baseline_nights: number;
  sample_n: number;
  confidence: Confidence;
  copy: string;
  source?: PatternSource;
}

export type AnyBodyPattern =
  | HeadacheHydrationPattern
  | InteroceptionDriftPattern
  | HyperfocusDehydrationPattern
  | AfternoonCrashWindowPattern
  | SupplementDriftPattern
  | MultiSymptomRecurrencePattern
  | HungerThirstConfusionPattern
  | CaffeineWaterTradeoffPattern
  | MealSkipPattern
  | GISymptomCyclePhasePattern
  | MovementGapPattern
  | VasomotorPattern
  | SymptomPhaseCouplingPattern
  | SleepDebtSymptomLagPattern;

// ─── Episode ──────────────────────────────────────────────────────────────────

export type EpisodeKind = 'acute' | 'chronic' | 'mental' | 'mixed' | 'mental_episode' | 'acute_mental' | 'pacing_breach';

export interface SeverityEntry {
  ts: number;
  severity: number;
  note?: string;
}

export interface MedEntry {
  ts: number;
  name: string;
  dose?: string;
}

export interface Episode {
  id: string;
  started_at: number;
  ended_at?: number;
  label: string;
  kind: EpisodeKind | string;
  symptoms: string[];
  meds: MedEntry[];
  severity_log: SeverityEntry[];
  notes: string[];
  tags: string[];
  /** pacing_breach specific */
  hyperfocus_session_ref?: SessionRef;
  expected_recovery_hours?: number;
  closed_at?: number | null;
  opened_at?: number;
  source?: string;
}

export interface EpisodeSummary {
  duration_days: number;
  max_severity: number;
  mean_severity: number;
  n_severity_logs: number;
  n_meds: number;
  unique_meds: number;
  n_notes: number;
  symptoms: string[];
}

export interface EpisodeDurationPattern {
  pattern: 'episode_duration_distribution' | 'mental_episode_duration';
  label: string;
  history_n: number;
  mean_days: number;
  sd_days: number;
  current_days: number;
  outlier: 'long';
  copy: string;
  source?: PatternSource;
}

export interface EpisodeTriggerPattern {
  pattern: 'episode_trigger_correlation' | 'mental_episode_trigger';
  label: string;
  episodes_observed: number;
  trigger: string;
  match_rate: number;
  copy: string;
  source?: PatternSource;
}

export interface EpisodeRecurrencePattern {
  pattern: 'episode_recurrence_rhythm' | 'mental_episode_rhythm';
  label: string;
  episodes_observed: number;
  mean_interval_days: number;
  cv: number;
  predicted_next_ts: number;
  days_until_next: number;
  copy: string;
  source?: PatternSource;
}

export interface MedicationAdherencePattern {
  pattern: 'medication_adherence_gap';
  episode_id: string;
  med_name: string;
  expected_interval_hours: number;
  current_gap_hours: number;
  ratio: number;
  log_count: number;
  copy: string;
  source?: PatternSource;
}

export type AnyEpisodePattern =
  | EpisodeDurationPattern
  | EpisodeTriggerPattern
  | EpisodeRecurrencePattern
  | MedicationAdherencePattern;

// ─── Pacing breach ────────────────────────────────────────────────────────────

export interface SessionRef {
  start: number;
  end: number;
  duration_hours: number;
}

export interface PacingBreachEpisode extends Episode {
  kind: 'pacing_breach';
  hyperfocus_session_ref: SessionRef;
  expected_recovery_hours: number;
  closed_at: number | null;
  opened_at: number;
  source: 'goudsmit-2012';
}

// ─── Treatment plan ───────────────────────────────────────────────────────────

export interface TreatmentPlan {
  id: string;
  label: string;
  cycle_length_days: number;
  total_cycles: number;
  started_at: number;
  cycle_starts: number[];
  notes: string;
}

export interface TreatmentCyclePosition {
  cycle_n: number;
  total: number;
  day_of_cycle: number;
  post_event_days: number;
}

export interface TreatmentSideEffectPattern {
  pattern: 'treatment_side_effect_cycle';
  plan_id: string;
  plan_label: string;
  cycles_observed: number;
  hot_range: { start: number; end: number };
  peak_count: number;
  copy: string;
  source?: PatternSource;
}

// ─── Pattern opts ─────────────────────────────────────────────────────────────

export interface BodyPatternOpts {
  now?: number;
  windowDays?: number;
  minSampleDays?: number;
  minRunLength?: number;
  minAbsR?: number;
  lowGlassesThreshold?: number;
  minEntries?: number;
  cvThreshold?: number;
  minSessions?: number;
  ratioThreshold?: number;
  peakShareThreshold?: number;
  minSampleN?: number;
  dropRatioThreshold?: number;
  priorMinDays?: number;
  minSampleDays2?: number;
  standaloneN?: number;
  phaseConcThreshold?: number;
  sleepLowMin?: number;
  waterLowCount?: number;
  crossThreshold?: number;
  burstWindowMin?: number;
  minBursts?: number;
  minDays?: number;
  rhoThreshold?: number;
  tracking_meal_timing?: boolean;
  skipFloor?: number;
  cutoffHour?: number;
  tracking_gi?: boolean;
  minMentions?: number;
  minCycles?: number;
  concThreshold?: number;
  movementCeiling?: number;
  minObservedDays?: number;
  minLutealDays?: number;
  minOtherDays?: number;
  minLift?: number;
  shortMinutes?: number;
  minShortNights?: number;
  minBaselineNights?: number;
}
