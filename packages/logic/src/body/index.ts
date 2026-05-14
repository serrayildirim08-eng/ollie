/**
 * @ollie/logic · body namespace
 *
 * Pure functional logic for the body module.
 * No I/O. No DOM. No wall-clock reads inside functions (callers pass `now`).
 */

export * from './types';
export * from './regexes';
export * from './math';
export * from './patterns';
export * from './episodes';
export * from './pacing';
export * from './treatments';
export * from './caffeine-sleep';
export {
  correlateLutealAndSpending,
} from './correlations/luteal-spending';
export type {
  LutealSpendingResult,
  CorrelateLutealSpendingOpts,
} from './correlations/luteal-spending';
export {
  correlateWorkoutSkipAndMood,
} from './correlations/workout-skip-mood';
export type {
  WorkoutSkipMoodResult,
  CorrelateWorkoutSkipMoodOpts,
} from './correlations/workout-skip-mood';
export {
  correlateWaterAndFocus,
} from './correlations/water-focus';
export type {
  WaterFocusResult,
  CorrelateWaterFocusOpts,
} from './correlations/water-focus';
export {
  correlateSleepDebtAndHabits,
} from './correlations/sleep-debt-habits';
export type {
  SleepDebtHabitsResult,
  CorrelateSleepDebtHabitsOpts,
} from './correlations/sleep-debt-habits';
export {
  correlateEveningMatchaAndSleep,
} from './correlations/evening-matcha-sleep';
export type {
  EveningMatchaSleepResult,
  CorrelateEveningMatchaOpts,
} from './correlations/evening-matcha-sleep';
export {
  CORRELATION_REGISTRY,
  runAllCorrelations,
  takeUserDataSnapshot,
} from './correlations';
export type {
  CorrelationName,
  CorrelationEntry,
  UserDataSnapshot,
  CorrelationRunResult,
  SnapshotStoreLike,
} from './correlations';
