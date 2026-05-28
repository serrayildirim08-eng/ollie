/**
 * Goals module · barrel.
 */

export { goalsHandler } from './handler';
export { migrateGoals } from './migrate';
export { goals, events } from './repo';
export { GoalsBox } from './GoalsBox';
export type { Goal, GoalEvent, GoalEventKind, GoalWithLatest } from './types';
