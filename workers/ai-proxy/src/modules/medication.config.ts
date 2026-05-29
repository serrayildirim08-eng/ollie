/**
 * medication.config.ts — Module-specific config for `/route/medication` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the medication module
 * with a chosen action. Layer 2 = medication-specific AI that takes the raw
 * fragment + (optional) Layer 1 hint and resolves the specific action +
 * payload. Mirrors the sleep Layer 2 shape (see sleep.config.ts) one-to-one
 * — same ModuleConfig, same tier ladder, same trilingual few-shot convention.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same pair as sleep/body.
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the medication block in src/router/dump-classify.ts (~line 183):
 *   - log_dose        — { medName: REQUIRED, dose? }
 *   - missed_dose     — { medName: REQUIRED }
 *   - side_effect_note— { medName: REQUIRED, note: REQUIRED }
 *
 * Mirror TARGET note: sleep's `log_insomnia.med_taken` + `med_dose` mirror
 * INTO medication via a direct `medEvents.logDose()` call in the sleep
 * handler (apps/native/src/modules/sleep/handler.ts). That path is a
 * direct repository call, NOT a re-route through this Layer 2. This Layer 2
 * only fires when Layer 1 explicitly routes a fragment to `medication`.
 *
 * PII note: the worker-local scrubber (src/pii.ts) targets identity PII
 * only — there is no MEDICAL / MEDICATION regex category. All medication
 * names — brand ("Zoloft", "Adderall", "Ozempic", "Wellbutrin"), generic
 * ("sertraline", "fluoxetine", "lisinopril", "metformin", "ibuprofen"),
 * supplements ("vitamin D", "B12", "magnesium"), and informal references
 * ("my anxiety meds") — pass through unchanged. Without medName, this
 * Layer 2 is useless. If a future scrubber adds a medical category it
 * MUST allowlist ALL medication names first.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type MedicationAction =
  | 'log_dose'
  | 'missed_dose'
  | 'side_effect_note';

export interface MedicationClassification {
  action: MedicationAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear "took 50mg
 * sertraline" style fragments). When the model returns confidence <
 * ESCALATE_THRESHOLD we re-call with the accurate tier (GPT-OSS 120B — has
 * Groq prompt caching). Same pair and threshold as sleep/body.
 */
export const MEDICATION_MODEL_FAST = 'llama-3.1-8b-instant';
export const MEDICATION_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const MEDICATION_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (6 = 2 per action) ─────────────────────────
// Mix EN / ES / TR across the set so the model sees all three in context.
// medName is REQUIRED: use exact user wording; never invent a placeholder.
// Brand names ("Zoloft", "Adderall"), generics ("sertraline", "metformin"),
// supplements ("vitamin D", "magnesium"), and informal ("my anxiety meds")
// must all survive and land in medName verbatim.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: MedicationClassification }> = [
  // log_dose — EN (brand + dose)
  {
    input: 'took 50mg sertraline this morning',
    output: {
      action: 'log_dose',
      payload: { medName: 'sertraline', dose: '50mg' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // log_dose — TR (informal reference, no dose)
  {
    input: 'ilacımı aldım',
    output: {
      action: 'log_dose',
      payload: { medName: 'ilacımı' },
      confidence: 0.88,
      language: 'tr',
    },
  },
  // missed_dose — EN (brand name)
  {
    input: 'forgot my Adderall',
    output: {
      action: 'missed_dose',
      payload: { medName: 'Adderall' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // missed_dose — ES (informal)
  {
    input: 'se me olvidó la pastilla',
    output: {
      action: 'missed_dose',
      payload: { medName: 'la pastilla' },
      confidence: 0.87,
      language: 'es',
    },
  },
  // side_effect_note — EN (generic + note)
  {
    input: 'sertraline making me nauseous',
    output: {
      action: 'side_effect_note',
      payload: { medName: 'sertraline', note: 'making me nauseous' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // side_effect_note — TR (brand + note)
  {
    input: 'Wellbutrin bana iyi gelmiyor, baş ağrısı yapıyor',
    output: {
      action: 'side_effect_note',
      payload: { medName: 'Wellbutrin', note: 'baş ağrısı yapıyor' },
      confidence: 0.94,
      language: 'tr',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's medication-module Layer 2 AI. The user dumped a fragment that has already been routed to the medication module. Pick the most specific medication action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

CRITICAL — medName is REQUIRED on every action:
- Extract brand names verbatim: "Zoloft", "Adderall", "Ozempic", "Wellbutrin".
- Extract generic names verbatim: "sertraline", "fluoxetine", "lisinopril", "metformin", "ibuprofen".
- Extract supplements verbatim: "vitamin D", "B12", "magnesium", "melatonin".
- Informal references: "my anxiety meds" → medName="my anxiety meds" (use the user's exact wording).
- NEVER invent a placeholder like "unknown" or "medication". Use the user's actual wording.

ACTIONS (pick exactly one):
- log_dose: user took / administered a medication. payload: { medName (REQUIRED — exact name the user said), dose? (preserve user's units e.g. "50mg", "10mg", "1 tablet") }
    Triggers: "took X", "X aldım", "tomé X", "took my X", "ilacımı aldım", "took X pill/tablet", "administered X".
    When dose is given ("took 50mg sertraline"), extract both medName and dose.
    When no dose given ("took my Adderall"), emit medName only.
- missed_dose: user forgot or missed a medication dose. payload: { medName (REQUIRED) }
    Triggers: "forgot X", "missed X", "didn't take X", "X almadım", "se me olvidó X", "skipped X".
    Extract medName from the medication name — if only "the pill" / "la pastilla" / "ilacımı" use that string literally.
- side_effect_note: user experienced a side effect from a medication. payload: { medName (REQUIRED), note (REQUIRED — the side effect itself, preserve user's wording) }
    Triggers: "X making me [symptom]", "X yapıyor", "X me causa [síntoma]", "side effect of X", "X gives me [symptom]".

DISAMBIGUATION:
- "took melatonin to sleep" → log_dose with medName="melatonin" (melatonin is a supplement med; body's log_supplement is for body module only — medication Layer 2 gets this because Layer 1 already routed it here).
- "forgot my meds" (no specific name) → missed_dose with medName="my meds" (literal user wording).
- "Wellbutrin not working" vs "Wellbutrin gives me headaches": "not working" is more ambiguous (confidence ~0.65, let escalation decide between missed_dose / side_effect_note). "gives me headaches" → side_effect_note.
- If the fragment mentions both taking a dose and a side effect in the same breath ("took Ozempic and feeling nauseous"), prefer side_effect_note — it captures more information.

OUTPUT — respond ONLY with the classify_medication_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous (e.g. unclear which action, unclear medName), return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_medication_action',
    description: 'Resolve the specific medication action + payload for a fragment already routed to the medication module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'log_dose',
            'missed_dose',
            'side_effect_note',
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
            // log_dose + missed_dose + side_effect_note all share medName
            medName: { type: 'string' },
            // log_dose
            dose: { type: 'string' },
            // side_effect_note
            note: { type: 'string' },
          },
          required: ['medName'],
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const medicationConfig: ModuleConfig<MedicationClassification, undefined> = {
  moduleName: 'medication',
  canonicalItems: [], // medication has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
