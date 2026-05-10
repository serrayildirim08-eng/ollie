/**
 * @ollie/logic · pets
 *
 * Species-adaptive keeper's-notebook logic.
 * Every function is pure: inputs → outputs, no storage reads,
 * no event emits, no wall-clock reads (time is always a parameter).
 *
 * Spec: CLAUDE_CODE_PETS_PROMPT v1 + research/pets-module-research-2026-05-07.md
 */

export * from './types';
export { SPECIES_PROFILES, SPECIES_LIST, SPECIES_VOCAB } from './species-profiles';
export {
  TASK_DISPLAY,
  VET_CUE_OFFSETS_DAYS,
  PREFACES,
  DEFAULT_EVENT_SUGGESTIONS,
  PROJECTION_RE,
} from './constants';
export { computeCareGaps, computeTrustLevel, summarize } from './care-gaps';
export { detectHealthFlags } from './health-flags';
export { generateGuiltTripCopy } from './guilt-copy';
export { todayForecast, pickVocabTerm, pickPreface, isAdoptversary } from './today-forecast';
export {
  parsePetMention,
  parseAwayIntent,
  parseSessionIntent,
  detectMilestone,
  computeWeatherAlerts,
} from './intents';
export {
  scheduleVetCues,
  detectVetAdherenceDelay,
  detectCoRegulator,
  detectCareActivationBarrier,
  detectCrashContextMisses,
  matchProjectionInDump,
  detectProjectionPattern,
  detectPatterns,
} from './patterns';
