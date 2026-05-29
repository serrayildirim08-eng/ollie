/**
 * pets.config.ts — Module-specific config for `/route/pets` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the pets module
 * with a chosen action. Layer 2 = pets-specific AI that takes the raw
 * fragment + (optional) Layer 1 hint and resolves the specific action +
 * payload. Mirrors the habits/sleep Layer 2 shape — same ModuleConfig,
 * same tier ladder, same trilingual few-shot convention.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same pair as sleep/body/medication/habits.
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the pets block in src/router/dump-classify.ts (~line 112):
 *   - log_care        — { what: REQUIRED, petName? }
 *   - log_observation — { note: REQUIRED, petName? }
 *   - log_vet         — { reason?, petName? }
 *   - log_feed        — { petName? }
 *   - log_supplement  — { supplement: REQUIRED (typed enum), dose?, petName? }
 *
 * CRITICAL petName discipline (Layer 1 SYSTEM_PROMPT ~line 113):
 *   petName is ALWAYS the proper noun / actual pet name (Tontin, Olivia,
 *   Pinpon, Buddy). NEVER the species (cat/dog/guineapig/bunny).
 *   "i fed my guineapig tontin" → petName="tontin", NOT "guineapig".
 *   "fed the cat" (species only, no name given) → omit petName entirely.
 *   This Layer 2 prompt reinforces this rule strongly with defensive
 *   few-shots that show the exact failure mode.
 *
 * Few-shots: 10 = 2 per action × 5 actions, distributed EN/ES/TR (4+3+3).
 *
 * supplement typed enum (not exhaustive, model can add more):
 *   vitamin_c / vitamin_d / vitamin_e / calcium / probiotic / omega3 / etc.
 *   Few-shots show the typed underscore form, not the raw user wording.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type PetsAction =
  | 'log_care'
  | 'log_observation'
  | 'log_vet'
  | 'log_feed'
  | 'log_supplement';

export interface PetsClassification {
  action: PetsAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear
 * "fed tontin" style fragments). When the model returns confidence <
 * ESCALATE_THRESHOLD we re-call with the accurate tier (GPT-OSS 120B —
 * has Groq prompt caching). Same pair and threshold as sleep/body/habits.
 */
export const PETS_MODEL_FAST = 'llama-3.1-8b-instant';
export const PETS_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const PETS_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (10 = 2 per action, EN/ES/TR mix) ──────────
// petName discipline is critical — include explicit failure-mode examples.
// EN: 4 shots, ES: 3 shots, TR: 3 shots.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: PetsClassification }> = [
  // log_care — EN (active action, proper name extracted)
  {
    input: 'brushed tontin',
    output: {
      action: 'log_care',
      payload: { what: 'brushed', petName: 'tontin' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_care — TR (bath; "banyo" = bath; petName is proper noun "pinpon", not species)
  {
    input: "pinpon'u banyo yaptım",
    output: {
      action: 'log_care',
      payload: { what: 'bath', petName: 'pinpon' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // log_observation — EN (passive notice; proper noun extracted)
  {
    input: 'tontin seems lethargic today',
    output: {
      action: 'log_observation',
      payload: { note: 'seems lethargic today', petName: 'tontin' },
      confidence: 0.94,
      language: 'en',
    },
  },
  // log_observation — ES (passive notice; species only → no petName)
  {
    input: 'el gato está comiendo menos',
    output: {
      action: 'log_observation',
      payload: { note: 'está comiendo menos' },
      confidence: 0.92,
      language: 'es',
    },
  },
  // log_vet — EN (vet visit implied)
  {
    input: 'vet for pinpon checkup',
    output: {
      action: 'log_vet',
      payload: { reason: 'checkup', petName: 'pinpon' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_vet — TR (vet visit; species "guinea pig" given → petName omitted)
  {
    input: 'guinea pigu veterinere götürdüm kontrol için',
    output: {
      action: 'log_vet',
      payload: { reason: 'kontrol' },
      confidence: 0.93,
      language: 'tr',
    },
  },
  // log_feed — EN (proper noun extracted; "guineapig" is species, "tontin" is name)
  {
    input: 'i fed my guineapig tontin',
    output: {
      action: 'log_feed',
      payload: { petName: 'tontin' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // log_feed — ES (species only "el perro" → no petName)
  {
    input: 'di de comer al perro',
    output: {
      action: 'log_feed',
      payload: {},
      confidence: 0.96,
      language: 'es',
    },
  },
  // log_supplement — EN (typed underscore form, proper noun)
  {
    input: 'gave tontin vitamin c',
    output: {
      action: 'log_supplement',
      payload: { supplement: 'vitamin_c', petName: 'tontin' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_supplement — TR (typed form; proper noun extracted)
  {
    input: 'pinpon calcium aldı',
    output: {
      action: 'log_supplement',
      payload: { supplement: 'calcium', petName: 'pinpon' },
      confidence: 0.94,
      language: 'tr',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's pets-module Layer 2 AI. The user dumped a fragment that has already been routed to the pets module. Pick the most specific pets action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

══════════════════════════════════════
CRITICAL RULE — petName discipline:
petName is ALWAYS the PROPER NOUN / actual pet name (Tontin, Olivia, Pinpon, Buddy, Max).
petName is NEVER the SPECIES (cat, dog, guineapig, bunny, rabbit, bird, fish).

  "i fed my guineapig tontin" → petName: "tontin"   ← "guineapig" is species, IGNORE IT
  "fed the cat"               → NO petName            ← only species mentioned, omit
  "brushed tontin"            → petName: "tontin"
  "pinpon'u banyo yaptım"     → petName: "pinpon"
  "noticed the rabbit limping" → NO petName           ← only species, omit

If the user mentions BOTH a species and a proper name, extract ONLY the proper name.
If only a species is mentioned with no proper name, omit petName entirely.
══════════════════════════════════════

ACTIONS (pick exactly one):
- log_care: user performed an active care task for a pet (grooming, bathing, training, play, nail trim, etc.). payload: { what (REQUIRED — the care action in English, e.g. "brushed", "bath", "nail trim", "play"), petName? (proper noun only — see rule above) }
    Triggers: "brushed X", "gave X a bath", "played with X", "trained X", "banyo yaptım", "fırçaladım".
    what should be a short English label ("brushed", "bath", "nail trim") not the full sentence.
- log_observation: user passively noticed something about a pet (behavior, appearance, health sign) — NOT a vet visit, NOT an active care task. payload: { note (REQUIRED — the observation, preserve user's wording but strip the pet name from the note; the petName field carries the name), petName? }
    Triggers: "seems lethargic", "not eating", "noticed a lump", "has a limp", "gözü kızarmış", "está comiendo menos".
    Disambiguation from log_vet: log_observation = user noticed something at home. log_vet = there was or will be a vet visit.
    Disambiguation from log_care: log_observation = passive notice. log_care = user actively DID something.
- log_vet: a vet visit happened or is planned. payload: { reason? (brief reason for visit, in English), petName? }
    Triggers: "vet for X", "took X to the vet", "X has a vet appointment", "veterinere götürdüm".
    IMPORTANT: "noticed X has a limp" → log_observation (home observation). "took X to vet for limp" → log_vet.
- log_feed: user fed a pet. payload: { petName? }
    Triggers: "fed X", "gave X food", "X yedirdi", "di de comer a X".
    Note: "i fed my guineapig tontin" → petName: "tontin" (NOT "guineapig"). "fed the cat" → no petName.
- log_supplement: user gave a pet a supplement or vitamin. payload: { supplement (REQUIRED — typed form: vitamin_c / vitamin_d / vitamin_e / calcium / probiotic / omega3 / iron / zinc / biotin — use underscores, lowercase; if supplement doesn't match a known type, use the closest label or a new snake_case term), dose? (preserve user's units e.g. "250mg", "1 tablet"), petName? }
    Triggers: "gave X vitamin C", "X calcium aldı", "omega 3 verdim", "probiyotik yedirdi".
    IMPORTANT: supplement value must be the typed snake_case label ("vitamin_c"), not the user's raw wording ("vitamin C" or "vitaminC").

DISAMBIGUATION:
- "brushed tontin" → log_care (what="brushed", petName="tontin"). Active act.
- "tontin seems lethargic" → log_observation (note="seems lethargic", petName="tontin"). Passive notice.
- "vet for pinpon checkup" → log_vet (reason="checkup", petName="pinpon"). Vet visit.
- "noticed pinpon has a limp" → log_observation. Passive home notice, no vet mentioned.
- "took olivia to vet for limp" → log_vet (reason="limp", petName="olivia").
- "i fed my guineapig tontin" → log_feed (petName="tontin"). Species word "guineapig" NEVER goes in petName.
- "fed the cat" → log_feed, NO petName. Only species, no proper name.
- "gave tontin vitamin c" → log_supplement (supplement="vitamin_c", petName="tontin").
- "pinpon calcium aldı" → log_supplement (supplement="calcium", petName="pinpon").
- "pinpon'u banyo yaptım" → log_care (what="bath", petName="pinpon"). "banyo" = bath.

OUTPUT — respond ONLY with the classify_pets_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous (unclear action, unclear petName), return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_pets_action',
    description: 'Resolve the specific pets action + payload for a fragment already routed to the pets module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'log_care',
            'log_observation',
            'log_vet',
            'log_feed',
            'log_supplement',
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
            // log_care
            what: { type: 'string' },
            // log_observation
            note: { type: 'string' },
            // log_vet
            reason: { type: 'string' },
            // log_supplement
            supplement: { type: 'string' },
            dose: { type: 'string' },
            // shared
            petName: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const petsConfig: ModuleConfig<PetsClassification, undefined> = {
  moduleName: 'pets',
  canonicalItems: [], // pets has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
