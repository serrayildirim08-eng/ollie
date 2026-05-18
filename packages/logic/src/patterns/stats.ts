/**
 * @ollie/logic/patterns · stats
 *
 * Re-exports the canonical statistical primitives from `../stats`. The
 * Spearman / BH-FDR / bootstrap implementations that used to live here are
 * now shared with every other module via `../stats` (single source of
 * truth).
 */

export {
  mean,
  sampleSd,
  mulberry32,
  ranks,
  spearman,
  bhAdjust,
  bootstrapCI,
} from '../stats';
