/**
 * @ollie/logic · admin types
 *
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Sources ────────────────────────────────────────────────────────────

export interface AdminSource {
  citation: string;
  url?: string;
}

// ─── Task shapes ────────────────────────────────────────────────────────

export type TaskState = 'active' | 'done' | 'closed' | 'waiting';
export type BallState = 'MINE' | 'THEIRS' | 'WAITING';
export type RenewalStage = 'early' | 'mid' | 'urgent' | 'overdue';
export type EFState = 1 | 2 | 3 | 4 | 5;
export type EFStateName = 'crash' | 'low' | 'flow' | 'peak';

export interface DocRef {
  label: string;
  link: string;
}

export interface AdminTask {
  id: string;
  label?: string;
  title?: string;
  kind?: string;
  state?: TaskState;
  ball_state?: BallState;
  stage?: string;
  parent_task_id?: string;
  category?: string;
  defer_count?: number;
  deferred_count?: number;
  duration_min?: number;
  expiry_ts?: number;
  action_verb?: string;
  done_at?: number;
  closed_at?: number;
  last_transition_at?: number;
  eta_at?: number;
  ef_cost?: number;
  cost_of_delay?: string;
  scheduled_at?: number;
  doc_refs?: DocRef[];
}

export interface DumpEntry {
  id?: string;
  ts: number;
  text?: string;
  rawText?: string;
}

export interface AdminHistory {
  now?: number;
  dumps?: DumpEntry[];
  tasks?: AdminTask[];
  dump_text?: string;
}

export interface AdminOpts {
  now?: number;
  windowHours?: number;
  dump_text?: string;
  tasks?: AdminTask[];
  theirsDays?: number;
  etaGraceDays?: number;
  gapDays?: number;
  minDefers?: number;
  horizonDays?: number;
  minSpanMonths?: number;
  deferThreshold?: number;
  threshold?: number;
  consent?: boolean;
}

// ─── Signal shapes ───────────────────────────────────────────────────────

export interface OpenLoopSignal {
  signal: 'admin_open_loop_missing';
  dump_id: string;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface PhoneTaskSignal {
  signal: 'admin_phone_task';
  verb: string;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
}

export interface RenewalCueSignal {
  signal: 'admin_renewal_cue';
  task_id: string;
  stage: RenewalStage;
  days_left: number;
  copy: string;
  sources: AdminSource[];
  ts: number;
}

export interface StaleBallSignal {
  signal: 'admin_stale_ball';
  task_id: string;
  kind: 'stale_theirs' | 'deadline_passed';
  days_overdue: number;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface ActivationCostSignal {
  signal: 'admin_activation_cost';
  task_id: string | null;
  tier: EFState;
  fits_state: boolean;
  copy: string;
  sources: AdminSource[];
}

export interface Last5PctSignal {
  signal: 'admin_last_5pct';
  task_id: string;
  days_since_done: number;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface PaperworkSplitSignal {
  signal: 'admin_paperwork_split';
  dump_match: true;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface PaperworkSplitExistingSignal {
  signal: 'admin_paperwork_split_existing';
  task_id: string;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface FirehoseDumpSignal {
  signal: 'admin_firehose_dump';
  candidate_items: string[];
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface DeferChainSignal {
  signal: 'admin_defer_chain';
  task_id: string;
  defer_count: number;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface TwoMinuteTaskSignal {
  signal: 'admin_two_minute_tasks';
  count: number;
  batch: boolean;
  task_ids: string[];
  copy: string;
  sources: AdminSource[];
  ts: number;
}

export interface RecurringPatternSignal {
  signal: 'admin_recurring_pattern';
  category_or_label: string;
  predicted_next_ts: number;
  days_until: number;
  history_count: number;
  copy: string;
  copy_es: string;
  sources: AdminSource[];
  ts: number;
}

export interface CostOfDelayParsed {
  pattern: 'cost-of-delay';
  cost_text: string;
}

export interface CostOfDelaySurface {
  task_id: string | undefined;
  cost_of_delay: string;
  copy: string;
  copy_es: string;
}

export interface DecisionRecall {
  rule_id: string;
  topic_key: string;
  choice: string;
  copy: string;
  copy_es: string;
}

export interface DecisionRule {
  id: string;
  topic_key: string;
  choice: string;
  revoked?: boolean;
}

export interface ScheduleDetected {
  pattern: 'scheduled-detected';
  raw: string;
}

export interface ScheduleDriftEntry {
  task_id?: string;
  category?: string;
  scheduled_at?: number;
  done_at?: number;
}

export interface ScheduleDrift {
  category: string;
  drift_count: number;
  task_ids: Array<string | undefined>;
  copy: string;
  copy_es: string;
}

export interface AdminState {
  decision_rules?: DecisionRule[];
  scheduled_log?: ScheduleDriftEntry[];
}
