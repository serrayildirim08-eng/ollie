/**
 * @ollie/logic · grocery public API
 *
 * All functions are pure: no wall-clock reads, no store access, no DOM.
 * `now` is always an explicit millisecond timestamp.
 */

export * from './types';
export { ALIAS_TABLE, RECIPE_TABLE, SORTED_ALIASES, SORTED_RECIPE_ALIASES } from './data';
export {
  INTENT_VERBS,
  STRIP_VERBS_RE,
  foldDiacritics,
  stripPlural,
  lev,
  normalizeItemName,
  parseGroceryItem,
} from './parse';
export {
  detectDuplicate,
  detectExpirationDrift,
  detectReplenishNeeded,
  detectStockoutCascade,
  detectStaleListItems,
  detectShoppingCadence,
  detectPatterns,
} from './patterns';
export { inferRecipe } from './recipes';
export { learnKnownStore } from './store';
export { detectInterestCapture } from './interest-capture';
export type { InterestCaptureSignal } from './interest-capture';
