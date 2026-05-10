/**
 * @ollie/logic · journal
 *
 * Pure functions for the journal module.
 * Mirrors void-app.html VOID.logic.journal IIFE (~lines 14059–14647).
 *
 * No I/O. No DOM. No wall-clock reads (callers pass `now`).
 */

export * from './types';
export { EXTRACTION_SYSTEM_PROMPT, extractionPromptFor } from './prompt';
export {
  segment,
  extractRuleBased,
  stripCodeFence,
  snapToWordBoundaries,
  filterInSpan,
  mergeOverlappingEntries,
  validateEntry,
} from './extract';
export { tokenize, levenshtein1, searchEntries } from './search';
export {
  resurface,
  resurfaceAnniversaries,
  resurfacePhaseAnniversaries,
  resurfaceSemanticEchoes,
  resurfaceFilterRecency,
  resurfaceMMR,
} from './resurface';
