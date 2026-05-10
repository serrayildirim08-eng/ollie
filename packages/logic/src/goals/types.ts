/**
 * @ollie/logic · goals types
 *
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Shared ───────────────────────────────────────────────────────────

export interface PatternSource {
  citation: string;
  url?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export type PacingKind = 'sprint' | 'marathon' | 'rolling';

export type AnchorType = 'identity' | 'metric';

// ─── Goal ─────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  label?: string;
  title?: string;
  status?: string;
  obstacle?: string;
  premortem?: string;
  created_at?: number;
  ulysses_contract?: string;
  pacing?: PacingKind;
  target_date_ts?: number;
  last_activity_at?: number;
  role?: string;
  anchor_type?: AnchorType;
  construal_abstract?: string;
  construal_concrete?: string;
  why_chain?: string[];
  anti_goal?: string;
  interference_tags?: string[];
  hypothesis?: string;
  incubation_until?: number;
}

// ─── Dump ─────────────────────────────────────────────────────────────

export interface DumpEntry {
  id?: string;
  ts: number;
  text?: string;
  rawText?: string;
}

// ─── Session ──────────────────────────────────────────────────────────

export interface GoalSession {
  ts: number;
  goal_id?: string;
  /** 'thinking' | 'doing' */
  type?: string;
}

// ─── Review ───────────────────────────────────────────────────────────

export interface GoalReview {
  ts: number;
  goal_id?: string;
  /** 'invested' or other values */
  alive_flag?: string;
}

// ─── History shapes ───────────────────────────────────────────────────

export interface DumpHistory {
  dumps?: DumpEntry[];
  now?: number;
}

export interface GoalsHistory {
  goals?: Goal[];
  dumps?: DumpEntry[];
  sessions?: GoalSession[];
  reviews?: GoalReview[];
  now?: number;
}

// ─── Opts ─────────────────────────────────────────────────────────────

export interface GoalsOpts {
  consent?: boolean;
  now?: number;
  windowDays?: number;
  min7d?: number;
  min48h?: number;
  lockHours?: number;
  minMatches?: number;
  minAgeDays?: number;
  cap?: number;
  minThinking?: number;
  minRun?: number;
  minDepth?: number;
  stuckDays?: number;
  stuckWeeks?: number;
  dormancyDays?: Record<PacingKind, number>;
  goal?: Goal;
  action?: 'delete' | 'pause';
}

// ─── Signal shapes ────────────────────────────────────────────────────

export interface LowMoodSignal {
  signal: 'goals_low_mood';
  confidence: Confidence;
  evidence: string[];
  copy: string;
  copy_es: string;
  lock_until_ts: number;
  sources: PatternSource[];
}

export interface ObstacleEchoSignal {
  signal: 'goals_obstacle_echo';
  goal_id: string;
  dump_id: string;
  matches: number;
  copy: string;
  copy_es: string;
  sources: PatternSource[];
}

export interface PreMortemEchoSignal {
  signal: 'goals_premortem_echo';
  goal_id: string;
  dump_id: string;
  matches: number;
  copy: string;
  copy_es: string;
  sources: PatternSource[];
}

export interface UlyssesContractSignal {
  signal: 'goals_ulysses_present';
  goal_id: string;
  contract_text: string;
  copy: string;
  copy_es: string;
  ts: number;
  sources: PatternSource[];
}

export interface ActiveCapSignal {
  signal: 'goals_active_cap_exceeded';
  active_count: number;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface ResearchAsProgressSignal {
  signal: 'goals_research_as_progress';
  goal_id: string;
  thinking_count: number;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface IdentityDriftSignal {
  signal: 'goals_identity_drift';
  goal_id: string;
  role: string;
  days_silent: number;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface SunkCostSignal {
  signal: 'goals_sunk_cost_flag';
  goal_id: string;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface PacingClassifiedSignal {
  signal: 'goals_pacing_classified';
  goal_id: string | null;
  pacing: PacingKind;
  dormancy_threshold_days: number | null;
  evidence: string[];
  copy: string;
  sources: PatternSource[];
  ts: number;
}

export interface PacingBreachSignal {
  signal: 'goals_pacing_breach';
  goal_id: string;
  pacing: PacingKind;
  days_since: number;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface ContagionSignal {
  signal: 'goals_contagion';
  matches: number;
  source_excerpt: string | null;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface MissingAnchorPairSignal {
  signal: 'goals_missing_anchor_pair';
  goal_id: string;
  anchor_type: AnchorType;
  missing: 'concrete' | 'abstract';
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface FloatingGoalSignal {
  signal: 'goals_floating_goal';
  goal_id: string;
  reason: 'shallow' | 'dead-end' | 'circular';
  depth: number;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface MissingConstrualSignal {
  signal: 'goals_missing_construal';
  goal_id: string;
  missing: 'concrete' | 'abstract';
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface ConstrualFrame {
  frame: 'abstract' | 'concrete';
  text: string;
  copy: string;
  copy_es: string;
}

export interface AntiGoalOpportunitySignal {
  signal: 'goals_anti_goal_opportunity';
  goal_id: string;
  mode: 'avoidance' | 'suggest';
  anti_goal?: string;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface AntiGoalInDumpSignal {
  signal: 'goals_anti_goal_in_dump';
  excerpt: string;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface GoalInterferenceSignal {
  signal: 'goals_interference';
  conflicts: Array<{ goal_a_id: string; goal_b_id: string; tag_a: string; tag_b: string }>;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface ExperimentCandidateSignal {
  signal: 'goals_experiment_candidate';
  goal_id: string;
  weeks_stuck: number;
  has_hypothesis: boolean;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface UlyssesText {
  goal_id: string | null;
  text: string;
}
