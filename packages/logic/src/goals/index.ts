/**
 * @ollie/logic · goals
 *
 * ADHD-aware goal pattern detectors.
 * Every function is pure: inputs → outputs, no storage reads,
 * no event emits, no wall-clock reads (time is always a parameter).
 *
 * Mirrors void-app.html VOID.logic.goals IIFE (~lines 22484–23692).
 *
 * Consent gate: opts.consent (boolean) is injected by callers.
 * Defaults to true when absent — mirrors void-app.html _consentOnGoals fallback.
 */

export * from './types';
export { STOP, tokens, resolveNow, wrap, goalLabel } from './helpers';
export { LOW_MOOD_RE, RESEARCH_RE, DOING_RE, IDENTITY_RE, EXTERNAL_TRIGGER_RE, ANTI_GOAL_RE } from './lexicons';
export { SOURCES } from './sources';

// Phase 1 — G4, G6, G7, G15
export {
  detectLowMood,          // G4
  detectObstacleEcho,     // G6
  detectPreMortemEcho,    // G7
  retrieveUlyssesContract, // G15
  getUlyssesText,          // G15 helper
} from './phase1';

// Phase 2 — G2, G5, G11, G13, G14
export {
  detectActiveCap,           // G2
  detectResearchAsProgress,  // G5
  detectIdentityDrift,       // G11
  detectSunkCostFlag,        // G13
  classifyPacing,            // G14
  detectPacingBreach,        // G14
} from './phase2';

// Phase 3 — G1, G3, G8, G9, G10, G12, G16
export {
  detectContagion,           // G1
  isIncubating,              // G1 helper
  classifyAnchor,            // G3
  detectMissingAnchorPair,   // G3
  detectFloatingGoal,        // G8
  detectMissingConstrual,    // G9
  construalFrameForState,    // G9 helper
  detectAntiGoalOpportunity, // G10
  detectAntiGoalInDump,      // G10
  detectGoalInterference,    // G12
  detectExperimentCandidate, // G16
} from './phase3';
