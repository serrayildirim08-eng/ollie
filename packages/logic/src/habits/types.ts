/**
 * @ollie/logic · habits types
 *
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Input shapes ─────────────────────────────────────────────────────

export interface HabitCompletion {
  ts: number;
  habit_id?: string;
}

export interface Habit {
  id: string;
  name?: string;
  label?: string;
  category?: string;
  cue?: string;
  location?: string;
  after_action?: string;
  visible_cue?: string;
  created_at?: number;
  completions?: HabitCompletion[];
}

export interface DumpEntry {
  ts: number;
  rawText?: string;
  text?: string;
}

export interface CyclePhaseRange {
  start: number;
  end: number;
  name: string;
}

export interface CyclePhaseMarker {
  ts: number;
  phase: string;
}

export type CyclePhase = CyclePhaseRange | CyclePhaseMarker;

export interface SleepRecord {
  ts?: number;
  night_of?: string;
  tst_min?: number;
  hours?: number;
  is_skipped?: boolean;
}

export interface GoalEntry {
  created_at?: number;
  title?: string;
}

export interface WorkCrashEntry {
  session_at?: number;
  ts?: number;
  reply?: string;
}

export interface HabitsHistory {
  now?: number;
  habits?: Habit[];
  completions?: HabitCompletion[];
  dumps?: DumpEntry[];
  cyclePhases?: CyclePhase[];
  sleepRecords?: SleepRecord[];
  goals?: GoalEntry[];
  workCrashLog?: WorkCrashEntry[];
}

export interface HabitsOpts {
  now?: number;
  windowDays?: number;
  minHabitsPerSide?: number;
  minRatioGap?: number;
  minCompletions?: number;
  maxRatio?: number;
  minLutealDays?: number;
  minOtherDays?: number;
  minDropRatio?: number;
  minLutealWindows?: number;
  minStressDays?: number;
  minClusters?: number;
  minLift?: number;
  recentDays?: number;
  baselineDays?: number;
  goalLookback?: number;
  novelLookback?: number;
  minHabitsCollapsed?: number;
  minNovelMentions?: number;
  stressLookbackDays?: number;
  sleepLookbackNights?: number;
  minDeadlineMentions?: number;
  maxAvgTstMin?: number;
  minBoundaryCreates?: number;
  minSilentAfter?: number;
  earlyDays?: number;
  silenceDays?: number;
  minDisavowal?: number;
  minPerSide?: number;
  minCompletionsPerHabit?: number;
  halfDays?: number;
  minExpected?: number;
  minWeeks?: number;
  minRatio?: number;
  minDiff?: number;
  minLowSleepN?: number;
  minNormalN?: number;
  lowTstMin?: number;
  minGapDays?: number;
  /** #139: a rebirth gap must be ≥ this multiple of the habit's median cadence. */
  restartGapMultiple?: number;
  reentryDays?: number;
  minRebirths?: number;
  followDays?: number;
  minEvents?: number;
  minHabits?: number;
  minRestarts?: number;
  minSpread?: number;
  minShortNights?: number;
  minDropPct?: number;
  shortHoursThreshold?: number;
  minNegDays?: number;
  minCrashes?: number;
  minOverlap?: number;
  minBaselineRate?: number;
  minMedDays?: number;
  minBaselineDays?: number;
  // legacy private opts
  collapseThreshold?: number;
  requireRatio?: number;
  minTotal?: number;
  minGapPct?: number;
  minMentions?: number;
  minSensoryDays?: number;
}

// ─── Pattern / signal output ───────────────────────────────────────────

export interface PatternSource {
  citation: string;
  url?: string;
}

/** Old-shape pattern (private tier-0 detectors) */
export interface LegacyPattern {
  pattern: string;
  confidence: 'high' | 'medium' | 'low';
  sample_n: number;
  copy: string;
  copy_es: string;
  source?: PatternSource;
  // optional extras depending on detector
  [key: string]: unknown;
}

/** New-shape signal (tier-1+ public detectors) */
export interface HabitSignal {
  signal: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  copy: string;
  copy_es: string;
  sources?: PatternSource[];
  ts?: number;
  // optional payload fields
  drop_percent?: number;
  habits_affected?: number;
  rebirths_n?: number;
  habit_id?: string;
  recent_rate?: number;
  prior_rate?: number;
  drop_pct?: number;
  worst_day?: string;
  best_day?: string;
  worst_rate?: number;
  best_rate?: number;
  [key: string]: unknown;
}

export type AnyHabitsResult = LegacyPattern | HabitSignal | AnyHabitsResult[];
