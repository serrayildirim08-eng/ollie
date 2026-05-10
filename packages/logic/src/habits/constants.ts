/**
 * @ollie/logic · habits constants
 *
 * Shared regex patterns and time constants.
 * Mirrors the top of the IIFE in void-app.html ~line 19405.
 */

export const STRESS_RE = /\b(stressed?|burned?\s*out|overwhelm(?:ed|ing)?|crisis|anxious|panic(?:king)?|deadline|exhausted|spiraling)\b/i;
export const SENSORY_RE = /\b(loud|noisy|crowded|too\s*hot|freezing|jet\s*lag|travel(?:ing|led)?|migraine|hangover|sick|fluorescent|bright\s*lights|sensory)\b/i;
export const NEG_SELF_RE = /\b(i'?m\s+(?:\w+\s+){0,2}(?:stupid|lazy|broken|useless|terrible|awful|pathetic|worthless)|hate\s+myself|disappointed\s+in\s+myself|always\s+(?:fail|mess|screw))/i;
export const FRESH_START_RE = /\b(starting\s*over|from\s*monday|new\s*week|new\s*month|this\s*time|fresh\s*start|will\s*start\s*tomorrow|gonna\s*start|reset\s*everything|clean\s*slate)\b/i;
export const TRAIT_RE = /\bi'?m\s+(?:not\s+(?:a|the)\s+\w+|just\s+\w+|always\s+\w+|never\s+\w+|terrible|hopeless|broken)\b/i;
export const ACTION_RE = /\bi\s+(?:tried|sometimes|today|started|did|managed|went|made)\b/i;
export const BODY_HABIT_RE = /\b(walk|stretch|mov|exercise|gym|workout|water|hydrate|drink|breath|cold|stand|sleep|nap|run|yoga)/i;
export const COG_HABIT_RE = /\b(meditat|journal|plan|read|learn|study|reflect|review|writ|note|gratitude)/i;

export const DAY = 86_400_000;
