/**
 * @ollie/logic — pure functional core.
 *
 * No I/O. No DOM. No clock reads inside functions (callers pass `now`).
 * Each sub-namespace mirrors a void module.
 *
 * Currently shipped: cycle. Others (pets, grocery, finance, habits, sleep,
 * work, goals, body, admin) land in follow-up phases.
 */

export * as cycle from './cycle';
