/**
 * @ollie/logic · cycle stats helpers
 *
 * Re-exports the canonical statistical primitives from `../stats`. The
 * previous local copies are gone — `../stats` is the single source of
 * truth (and carries the even-length median fix).
 */

export { sum, mean, variance, sampleSd, median } from '../stats';
