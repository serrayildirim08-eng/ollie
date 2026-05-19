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
  title?: string;
  start_at: number;
  end_at: number;
  /** Convenience copy of (end_at - start_at)/60_000; set by UI on create. */
  duration_min?: number;
  /** Free-form attendee names. Optional. */
  attendees?: string[];
  /** When set, suppresses re-emission of the 30-min-prior cue. */
  reminder_30m_fired_at?: number;
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
  /** Optional link to work.projects[].id for time-tracking + freelance billing. */
  project_id?: string;
}

// ─── Projects ─────────────────────────────────────────────────────────
// Maya freelance v1 ICP need: project/client organization + hours billed
// rollup. Stored under work.projects.

export interface Project {
  id: string;
  name: string;
  /** Optional hex color (#RRGGBB) for UI swatch. */
  color?: string;
  created_at: number;
  /** Rolled-up minutes attributed to this project from focus_log. */
  hours_billed_to_date?: number;
  /** Soft-archive flag. UI hides archived from active picker. */
  archived_at?: number | null;
}

// ─── Focus log ────────────────────────────────────────────────────────
// One entry per completed focus session. Written by WorkModule timer.
// duration_min is locked to one of the four supported modes.

export type FocusDurationMin = 15 | 25 | 45 | 90;

export interface FocusLogEntry {
  /** ISO ms epoch of session start. */
  ts: number;
  /** Mode at start time (15/25/45/90). Mirrors button label. */
  duration_min: FocusDurationMin;
  /** Actual elapsed time in ms — may be < duration_min*60_000 if stopped early. */
  duration_ms: number;
  /** Optional link to work.projects[].id for freelance billing rollup. */
  project_id?: string;
  /** Optional task link. */
  task_id?: string;
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
  projects?: Project[];
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
  /** Booked future focus blocks (for "deep work tomorrow 10am" cues). */
  scheduled_blocks?: ScheduledFocusBlock[];
  /** Completed focus sessions — drives pomodoro break math. */
  focus_log?: FocusLogEntry[];
  /** Phase 3 · manual distraction-moment log. */
  distraction_log?: DistractionEntry[];
  /** Phase 3 · handoff / collaboration notes. */
  handoff_notes?: HandoffNote[];
}

// ─── Distraction log (Phase 3 · feature 1) ────────────────────────────
// One entry per "I got pulled away" moment captured during a focus
// session. Manual entry only — there is NO braindump feed into this
// slice yet. (See NOTE below: a braindump→distraction route can be
// added after the Phase-1 routing rewrite merges.)
//
// Stored under work.distraction_log.

/** Optional coarse bucket for what pulled the user away. */
export type DistractionCategory =
  | 'notification'
  | 'person'
  | 'thought'
  | 'task_switch'
  | 'physical'
  | 'other';

export interface DistractionEntry {
  /** Stable id (UI-generated). */
  id: string;
  /** ms epoch of when the distraction was logged. */
  ts: number;
  /** Free text — what pulled you away. May be empty. */
  note: string;
  /** Optional coarse category. */
  category?: DistractionCategory;
  /**
   * Optional link to the focus_log entry (its `ts`) the user was inside
   * when distracted. Set by the UI when a session is running.
   */
  focus_session_ts?: number;
}

// NOTE (Phase 3): braindump → distraction routing is intentionally NOT
// wired here. The braindump router (applyRoute / braindump-dispatch) is
// being rewritten by the Phase-1 agent in an isolated worktree. Once
// that merge lands, a 'work' item with an inattention marker can be
// appended to work.distraction_log from the dispatch layer.

// ─── Handoff / collaboration notes (Phase 3 · feature 3) ──────────────
// A note left for a teammate (or future-you) when handing off work.
// Stored under work.handoff_notes.

export interface HandoffNote {
  /** Stable id (UI-generated). */
  id: string;
  /** ms epoch of creation. */
  ts: number;
  /** Note body. */
  text: string;
  /** Optional recipient name — free text, no contact-book link. */
  to?: string;
  /** Optional resolution stamp (ms epoch). When set, UI hides from active list. */
  resolved_at?: number | null;
}

// ─── Scheduled focus blocks ───────────────────────────────────────────
// Booked deep-work sessions in the future. Cue fires 1h prior.

export interface ScheduledFocusBlock {
  id: string;
  /** Planned start (ms epoch). */
  start_at: number;
  /** Mode locked at booking time. */
  duration_min: FocusDurationMin;
  /** Optional project link. */
  project_id?: string;
  /** Optional human label, e.g. "Deep work — Q3 deck". */
  label?: string;
  /** Set when the 1h-prior reminder has been emitted; suppresses re-fire. */
  reminder_1h_fired_at?: number;
  /** Booking timestamp (ms epoch). Optional — back-compat with pre-UI rows. */
  created_at?: number;
  /** Soft-cancel stamp (ms epoch). When set, block is hidden + cues skip it. */
  cancelled_at?: number;
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
