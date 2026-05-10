/**
 * @ollie/logic — pure functional core.
 *
 * No I/O. No DOM. No clock reads inside functions (callers pass `now`).
 * Each sub-namespace mirrors a void module.
 *
 * Currently shipped: cycle, products, corrections, ritual, patterns,
 * prompts, consumption.
 * Others (pets, grocery, finance, habits, sleep, work, goals, body, admin,
 * astrology, dump, journal, dissection, predict) land in follow-up phases.
 */

export * as cycle from './cycle';
export * as products from './products';
export * as corrections from './corrections';
export * as ritual from './ritual';
export * as patterns from './patterns';
export * as prompts from './prompts';
export * as consumption from './consumption';
export * as finance from './finance';
export * as pets from './pets';
