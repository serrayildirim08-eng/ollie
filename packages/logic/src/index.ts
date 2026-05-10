/**
 * @ollie/logic — pure functional core.
 *
 * No I/O. No DOM. No clock reads inside functions (callers pass `now`).
 * Each sub-namespace mirrors a void module.
 *
 * Currently shipped: cycle, products.
 * Others (pets, grocery, finance, habits, sleep, work, goals, body, admin,
 * astrology, dump) land in follow-up phases.
 */

export * as cycle from './cycle';
export * as products from './products';
