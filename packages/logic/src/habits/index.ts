/**
 * @ollie/logic · habits
 *
 * ADHD-aware habit pattern detectors.
 * Every function is pure: inputs → outputs, no storage reads,
 * no event emits, no wall-clock reads (time is always a parameter).
 *
 * Mirrors void-app.html VOID.logic.habits IIFE (~lines 19404–21485).
 */

export * from './types';
export { DAY, STRESS_RE, SENSORY_RE, NEG_SELF_RE, FRESH_START_RE, BODY_HABIT_RE, COG_HABIT_RE } from './constants';
export { dayKey, dayKeyUTC, mean, completionsInWindow, buildDayCompletionMap } from './helpers';

// ─── Tier-0 private-shape detectors ──────────────────────────────────
export {
  detectExternalizationGap,
  detectLutealCollapseLegacy,
  detectStressCollapseLegacy,
  detectSensoryFlag,
  detectInterestHijackLegacy,
  detectFreshStartCrashLegacy,
  detectIdentityTraitFramingLegacy,
  detectBodyVsCognitiveLegacy,
  detectHabitDriftLegacy,
  detectFrictionSignatureLegacy,
  detectSleepHabitCouplingLegacy,
  detectHabitRebirthLegacy,
  detectSelfTalkCouplingLegacy,
} from './detectors-tier0';

// ─── Tier-1 public-signal detectors ──────────────────────────────────
export {
  detectExternalizationRequirement,
  detectLutealCollapse,
  detectSensoryPreflight,
  detectInterestHijack,
  detectStressCollapse,
} from './detectors-tier1';

// ─── Phase-2 public detectors ─────────────────────────────────────────
export {
  detectFreshStartCrash,
  detectIdentityFraming,
  detectBodyVsCognitive,
  detectHabitDrift,
  detectFrictionSignature,
  detectSleepHabitCoupling,
  detectHabitRebirth,
  detectSelfTalkHabit,
} from './detectors-phase2';

// ─── Cross-module detectors ───────────────────────────────────────────
export {
  detectHyperfocusSpillover,
  detectKeystoneAnchor,
  detectMedAdherenceCoupling,
} from './detectors-cross-module';

// ─── Batch runner ─────────────────────────────────────────────────────
export { detectPatterns } from './patterns';
