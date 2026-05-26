/**
 * Per-fragment classification · Gemini 2.5 Flash with response_schema
 * (Decision C — structured output, no try/catch parse).
 *
 * Input: one fragment + its detected language.
 * Output: { module, payload, confidence } — confidence consumed by the
 * 3-tier policy in `dump-schema.ts > applyConfidencePolicy()`.
 *
 * Cache: NEVER cache fragment text. Only the (embedding → classification)
 * pair lives in Vectorize, written by the dump.ts handler after this
 * function returns.
 */

import type { FragmentLanguage, Module } from './dump-schema';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Allowed Module values (kept here for the response_schema enum).
const MODULES: Module[] = [
  'work',
  'admin',
  'pets',
  'cycle',
  'finance',
  'sleep',
  'body',
  'habits',
  'goals',
  'grocery',
  'medication',
  'dump_only',
];

const SYSTEM_PROMPT = `You are Ollie's brain-dump router. You receive one fragment of a user's dump and decide which downstream module it belongs to and what discrete action it represents.

Input may be in Turkish, English, Spanish, or any mix of the three within a single sentence (e.g. "compré pasta and email boran"). Classify based on intent, not language. Do not refuse on the basis of mixed language. Do not paraphrase.

Modules and their action vocabularies:
- work: log_focus_session | create_task | log_deadline | log_meeting | distraction_journal
- admin: create_task | create_phone_task | schedule_appointment | log_paperwork | recurring_decision | log_renewal
- pets: log_care | log_observation | log_vet | log_feed | log_supplement
- cycle: log_period_start | log_period_end | log_symptom | pill_logged
- finance: log_transaction | add_bill | savings_note | subscription_log
- sleep: log_sleep | wind_down_note | dream_log | log_insomnia
- body: log_symptom | log_water | log_supplement | log_episode | log_posture | log_hunger | log_movement
- habits: complete | streak_break_note | identity_statement
- goals: progress_note | create_goal | milestone_hit | obstacle_note
- grocery: pantry_add | pantry_use | shopping_list_add | pantry_low_flag | meal_request | recipe_cooked
- medication: log_dose | missed_dose | side_effect_note
- dump_only: archive_only  (use when no module fits OR confidence < 0.6)

Action disambiguation hints:
- grocery.pantry_low_flag (warning, "running low") vs shopping_list_add (active need, "out of"/"need to buy")
- pets.log_supplement (typed vitamin/calcium with dose) vs log_care (generic care event)
- sleep.log_insomnia (couldn't sleep at all) vs log_sleep with quality=1 (slept badly)
- admin.log_renewal (paperwork-with-expiry: passport, license, lease, insurance) vs recurring_decision (repeating choices like subscriptions)
- body.log_movement (walk/stretch/lift with duration) — primary for physical activity

Return a JSON object with: module, action, payload (free-form fields specific to the action), confidence (0..1).

Be conservative — if a fragment is ambiguous, pick dump_only with confidence 0.5. Errors of caution land the user in a "want to confirm?" UI, errors of over-confidence land bad data in a module.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['module', 'action', 'confidence', 'payload'],
  properties: {
    module: {
      type: 'string',
      enum: MODULES,
    },
    action: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    payload: { type: 'object' },
  },
} as const;

export interface ClassifyResult {
  module: Module;
  payload: Record<string, unknown>;
  confidence: number;
}

export async function classifyFragment(
  fragmentText: string,
  language: FragmentLanguage,
  apiKey: string,
): Promise<ClassifyResult> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const userMessage = `Fragment language: ${language}\nFragment: ${fragmentText}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`classify gemini ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = JSON.parse(rawText) as {
    module: Module;
    action: string;
    confidence: number;
    payload: Record<string, unknown>;
  };

  return {
    module: parsed.module,
    payload: { ...parsed.payload, module: parsed.module, action: parsed.action },
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}
