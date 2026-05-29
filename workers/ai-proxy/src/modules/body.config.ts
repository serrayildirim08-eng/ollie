/**
 * body.config.ts — Module-specific config for `/route/body` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the body module
 * with a chosen action. Layer 2 = body-specific AI that takes the raw
 * fragment + (optional) Layer 1 hint and resolves the specific action +
 * payload. We use the SAME ModuleConfig shape grocery uses, plus an
 * opt-in tier ladder (8B → 70B → Haiku) so the cheap model handles the
 * 80% case and we only burn 70B/Haiku on ambiguous fragments.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq Llama 3.3 70B (escalation when 8B confidence < 0.7) — ~10x.
 *   4. Anthropic Haiku 4.5 (last-resort when 70B still < 0.7).
 *   5. NEVER regex/keyword fallback. (feedback_ollie_no_regex_routing.md)
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the body block in src/router/dump-classify.ts:
 *   - log_symptom   — { symptom, severity?, bodyPart? }
 *   - log_water     — { amountMl? }
 *   - log_supplement— { name, dose? }
 *   - log_episode   — { kind, duration? }
 *   - log_posture   — { }
 *   - log_hunger    — { }
 *   - log_movement  — { type, duration_min? }
 *
 * PII note: the worker-local scrubber (src/pii.ts) does NOT have a
 * medical category, so terms like "ibuprofen", "advil", "migraine",
 * "ADHD", "vitamin D", "panic attack" already pass through unscrubbed.
 * No allowlist extension is needed. The brief asked us to verify this
 * and we did — see comment in body-route.test.ts.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type BodyAction =
  | 'log_symptom'
  | 'log_water'
  | 'log_supplement'
  | 'log_episode'
  | 'log_posture'
  | 'log_hunger'
  | 'log_movement';

export interface BodyClassification {
  action: BodyAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear symptom
 * names, simple "drank 500ml water" style fragments). When the model
 * returns confidence < ESCALATE_THRESHOLD we re-call with 70B.
 */
export const BODY_MODEL_FAST = 'llama-3.1-8b-instant';
export const BODY_MODEL_ACCURATE = 'llama-3.3-70b-versatile';
export const BODY_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (14 = 2 per action) ────────────────────────
// Mix EN / ES / TR across the set so the model sees all three in context.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: BodyClassification }> = [
  // log_symptom — EN
  {
    input: 'i have a headache',
    output: {
      action: 'log_symptom',
      payload: { symptom: 'headache' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_symptom — TR
  {
    input: 'başım çok ağrıyor 7/10',
    output: {
      action: 'log_symptom',
      payload: { symptom: 'headache', severity: 4, bodyPart: 'head' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // log_water — ES
  {
    input: 'me tomé 500ml de agua',
    output: {
      action: 'log_water',
      payload: { amountMl: 500 },
      confidence: 0.98,
      language: 'es',
    },
  },
  // log_water — EN (no amount given)
  {
    input: 'had some water',
    output: {
      action: 'log_water',
      payload: {},
      confidence: 0.85,
      language: 'en',
    },
  },
  // log_supplement — EN
  {
    input: 'took vitamin D 1000iu this morning',
    output: {
      action: 'log_supplement',
      payload: { name: 'vitamin D', dose: '1000iu' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // log_supplement — TR
  {
    input: 'magnezyum aldım 400mg',
    output: {
      action: 'log_supplement',
      payload: { name: 'magnesium', dose: '400mg' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // log_episode — EN (panic attack)
  {
    input: 'panic attack lasted about 10 minutes',
    output: {
      action: 'log_episode',
      payload: { kind: 'panic attack', duration: '10 min' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_episode — ES (migraine)
  {
    input: 'tuve una migraña que duró dos horas',
    output: {
      action: 'log_episode',
      payload: { kind: 'migraine', duration: '2 hours' },
      confidence: 0.94,
      language: 'es',
    },
  },
  // log_posture — EN
  {
    input: 'fixing my posture',
    output: {
      action: 'log_posture',
      payload: {},
      confidence: 0.88,
      language: 'en',
    },
  },
  // log_posture — TR
  {
    input: 'duruşumu düzelttim',
    output: {
      action: 'log_posture',
      payload: {},
      confidence: 0.85,
      language: 'tr',
    },
  },
  // log_hunger — ES
  {
    input: 'tengo hambre',
    output: {
      action: 'log_hunger',
      payload: {},
      confidence: 0.95,
      language: 'es',
    },
  },
  // log_hunger — EN
  {
    input: 'i am hungry',
    output: {
      action: 'log_hunger',
      payload: {},
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_movement — EN (walk with duration)
  {
    input: '20 min walk',
    output: {
      action: 'log_movement',
      payload: { type: 'walk', duration_min: 20 },
      confidence: 0.97,
      language: 'en',
    },
  },
  // log_movement — TR (yoga with duration)
  {
    input: '30dk yoga yaptım',
    output: {
      action: 'log_movement',
      payload: { type: 'yoga', duration_min: 30 },
      confidence: 0.96,
      language: 'tr',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's body-module Layer 2 AI. The user dumped a fragment that has already been routed to the body module. Pick the most specific body action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- log_symptom: a felt physical symptom. payload: { symptom (REQUIRED, lowercase canonical e.g. "headache"/"nausea"/"cramps"), severity? (1-5 derived from any X/10 rating: 1-2→1, 3-4→2, 5-6→3, 7-8→4, 9-10→5), bodyPart? }
    Triggers: "headache", "başım ağrıyor", "me duele la cabeza", "feeling nauseous", "midem bulanıyor".
- log_water: hydration event. payload: { amountMl? } — convert units: 1 cup=240, 1 glass/bardak/vaso=250, 1 bottle/şişe/botella=500, 1L=1000. Omit when no amount.
    Triggers: "drank water", "su içtim", "tomé agua".
- log_supplement: a supplement or vitamin (NOT a prescription med). payload: { name (REQUIRED, canonical lowercase e.g. "vitamin D"/"magnesium"/"omega-3"), dose? (preserve user's units e.g. "1000iu"/"400mg") }
    Triggers: "took vitamin X", "X aldım", "tomé X". If the substance is a PRESCRIPTION med (ibuprofen/advil/sertraline/zoloft etc.) this is still log_supplement at Layer 2 — medication routing happens at Layer 1.
- log_episode: a discrete acute event with a kind+duration. payload: { kind (REQUIRED e.g. "panic attack"/"migraine"/"asthma attack"/"dissociation"), duration? (preserve user units) }
    Triggers: "panic attack", "migraine", "asthma attack", "kriz geçirdim", "tuve un ataque".
- log_posture: a posture-check or correction. payload: { } — no fields.
    Triggers: "fixing my posture", "duruşum", "postura".
- log_hunger: a felt hunger state. payload: { } — no fields.
    Triggers: "i'm hungry", "açım", "tengo hambre".
- log_movement: physical activity (walk/run/yoga/lift/stretch/swim/etc.). payload: { type (REQUIRED, canonical lowercase activity name), duration_min? (number; convert "30dk"/"30min"/"half an hour"→30) }
    Triggers: "walked", "yürüdüm", "caminé", "ran", "did yoga", "stretched", "hice estiramientos".

DISAMBIGUATION:
- "headache" alone → log_symptom (not log_episode — episode is for acute named conditions like panic/migraine/asthma).
- "migraine" → log_episode (it has a defined onset/end), NOT log_symptom.
- "took ibuprofen for my headache" → log_supplement with name="ibuprofen" (the act of taking is the loggable event; the headache context is informational).
- "i'm tired" / "feeling off" without a specific symptom → log_symptom with symptom=user's wording, confidence around 0.6 (let escalation handle it).

OUTPUT — respond ONLY with the classify_body_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_body_action',
    description: 'Resolve the specific body action + payload for a fragment already routed to the body module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'log_symptom',
            'log_water',
            'log_supplement',
            'log_episode',
            'log_posture',
            'log_hunger',
            'log_movement',
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
            // log_symptom
            symptom: { type: 'string' },
            severity: { type: 'number' },
            bodyPart: { type: 'string' },
            // log_water
            amountMl: { type: 'number' },
            // log_supplement
            name: { type: 'string' },
            dose: { type: 'string' },
            // log_episode
            kind: { type: 'string' },
            duration: { type: 'string' },
            // log_movement
            type: { type: 'string' },
            duration_min: { type: 'number' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const bodyConfig: ModuleConfig<BodyClassification, undefined> = {
  moduleName: 'body',
  canonicalItems: [], // body has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
