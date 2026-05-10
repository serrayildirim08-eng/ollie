/**
 * @ollie/logic · work types
 *
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Shared ───────────────────────────────────────────────────────────

export interface PatternSource {
  citation: string;
  url: string;
}

export type Confidence = 'high' | 'medium' | 'low';

// ─── Sessions ─────────────────────────────────────────────────────────

export interface WorkSession {
  id?: string;
  /** timestamp of session start (ms) */
  at?: number;
  start?: number;
  end?: number;
  duration_min?: number;
  swap_log?: unknown[];
  task_tags?: string[];
}

// ─── Meetings ─────────────────────────────────────────────────────────

export interface Meeting {
  id?: string | null;
  start_at: number;
  end_at: number;
}

export interface RecurringMeeting {
  id?: string;
  title?: string;
  status?: string;
}

// ─── Tasks ────────────────────────────────────────────────────────────

export interface WorkTask {
  id?: string;
  title?: string;
  created_at?: number;
  completed_at?: number | null;
  first_session_at?: number | null;
  first_micro_step?: string;
}

// ─── Deadline ─────────────────────────────────────────────────────────

export interface Deadline {
  id?: string | null;
  title?: string;
  due_at: number;
  linked_event?: string;
}

// ─── Logs ─────────────────────────────────────────────────────────────

export interface ShutdownLogEntry {
  ts: number;
}

export interface TriageDay {
  date_key: string;
  reason?: string | null;
}

export interface EstimationLogEntry {
  estimated_min: number;
  actual_min: number;
}

export interface MeetingBufferLog {
  accept_log?: number[];
  decline_log?: number[];
}

export interface OneMoreThingEntry {
  session_id: string;
}

export interface CrashLogEntry {
  session_id?: string;
  reply?: string;
}

export interface TabReport {
  count: number;
}

export interface NotificationTaxEntry {
  ts: number;
  kind?: 'impulse_check' | 'notification' | 'actual_need' | string;
}

export interface MultitaskEntry {
  task_count: number;
  completion_rate: number;
}

export interface RsdAnchorEntry {
  landed?: 'fine' | 'sting' | 'shame_spike' | 'mixed' | string;
}

// ─── Work state ───────────────────────────────────────────────────────

export interface WorkState {
  sessions?: WorkSession[];
  meetings?: Meeting[];
  recurring_meetings?: RecurringMeeting[];
  tasks?: WorkTask[];
  shutdown_log?: ShutdownLogEntry[];
  triage_days?: TriageDay[];
  estimation_log?: EstimationLogEntry[];
  meeting_buffer?: MeetingBufferLog;
  one_more_thing_log?: OneMoreThingEntry[];
  crash_log?: CrashLogEntry[];
  tab_reports?: TabReport[];
  notification_tax_log?: NotificationTaxEntry[];
  multitask_log?: MultitaskEntry[];
  rsd_anchor_log?: RsdAnchorEntry[];
}

// ─── Habits cross-module ──────────────────────────────────────────────

export interface HabitsState {
  habits?: Array<{ external_cue?: string; name?: string }>;
}

// ─── Opts ─────────────────────────────────────────────────────────────

export interface WorkPatternOpts {
  consent?: boolean;
  now?: number;
  review?: boolean;
  windowDays?: number;
  minSessions?: number;
  meanSwapThreshold?: number;
  cliffWindowMs?: number;
  minMeetings?: number;
  maxGapMs?: number;
  gapDays?: number;
  sleep?: { hours: number } | null;
  thresholdMs?: number;
  minEntries?: number;
  windowEntries?: number;
  daysSinceOnboarding?: number;
  sessionId?: string;
  minHours?: number;
  minRunLength?: number;
  minSampleSize?: number;
  minReports?: number;
  threshold?: number;
  minTotal?: number;
  minPerCohort?: number;
  minSample?: number;
  triage?: boolean;
  habitsState?: HabitsState;
  deadlines?: Deadline[];
  taskTitle?: string;
  // legacy W0
  minBreachHours?: number;
  minLift?: number;
}

// ─── Pattern shapes ───────────────────────────────────────────────────

export interface DeepFocusHoursPattern {
  pattern: 'deep-focus-hours';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: string; end: string };
  peak_block: { start_hour: number; end_hour: number };
  peak_mean_minutes: number;
  peak_n: number;
  overall_mean_minutes: number;
  copy: string;
  copy_envelope: string;
}

export interface PacingBreachPattern {
  pattern: 'pacing-breach';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: string; end: string };
  session: { start: number; end: number; duration_min: number };
  duration_label: string;
  copy: string;
  copy_envelope: string;
  source: PatternSource;
}

export interface TaskSwitchTaxPattern {
  pattern: 'task-switch-tax';
  confidence: Confidence;
  sample_n: number;
  total_swaps: number;
  mean_swaps_per_session: number;
  window_days: number;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface MeetingCliffPattern {
  pattern: 'meeting-cliff';
  confidence: Confidence;
  date_key: string;
  meeting_count: number;
  meeting_ids: Array<string | null>;
  span_ms: number;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface DeadlineCue {
  offset_days: number;
  stage: string;
  at: number;
  linked_event: string;
  next_action: string;
  copy: string;
  copy_es: string;
}

export interface DeadlineCuesPattern {
  pattern: 'deadline-cues';
  deadline_id: string | null;
  title: string;
  suggested_event: string;
  cues: DeadlineCue[];
  copy: string;
  source: PatternSource;
}

export interface ShutdownGapPattern {
  pattern: 'shutdown-gap';
  confidence: Confidence;
  last_shutdown_ts: number | null;
  days_since: number | null;
  low_sleep_signal: boolean;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface ShutdownPrompt {
  questions: Array<{ id: string; label: string }>;
  copy: string;
  copy_es: string;
}

export interface TriageDayAnchorPattern {
  pattern: 'triage-day-anchor';
  date_key: string;
  reason: string | null;
  prompt: string;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface ActivationBarrierPattern {
  pattern: 'activation-barrier';
  task_id: string | undefined;
  task_title: string;
  prompt: string;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface EstimationDriftPattern {
  pattern: 'estimation-drift';
  multiplier: number;
  sample_size: number;
  copy: string;
  copy_es: string;
  suggestion: string;
  source: PatternSource;
}

export interface PostMeetingBufferPattern {
  pattern: 'post-meeting-buffer';
  default_state: 'on' | 'off';
  last3: string[];
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface OneMoreThingSpiralPattern {
  pattern: 'one-more-thing-spiral';
  session_id: string;
  presses: number;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface HyperfocusCrashPromptPattern {
  pattern: 'hyperfocus-crash-prompt';
  session_id: string | undefined;
  session_at: number;
  session_hours: number;
  prompt: string;
  chips: string[];
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface HyperfocusCrashPattern {
  pattern: 'hyperfocus-crash-pattern';
  yes_count: number;
  sample_size: number;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface TabSprawlPattern {
  pattern: 'tab-sprawl';
  mean: number;
  sample_size: number;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface NotificationTaxPattern {
  pattern: 'notification-tax';
  window_days: number;
  self_checks: number;
  external_interruptions: number;
  actual_needs: number;
  total: number;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface RecurringMeetingDeadPattern {
  pattern: 'recurring-meeting-dead';
  meeting_id: string | undefined;
  title: string;
  cancel_draft: string;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface MultitaskIllusionPattern {
  pattern: 'multitask-illusion';
  multi_completion: number;
  solo_completion: number;
  multi_n: number;
  solo_n: number;
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface RsdAnchorPromptPattern {
  pattern: 'rsd-anchor-prompt';
  matched_title: string;
  prompt: string;
  chips: string[];
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export interface RsdAnchorMirrorPattern {
  pattern: 'rsd-anchor-mirror';
  sample_size: number;
  counts: { fine: number; sting: number; shame_spike: number; mixed: number };
  copy: string;
  copy_es: string;
  source: PatternSource;
}

export type AnyWorkPattern =
  | DeepFocusHoursPattern
  | PacingBreachPattern
  | TaskSwitchTaxPattern
  | MeetingCliffPattern
  | DeadlineCuesPattern
  | ShutdownGapPattern
  | TriageDayAnchorPattern
  | ActivationBarrierPattern
  | EstimationDriftPattern
  | PostMeetingBufferPattern
  | OneMoreThingSpiralPattern
  | HyperfocusCrashPromptPattern
  | HyperfocusCrashPattern
  | TabSprawlPattern
  | NotificationTaxPattern
  | RecurringMeetingDeadPattern
  | MultitaskIllusionPattern
  | RsdAnchorPromptPattern
  | RsdAnchorMirrorPattern;
