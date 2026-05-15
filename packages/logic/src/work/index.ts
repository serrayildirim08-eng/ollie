/**
 * @ollie/logic · work
 *
 * ADHD-aware work pattern detectors.
 * Every function is pure: inputs → outputs, no storage reads,
 * no event emits, no wall-clock reads (time is always a parameter).
 *
 * Mirrors void-app.html VOID.logic.work IIFE (~lines 18423–19404).
 */

export * from './types';
export { DAY, HOUR, DEADLINE_CUE_OFFSETS_DAYS, DEADLINE_RE, TRIAGE_RE, FEEDBACK_RE } from './constants';
export { dayKey, fmtBlockLabel, ordinal, isTriageActive } from './helpers';
export { detectDeepFocusHours, detectPacingBreach } from './legacy';
export {
  detectTaskSwitchTax,   // W1
  detectMeetingCliff,    // W2
  scheduleDeadlineCues,  // W4
  detectShutdownGap,     // W12
  buildShutdownPrompt,   // W12
  buildTriageAnchor,     // W17
} from './phase1';
export {
  detectActivationBarrier,      // W5
  detectEstimationDrift,        // W6
  detectPostMeetingBuffer,      // W9
  detectOneMoreThingSpiral,     // W11
  buildCrashPrompt,             // W3
  detectHyperfocusCrashPattern, // W3
} from './phase2';
export {
  detectTabSprawl,              // W7
  detectNotificationTax,        // W8
  detectRecurringMeetingDeads,  // W10
  buildCancelDraft,             // W10
  detectMultitaskIllusion,      // W13
  matchRSDTitle,                // W14
  detectRSDPattern,             // W14
} from './phase3';
export { detectPatterns } from './patterns';

// Phase 3 — pomodoro break tracking (feature 2)
export {
  computePomodoroBreakState,
  DEFAULT_BLOCKS_PER_LONG_BREAK,
  COMPLETION_RATIO,
} from './pomodoro';
export type {
  PomodoroBreakState,
  PomodoroBreakOptions,
} from './pomodoro';
