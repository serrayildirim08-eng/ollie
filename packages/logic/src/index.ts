/**
 * @ollie/logic — pure functional core.
 *
 * No I/O. No DOM. No clock reads inside functions (callers pass `now`).
 * Each sub-namespace mirrors a void module.
 *
 * Currently shipped: cycle, patterns, pets, grocery, finance, habits,
 * sleep, work, goals, body, admin, journal, dissection, brain.
 */

// Shared internal primitives — single source of truth for statistical
// helpers (stats) and small utilities (util): time constants (DAY_MS /
// HOUR_MS / MINUTE_MS), calendar day-keys (dayKey local + dayKeyUTC) and
// the capped Levenshtein edit distance. Every duplicate site across the
// package imports from these two modules.
export * as stats from './stats';
export * as util from './util';

export * as cycle from './cycle';
export * as patterns from './patterns';
export * as finance from './finance';
export * as pets from './pets';
export * as admin from './admin';
export * as work from './work';
export * as grocery from './grocery';
export * as sleep from './sleep';
export * as body from './body';
export * as goals from './goals';
export * as habits from './habits';
export * as journal from './journal';
export * as dissection from './dissection';
export * as brain from './brain';
