/**
 * @ollie/logic · sleep types
 *
 * All types for the sleep sub-namespace.
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Confidence ──────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low';

// ─── Parse / merge ───────────────────────────────────────────────────

export interface RawSpan {
  start: number;
  end: number;
}

export interface SleepRecord {
  id?: string;
  created_at?: number;
  last_edited_at?: number;
  extractor_version?: string;
  raw_source_id?: string | null;
  raw_span?: RawSpan | null;
  night_of: string;          // YYYY-MM-DD
  bedtime: string | null;    // HH:MM
  wake_time: string | null;  // HH:MM
  onset_latency_min: number | null;
  wakings_count: number | null;
  wakings_total_min: number | null;
  /** total sleep time (computed) */
  tst_min?: number | null;
  /** time in bed (computed) */
  time_in_bed_min?: number | null;
  /** sleep efficiency = tst / tib (computed) */
  efficiency?: number | null;
  quality: number | null;    // 1–5
  quality_text: string | null;
  notes: string | null;
  tokens: string[];
  is_skipped: boolean;
  is_partial: boolean;
  is_disputed: boolean;
  cycle_phase?: string | null;
  journal_entry_ids?: string[];
}

export interface ParsedSleepResult {
  record: Omit<SleepRecord, 'id' | 'created_at' | 'last_edited_at' | 'extractor_version' | 'raw_source_id' | 'tst_min' | 'time_in_bed_min' | 'efficiency'> | null;
  span: RawSpan | null;
}

// ─── Stats ────────────────────────────────────────────────────────────

export interface SleepStats {
  nights_counted: number;
  tst_mean_min: number;
  tst_sd_min: number;
  sol_mean_min: number;
  wakings_mean: number;
  efficiency_mean: number | null;
}

export interface SleepDebt {
  totalDeficitHours: number;
  nightsCounted: number;
}

// ─── Chronotype ───────────────────────────────────────────────────────

export interface ChronotypeResult {
  msfSc: number;
  msfScFormatted: string;
  category: string;
  nNights: number;
}

export interface SocialJetlagResult {
  hours: number;
  direction: 'free-later' | 'free-earlier';
  nWeekdayNights: number;
  nWeekendNights: number;
}

// ─── Drift ────────────────────────────────────────────────────────────

export interface BedtimeDriftResult {
  slope: number;
  r2: number;
  direction: 'later' | 'earlier';
  n_nights: number;
}

// ─── Correlation ──────────────────────────────────────────────────────

export type CorrelationMetric = 'sol' | 'tst' | 'efficiency' | 'wakings';

export interface CorrelationResult {
  metric: CorrelationMetric;
  meanWith: number;
  meanWithout: number;
  nWith: number;
  nWithout: number;
  effectSize: number;
}

// ─── DSPS ─────────────────────────────────────────────────────────────

export interface DSPSResult {
  runWeeks: number;
  medianBedtime: string;
  medianWake: string;
  lateBedtimeFraction: number;
  nNights: number;
}

// ─── Short sleep run ─────────────────────────────────────────────────

export interface ShortSleepRunResult {
  runNights: number;
  meanTst: number;
}

// ─── Forecast ─────────────────────────────────────────────────────────

export interface ForecastResult {
  mean_h: number;
  ci95_h: [number, number];
  mean_min: number;
  ci95_min: [number, number];
  tier: string;
  method: string;
  nights_counted: number;
}

export interface PredictApi {
  forecast(hours: number[], opts: { preset: string }): { mean: number; ci95: [number, number]; tier: string; method: string } | null;
}

// ─── Insomnia severity survey ─────────────────────────────────────────
// A 7-question instrument modelled on the Insomnia Severity Index (ISI):
// every item is scored 0–4, total 0–28. This is the "go deeper" lite
// survey — NOT a full clinical battery. Each answer is the chosen
// 0–4 option index for the matching question.

export type InsomniaSurveyAnswers = [
  number, number, number, number, number, number, number,
];

export type InsomniaSeverityBand =
  | 'none'           // 0–7   · no clinically significant insomnia
  | 'subthreshold'   // 8–14  · subthreshold insomnia
  | 'moderate'       // 15–21 · moderate insomnia
  | 'severe';        // 22–28 · severe insomnia

export interface InsomniaSurveyResult {
  /** Sum of the 7 item scores, 0–28. */
  score: number;
  /** Severity band derived from the score. */
  band: InsomniaSeverityBand;
  /** Number of questions answered with a valid 0–4 value. */
  answered: number;
  /** ms timestamp the survey was scored. */
  scored_at: number;
}

// ─── Pattern source ───────────────────────────────────────────────────

export interface PatternSource {
  citation: string;
  url: string;
}

// ─── Pattern shapes ───────────────────────────────────────────────────

export interface RevengeBedtimePattern {
  pattern: 'revenge_bedtime';
  n_revenge_nights: number;
  n_total_nights: number;
  median_delay_min: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface CaffeineCutoffPattern {
  pattern: 'caffeine_cutoff';
  n_violation_days: number;
  median_gap_hours: number;
  onset_delta_min: number | null;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface SleepOnsetGapPattern {
  pattern: 'sleep_onset_gap';
  n_valid_nights: number;
  n_low_efficiency_nights: number;
  median_onset_latency_min: number;
  median_efficiency: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface WeekendRecoveryIllusionPattern {
  pattern: 'weekend_recovery_illusion';
  weekday_mean_h: number;
  weekend_mean_h: number;
  gap_min: number;
  n_weekday_nights: number;
  n_weekend_nights: number;
  n_weeks_estimated: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface BedtimeMindRacingPattern {
  pattern: 'bedtime_mind_racing';
  n_high_score_nights: number;
  n_window_nights_with_dumps: number;
  median_score: number;
  top_phrases: string[];
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface WindDownFrictionPattern {
  pattern: 'wind_down_friction';
  median_total_minutes: number;
  stuck_step_id: string;
  stuck_step_label: string | null;
  median_stuck_minutes: number;
  n_nights: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface MedicationTimingDriftPattern {
  pattern: 'medication_timing_drift';
  recent_3wk_median_gap_hours: number;
  prior_3wk_median_gap_hours: number;
  drift_hours: number;
  direction: 'narrowing' | 'widening';
  n_paired_nights: number;
  confidence: Confidence;
  copy: string;
  prescriber_link_copy: string;
  source: PatternSource;
}

export interface ChronotherapyProgressPattern {
  pattern: 'chronotherapy_progress';
  target_bedtime: string;
  median_bedtime_first_7: string;
  median_bedtime_last_7: string;
  movement_minutes: number;
  direction: 'forward' | 'back' | 'flat';
  n_nights: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface SleepCyclePhaseShiftPattern {
  pattern: 'sleep_cycle_phase_shift';
  luteal_median_bedtime: string;
  follicular_median_bedtime: string;
  shift_minutes: number;
  direction: 'luteal_later' | 'luteal_earlier';
  n_cycles: number;
  n_luteal_nights: number;
  n_follicular_nights: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface SleepFocusShiftPattern {
  pattern: 'sleep_focus_shift';
  short_sleep_peak_hour: number;
  normal_sleep_peak_hour: number;
  hour_shift: number;
  direction: 'later' | 'earlier';
  n_post_short_sessions: number;
  n_post_normal_sessions: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface SleepDumpMoodShiftPattern {
  pattern: 'sleep_dump_mood_shift';
  poor_sleep_overwhelm_ratio: number;
  normal_sleep_overwhelm_ratio: number;
  ratio_lift: number;
  n_poor_sleep_dumps: number;
  n_normal_sleep_dumps: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface CyclePhaseSleepCouplingPattern {
  pattern: 'cycle_phase_sleep_coupling';
  luteal_onset_median_min: number;
  other_onset_median_min: number;
  delta_min: number;
  luteal_n: number;
  other_n: number;
  sample_n: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export interface StimulantSleepDebtPattern {
  pattern: 'stimulant_sleep_debt';
  stim_onset_median_min: number;
  baseline_onset_median_min: number;
  delta_min: number;
  stim_n: number;
  baseline_n: number;
  sample_n: number;
  confidence: Confidence;
  copy: string;
  source: PatternSource;
}

export type AnySleepPattern =
  | RevengeBedtimePattern
  | CaffeineCutoffPattern
  | SleepOnsetGapPattern
  | WeekendRecoveryIllusionPattern
  | BedtimeMindRacingPattern
  | WindDownFrictionPattern
  | MedicationTimingDriftPattern
  | ChronotherapyProgressPattern
  | SleepCyclePhaseShiftPattern
  | SleepFocusShiftPattern
  | SleepDumpMoodShiftPattern
  | CyclePhaseSleepCouplingPattern
  | StimulantSleepDebtPattern;

// ─── History shapes (input to pattern detectors) ─────────────────────

export interface ActionLogEntry {
  ts: number;
}

export interface WindDownLogEntry {
  ts: number;
  step_id: string;
  step_label?: string;
  action: 'checked' | 'unchecked';
}

export interface MedsLogEntry {
  ts: number;
}

export interface DumpEntry {
  ts: number;
  text: string;
}

export interface FocusLogEntry {
  at: number;
}

export interface CycleRecord {
  start_date: string;   // YYYY-MM-DD
  length_days: number;
  ovulation_day?: number;
}

export interface CyclePhaseWindow {
  start: number;   // ms
  end: number;     // ms
  name: string;    // e.g. 'luteal' | 'follicular'
}

export interface ChronotherapyConfig {
  active: boolean;
  target_bedtime: string;
}

export interface SleepSettings {
  target_hours?: number;
  weekday_set?: string[];
  weekend_set?: string[];
  show_cross_cycle?: boolean;
  show_cross_focus?: boolean;
  show_cross_mood?: boolean;
}

// Generic history objects passed to pattern detectors
export interface BaseHistory {
  now: number;
  sleepRecords: SleepRecord[];
  opted_in?: boolean;
}

export interface RevengeBedtimeHistory extends BaseHistory {
  actionLog: ActionLogEntry[];
  targetBedtime: string;
}

export interface CaffeineCutoffHistory extends BaseHistory {
  dumps: DumpEntry[];
}

export interface WindDownFrictionHistory extends BaseHistory {
  windDownLog: WindDownLogEntry[];
  targetBedtime: string;
  opted_in: true;
}

export interface MedicationTimingDriftHistory extends BaseHistory {
  medsLog: MedsLogEntry[];
  opted_in: true;
}

export interface ChronotherapyProgressHistory extends BaseHistory {
  chronotherapy: ChronotherapyConfig;
  opted_in: true;
}

export interface SleepCycleHistory extends BaseHistory {
  cycles: CycleRecord[];
  opted_in: true;
}

export interface SleepFocusHistory extends BaseHistory {
  focusLog: FocusLogEntry[];
  opted_in: true;
}

export interface SleepMoodHistory extends BaseHistory {
  dumps: DumpEntry[];
  opted_in: true;
}

export interface CyclePhaseSleepHistory extends BaseHistory {
  cyclePhases: CyclePhaseWindow[];
  opted_in: true;
}

export interface StimulantSleepHistory extends BaseHistory {
  dumps: DumpEntry[];
  opted_in: true;
}

// ─── Pattern opts ─────────────────────────────────────────────────────

export interface RevengeBedtimeOpts {
  window_nights?: number;
  revenge_min_minutes?: number;
  run_length_floor?: number;
}

export interface CaffeineCutoffOpts {
  window_days?: number;
  gap_threshold_hours?: number;
  min_violation_nights?: number;
}

export interface SleepOnsetGapOpts {
  window_nights?: number;
  efficiency_floor?: number;
  onset_floor_min?: number;
  min_violation_nights?: number;
}

export interface WeekendRecoveryOpts {
  window_nights?: number;
  weekday_max_min?: number;
  min_gap_min?: number;
  min_weeks?: number;
  weekday_set?: string[];
  weekend_set?: string[];
}

export interface BedtimeMindRacingOpts {
  window_nights?: number;
  window_minutes?: number;
  score_threshold?: number;
  min_match_nights?: number;
}

export interface WindDownFrictionOpts {
  window_nights?: number;
  min_total_minutes?: number;
  min_nights?: number;
}

export interface MedicationTimingDriftOpts {
  window_days?: number;
  min_paired_nights?: number;
  drift_threshold_hours?: number;
}

export interface ChronotherapyProgressOpts {
  window_nights?: number;
  min_nights?: number;
  min_movement_minutes?: number;
}

export interface CyclePhaseSleepOpts {
  window_cycles?: number;
  min_overlap_nights?: number;
}

export interface SleepFocusOpts {
  short_sleep_threshold_h?: number;
  min_short_nights?: number;
  min_baseline_nights?: number;
}

export interface SleepMoodOpts {
  poor_sleep_threshold_h?: number;
  lookback_hours_window?: number;
  min_pairs?: number;
}

export interface CyclePhaseSleepCouplingOpts {
  minLutealNights?: number;
  minOtherNights?: number;
  minDeltaMin?: number;
}

export interface StimulantSleepDebtOpts {
  minStimNights?: number;
  minBaselineNights?: number;
  minDeltaMin?: number;
}
