/**
 * @ollie/logic — pure functional core.
 *
 * No I/O. No DOM. No clock reads inside functions (callers pass `now`).
 * Each sub-namespace mirrors a void module.
 *
 * Currently shipped: cycle, products, corrections, ritual.
 * Others (pets, grocery, finance, habits, sleep, work, goals, body, admin,
 * astrology, dump, journal, patterns, prompts, dissection) land in
 * follow-up phases.
 */

export * as cycle from './cycle';
export * as products from './products';
export * as corrections from './corrections';
export * as ritual from './ritual';
