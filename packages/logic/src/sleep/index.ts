/**
 * @ollie/logic · sleep
 *
 * ADHD-aware sleep pattern logic.
 * Every function is pure: inputs → outputs, no storage reads,
 * no event emits, no wall-clock reads (time is always a parameter).
 *
 * Mirrors void-app.html VOID.logic.sleep IIFE (~lines 14656–16861).
 */

export * from './types';
export { QUALITY_MAP, DEFAULT_TOKENS, CHRONO_BANDS, RUMINATIVE_LEXICON, OVERWHELMED_LEXICON, CAFFEINE_RE, STIMULANT_RE } from './constants';
export { parseTimeOfDay, bedtimeRelativeMinutes, minutesInBed, formatTime, isoDate, bedtimeEpochFor } from './helpers';
export { parseSleepDump, mergeRecord, sleepEfficiency, resolveTarget } from './parse';
export {
  deriveSleepStats,
  computeSleepDebt,
  detectBedtimeDrift,
  estimateChronotype,
  computeSocialJetlag,
  correlateSleepWith,
  detectDSPSPattern,
  detectShortSleepRun,
  forecastTonightTST,
} from './stats';
export {
  // Phase 1
  detectRevengeBedtime,
  detectCaffeineCutoff,
  detectSleepOnsetGap,
  detectWeekendRecoveryIllusion,
  detectBedtimeMindRacing,
  // Phase 2
  detectWindDownFriction,
  detectMedicationTimingDrift,
  detectChronotherapyProgress,
  // Phase 3
  detectSleepCyclePattern,
  detectSleepFocusPattern,
  detectSleepDumpMoodPattern,
  // Phase 4
  detectCyclePhaseSleepCoupling,
  detectStimulantSleepDebt,
} from './patterns';
