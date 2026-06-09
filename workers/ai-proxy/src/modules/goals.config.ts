/**
 * goals.config.ts — Module-specific config for `/route/goals` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the goals module
 * with a chosen action. Layer 2 = goals-specific AI that takes the raw
 * fragment and resolves the specific action + payload. Port of sleep/admin
 * pattern (same ModuleConfig, same tier ladder, same trilingual few-shot
 * convention).
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same pair as sleep/admin (commits 0b098e1 + a81567a).
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the goals block in src/router/dump-classify.ts (~line 172):
 *   - progress_note  — { note: REQUIRED, goalName? }
 *   - create_goal    — { what: REQUIRED, why? }
 *   - milestone_hit  — { milestone: REQUIRED, goalName? }
 *   - obstacle_note  — { obstacle: REQUIRED, goalName? }
 *
 * Key disambiguation (encoded firmly — Layer 1 already misclassified some):
 *   milestone_hit vs progress_note: milestone = NAMED quantifiable one-time
 *   achievement someone would celebrate ("hit 10k followers", "ran first 5k",
 *   "shipped auth flow"). progress_note = generic update without a named
 *   achievement ("made progress", "wrote more", "got further"). When unsure,
 *   prefer progress_note (less destructive claim).
 *   create_goal vs progress_note: create_goal = FUTURE-LOOKING with modal
 *   verbs ("want to", "going to", "would like to"). progress_note = past/current.
 *   obstacle_note: explicit blocker on a goal. Not generic frustration.
 *
 * No cross-route mirror — goals is standalone.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type GoalsAction =
  | 'progress_note'
  | 'create_goal'
  | 'milestone_hit'
  | 'obstacle_note';

export interface GoalsClassification {
  action: GoalsAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear "want to
 * run a marathon" / "hit 10k followers" style fragments). When the model
 * returns confidence < ESCALATE_THRESHOLD we re-call with the accurate tier
 * (GPT-OSS 120B — has Groq prompt caching). Same pair as sleep/admin, same
 * threshold, same reasoning.
 */
export const GOALS_MODEL_FAST = 'llama-3.1-8b-instant';
export const GOALS_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const GOALS_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (8 = 2 per action × 4 actions) ─────────────
// Distribution: EN×3 + ES×3 + TR×2. Natural everyday phrases the user
// actually types into the dump box.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: GoalsClassification }> = [
  // progress_note — EN
  {
    input: 'made some progress on the book',
    output: {
      action: 'progress_note',
      payload: { note: 'made some progress', goalName: 'book' },
      confidence: 0.94,
      language: 'en',
    },
  },
  // progress_note — TR
  {
    input: 'kitabın 3. bölümünü bitirdim',
    output: {
      action: 'progress_note',
      payload: { note: 'kitabın 3. bölümünü bitirdim', goalName: 'kitap' },
      confidence: 0.93,
      language: 'tr',
    },
  },
  // create_goal — EN
  {
    input: 'want to run a half marathon',
    output: {
      action: 'create_goal',
      payload: { what: 'run a half marathon' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // create_goal — ES
  {
    input: 'quiero correr una media maratón',
    output: {
      action: 'create_goal',
      payload: { what: 'correr una media maratón' },
      confidence: 0.96,
      language: 'es',
    },
  },
  // milestone_hit — EN
  {
    input: 'hit 10k followers',
    output: {
      action: 'milestone_hit',
      payload: { milestone: '10k followers' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // milestone_hit — TR
  {
    input: '10 bin takipçiye ulaştım',
    output: {
      action: 'milestone_hit',
      payload: { milestone: '10 bin takipçi', goalName: 'takipçi' },
      confidence: 0.96,
      language: 'tr',
    },
  },
  // obstacle_note — EN
  {
    input: 'knee is acting up, blocking running',
    output: {
      action: 'obstacle_note',
      payload: { obstacle: 'knee pain', goalName: 'running' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // obstacle_note — ES
  {
    input: 'la rodilla me está bloqueando',
    output: {
      action: 'obstacle_note',
      payload: { obstacle: 'rodilla', goalName: 'correr' },
      confidence: 0.94,
      language: 'es',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's goals-module Layer 2 AI. The user dumped a fragment that has already been routed to the goals module. Pick the most specific goals action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- progress_note: generic progress, partial work, or an update without a named celebrated achievement. payload: { note (REQUIRED — the progress description, preserve user's wording), goalName? (string — the goal being worked on, if identifiable) }
    Triggers: "made some progress on the book", "got further with the deck", "wrote 500 words today", "kitabın bölümünü bitirdim", "avancé con el proyecto".
    Use when the fragment is a general update — even if it sounds significant, it must be a NAMED quantifiable one-time achievement to qualify as milestone_hit.
    When unsure between progress_note and milestone_hit, prefer progress_note (it is the less destructive claim).
- create_goal: setting a NEW goal the user intends to pursue FUTURE. payload: { what (REQUIRED — the goal itself, strip modal verbs: "want to run a half marathon" → what: "run a half marathon"), why? (string — reason stated, if any) }
    Triggers: future-oriented modal verbs — "want to", "going to", "would like to", "I'm going to", "quiero", "quisiera", "istiyorum", "koşmak istiyorum".
    "want to run a marathon" → create_goal. "ran 5k today" → progress_note or milestone_hit (past action, not future).
- milestone_hit: a NAMED quantifiable one-time achievement someone would celebrate. payload: { milestone (REQUIRED — the achievement itself, e.g. "10k followers", "ran first 5k", "finished chapter 3"), goalName? (string — the broader goal, if identifiable) }
    Triggers: "hit X", "reached X", "finished X", "shipped X", "completed X", "ran my first X", "ulaştım", "bitirdim", "llegué a", "terminé".
    MUST be concrete and countable ("hit 10k followers") or a named deliverable shipped once ("shipped the auth flow", "finished chapter 3").
    "wrote more of the auth flow" → NOT milestone_hit → progress_note. "shipped the auth flow" → milestone_hit (named deliverable, one-time ship).
    "made some progress on the book" → NOT milestone_hit → progress_note. "finished chapter 3 of the book" → could be either — if a numbered/named chapter, milestone_hit; if vague, progress_note.
- obstacle_note: an EXPLICIT blocker on a goal — something preventing progress on a specific goal. payload: { obstacle (REQUIRED — the blocker itself, lowercased concise noun phrase), goalName? (string — the goal being blocked, if identifiable) }
    Triggers: "knee is acting up, blocking running", "out of time for the side project", "diz problemim koşmayı engelliyor", "la rodilla me está bloqueando".
    Must be an explicit causal blocker ("blocking", "preventing", "engelliyor", "me bloquea"). Generic frustration without a goal-link → NOT obstacle_note ("today sucks" → not goals at all).

DISAMBIGUATION:
- milestone_hit vs progress_note: milestone requires a NAMED quantifiable one-time achievement. "shipped the auth flow" → milestone_hit (named deliverable shipped, one-time). "wrote more of the auth flow" → progress_note (ongoing, not one-time). Borderline cases → prefer progress_note.
- create_goal vs progress_note: future modal verbs ("want to", "going to", "quiero", "istiyorum") → create_goal. Past or present tense → progress_note or milestone_hit.
- obstacle_note: must have an explicit blocker framing. "knee is acting up" alone (no goal link) → progress_note with low confidence. "knee is acting up, blocking running" → obstacle_note.
- "want to run a marathon" → create_goal (NOT progress_note). "ran a marathon" → milestone_hit.
- "llegué a 10k seguidores" → milestone_hit. "estoy trabajando en el proyecto" → progress_note.
- "yarım maraton koşmak istiyorum" → create_goal. "diz problemim koşmayı engelliyor" → obstacle_note.

OUTPUT — respond ONLY with the classify_goals_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_goals_action',
    description: 'Resolve the specific goals action + payload for a fragment already routed to the goals module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'progress_note',
            'create_goal',
            'milestone_hit',
            'obstacle_note',
          ],
        },
        confidence: {
          type: 'number',
          description: 'Self-reported confidence 0-1. Values below 0.7 trigger model escalation.',
        },
        language: {
          type: 'string',
          enum: ['en', 'es', 'tr', 'other'],
        },
        payload: {
          type: 'object',
          description: 'Action-specific fields. See action enum for the per-action shape.',
          properties: {
            // progress_note + obstacle_note + milestone_hit share goalName
            goalName: { type: 'string' },
            // progress_note
            note: { type: 'string' },
            // create_goal
            what: { type: 'string' },
            why: { type: 'string' },
            // milestone_hit
            milestone: { type: 'string' },
            // obstacle_note
            obstacle: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const goalsConfig: ModuleConfig<GoalsClassification, undefined> = {
  moduleName: 'goals',
  canonicalItems: [], // goals has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
