/**
 * @ollie/logic · pets types
 *
 * All types for the pets sub-namespace.
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Species ─────────────────────────────────────────────────────────

export type SpeciesKey =
  | 'guinea_pig'
  | 'rabbit'
  | 'cat'
  | 'dog'
  | 'hamster'
  | 'rat'
  | 'bearded_dragon'
  | 'leopard_gecko'
  | 'parakeet'
  | 'betta_fish';

export type SocialTaxonomy =
  | 'prey_animal'
  | 'independent'
  | 'pack'
  | 'solitary'
  | 'solitary_reptile'
  | 'flock'
  | 'solitary_fish';

export interface WelfareFlags {
  must_pair: boolean;
  solo_max_hours: number | null;
  minimum_cage_area_m2: number | null;
}

export interface CareTask {
  cadence_days: number;
  critical_days: number;
  source: string;
  source_url: string;
  welfare_note: string | null;
}

export interface TrustStage {
  stage: number;
  name: string;
  observable: string[];
}

export interface BondingProfile {
  build_rate: 'fast' | 'slow' | 'variable';
  min_daily_minutes: number;
  forget_window_days: number;
  trust_stages: TrustStage[];
}

export interface ParserKeyword {
  kw: string;
  conf: number;
}

export interface HealthFlagConfig {
  signals: string[];
  severity: 'urgent' | 'vet_soon' | 'watch';
  welfare_note: string;
  source_url: string;
}

export interface SpeciesProfile {
  display_name: string;
  display_name_plural: string;
  social_taxonomy: SocialTaxonomy;
  welfare_flags: WelfareFlags;
  care_tasks: Record<string, CareTask>;
  bonding: BondingProfile;
  parser_keywords: Record<string, ParserKeyword[]>;
  observation_tags: string[];
  species_terms: string[];
  health_flags: Record<string, HealthFlagConfig>;
}

export type SpeciesProfiles = Record<string, SpeciesProfile>;

// ─── Pet entity ───────────────────────────────────────────────────────

export interface Pet {
  id: string;
  name: string;
  nickname?: string;
  species: string;
  adopted_at?: number;
  created_at?: number;
  archived?: boolean;
}

// ─── Care log ─────────────────────────────────────────────────────────

export interface CareLogEntry {
  pet_id: string;
  task: string;
  occurred_at: number;
}

// ─── Observation ─────────────────────────────────────────────────────

export interface Observation {
  pet_id: string;
  text: string;
  tags: string[];
  occurred_at?: number;
}

// ─── Care gap ─────────────────────────────────────────────────────────

export type CareSeverity = 'ok' | 'nudge' | 'soft' | 'firm' | 'concerned';

export interface CareGap {
  pet_id: string;
  task: string;
  last_occurred_at: number | null;
  days_since: number | null;
  severity: CareSeverity;
  critical: boolean;
}

// ─── Health flag ──────────────────────────────────────────────────────

export interface PetHealthFlag {
  flag: string;
  run_length: number;
  last_signal_at: number;
  source_url: string;
}

// ─── Guilt-trip copy ──────────────────────────────────────────────────

export interface GuiltCopy {
  level: CareSeverity | 'ok';
  text: string;
}

// ─── Forecast ─────────────────────────────────────────────────────────

// todayForecast returns a plain string
export type TodayForecast = string;

// ─── Trust level ──────────────────────────────────────────────────────

export interface TrustLevel {
  stage: number;
  progress: number;
  stageName: string;
}

// ─── Summary ─────────────────────────────────────────────────────────

export interface PetsSummary {
  n_pets: number;
  n_gaps: number;
  n_critical: number;
  n_health_flags_pending: number;
  most_pressing: { pet_id: string; task: string; severity: CareSeverity } | null;
}

// ─── Parse results ────────────────────────────────────────────────────

export interface PetMentionMatch {
  pet_id: string;
  task: string;
  confidence: number;
  raw_text: string;
  occurred_at: number;
}

export interface PetMentionResult {
  matches: PetMentionMatch[];
  observations: Observation[];
}

// ─── Away intent ──────────────────────────────────────────────────────

export interface AwayIntent {
  active: boolean;
  returning_at: number;
}

// ─── Session intent ───────────────────────────────────────────────────

export interface SessionIntent {
  type: 'start' | 'close' | null;
  pet_id: string | null;
  at: number;
}

// ─── Milestone ────────────────────────────────────────────────────────

export interface Milestone {
  pet_id: string;
  tag: string;
  first_seen_at: number;
  raw_text: string;
}

// ─── Weather alert ────────────────────────────────────────────────────

export interface WeatherInput {
  temp?: number;
}

export interface WeatherAlert {
  task: string;
  severity: CareSeverity;
  welfare_note: string;
}

// ─── Vet schedule ─────────────────────────────────────────────────────

export interface VetScheduleItem {
  id?: string;
  pet_id?: string;
  kind?: string;
  cadence_days: number;
  last_completed_at?: number;
  created_at?: number;
  linked_event?: string;
  cues?: VetCue[];
}

export interface VetCue {
  offset_days: number;
  stage: string;
  at: number;
  linked_event: string;
  next_action: string;
  copy: string;
}

export interface VetCueSchedule {
  pattern: 'vet-cues';
  vet_id: string | null;
  pet_id: string | null;
  kind: string;
  due_at: number;
  suggested_event: string;
  cues: VetCue[];
  source: { citation: string; url: string };
}

// ─── Coregulation log ─────────────────────────────────────────────────

export type CoregSentiment = 'calm' | 'neutral' | 'agitated';

export interface CoregulationEntry {
  ts: number;
  pet_present: boolean;
  sentiment: CoregSentiment;
  pet_id?: string;
}

// ─── Miss log ────────────────────────────────────────────────────────

export interface MissEntry {
  ts: number;
  pet_id?: string;
  task?: string;
}

// ─── Projection log ───────────────────────────────────────────────────

export interface ProjectionEntry {
  ts: number;
  pet_id?: string;
}

// ─── Pets state (passed to pattern detectors) ─────────────────────────

export interface PetsState {
  pets?: Pet[];
  care_log?: CareLogEntry[];
  vet_schedule?: VetScheduleItem[];
  coregulation_log?: CoregulationEntry[];
  miss_log?: MissEntry[];
  projection_log?: ProjectionEntry[];
  micro_steps?: Array<{ pet_id: string; task: string; micro_step: string }>;
}

// ─── Habits state (for P1 vet cue suggestion) ────────────────────────

export interface HabitsState {
  habits?: Array<{ external_cue?: string; name?: string }>;
}

// ─── Pattern opts ────────────────────────────────────────────────────

export interface PatternOpts {
  consent?: boolean;
  now?: number;
  minRunLength?: number;
  cooldownMs?: number;
  lastSurfacedAt?: number | Record<string, number>;
  windowDays?: number;
  minTagged?: number;
  minLift?: number;
  joinWindowMs?: number;
  workCrashLog?: Array<{ ts: number; reply: string }>;
  bodySleepDebtEvents?: Array<{ ts: number }>;
  cycleLutealMarkers?: Array<{ ts: number }>;
  speciesProfiles?: SpeciesProfiles;
  habitsState?: HabitsState;
}

// ─── Pattern results ─────────────────────────────────────────────────

export interface PatternSource {
  citation: string;
  url: string;
}

export interface VetAdherenceDelayPattern {
  pattern: 'vet-adherence-delay';
  vet_id: string | undefined;
  pet_id: string | null;
  kind: string;
  days_overdue: number;
  run_length: number;
  confidence: 'high' | 'medium';
  copy: string;
  next_action: string;
  source: PatternSource;
}

export interface CoRegulatorPattern {
  pattern: 'pet-co-regulator';
  pet_id: string | null;
  sample_n: number;
  calm_with_pet: number;
  calm_without_pet: number;
  lift: number;
  confidence: 'high' | 'medium';
  copy: string;
  source: PatternSource;
}

export interface CareActivationBarrierPattern {
  pattern: 'care-activation-barrier';
  pet_id: string;
  task: string;
  days_since: number;
  run_length: number;
  cadence_days: number;
  prompt: string;
  copy: string;
  source: PatternSource;
}

export interface CrashContextMissesPattern {
  pattern: 'crash-context-misses';
  sample_n: number;
  crash_tagged_n: number;
  ratio: number;
  run_length: number;
  confidence: 'high' | 'medium';
  copy: string;
  suggestion: string;
  source: PatternSource;
}

export interface ProjectionMatchPattern {
  pattern: 'projection-mirror';
  matched_term: string;
  snippet: string;
  copy: string;
  source: PatternSource;
}

export interface ProjectionPatternResult {
  pattern: 'projection-pattern';
  pet_id: string | null;
  sample_n: number;
  window_days: number;
  run_length: number;
  confidence: 'high' | 'medium';
  copy: string;
  source: PatternSource;
}

export type AnyPattern =
  | VetAdherenceDelayPattern
  | CoRegulatorPattern
  | CareActivationBarrierPattern
  | CrashContextMissesPattern
  | ProjectionMatchPattern
  | ProjectionPatternResult;

// ─── Vocab ────────────────────────────────────────────────────────────

export interface VocabTerm {
  term: string;
  gloss: string;
}
