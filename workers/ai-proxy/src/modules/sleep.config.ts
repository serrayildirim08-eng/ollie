/**
 * sleep.config.ts — Module-specific config for `/route/sleep` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the sleep module
 * with a chosen action. Layer 2 = sleep-specific AI that takes the raw
 * fragment + (optional) Layer 1 hint and resolves the specific action +
 * payload. Mirrors the body Layer 2 shape (see body.config.ts) one-to-one
 * — same ModuleConfig, same tier ladder, same trilingual few-shot
 * convention.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same rationale that drove body's 70B→120B swap
 *      in commit a81567a 2026-05-30 and the Layer 1 swap in 0b098e1.
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the sleep block in src/router/dump-classify.ts (~line 153):
 *   - log_sleep      — { bedtime?, wake?, quality?: 1-5, hours? }
 *   - wind_down_note — { note: REQUIRED }
 *   - dream_log      — { text: REQUIRED }
 *   - log_insomnia   — { duration_attempted_min?, woke_count?, med_taken?, med_dose? }
 *
 * Cross-route hint (already wired in Layer 1 dump-classify and in the
 * native sleep handler): `log_insomnia.med_taken` + `med_dose` mirror
 * to `medication.log_dose` (Approach B — primary handler emits secondary,
 * same convention as body.log_movement.pet → pets.log_care). The Layer 2
 * prompt must preserve those hint keys when present so the downstream
 * handler can dispatch the mirror.
 *
 * PII note: the worker-local scrubber (src/pii.ts) targets identity PII
 * only — there is no MEDICAL / MEDICATION regex category. Common sleep
 * meds (melatonin, ambien, trazodone, mirtazapine, doxepin) pass through
 * unchanged, which is exactly what /route/sleep Layer 2 needs to extract
 * the `med_taken` cross-route hint accurately. If a future scrubber adds
 * a medical category it MUST allowlist these terms first.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type SleepAction =
  | 'log_sleep'
  | 'wind_down_note'
  | 'dream_log'
  | 'log_insomnia';

export interface SleepClassification {
  action: SleepAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear "slept 8h"
 * style fragments, simple wind-down notes). When the model returns
 * confidence < ESCALATE_THRESHOLD we re-call with the accurate tier
 * (GPT-OSS 120B — has Groq prompt caching). Same pair as body, same
 * threshold, same reasoning (commits 0b098e1 + a81567a).
 */
export const SLEEP_MODEL_FAST = 'llama-3.1-8b-instant';
export const SLEEP_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const SLEEP_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (8 = 2 per action) ─────────────────────────
// Mix EN / ES / TR across the set so the model sees all three in context.
// Sleep is a rich everyday domain — use natural phrases the user actually
// types into the dump box ("slept 11-7 well", "uyuyamadım", "soñé que…").

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: SleepClassification }> = [
  // log_sleep — EN (bedtime/wake range + quality)
  {
    input: 'slept 11-7 well',
    output: {
      action: 'log_sleep',
      payload: { bedtime: '23:00', wake: '07:00', quality: 4 },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_sleep — TR (hours + quality)
  {
    input: '8 saat uyudum iyi',
    output: {
      action: 'log_sleep',
      payload: { hours: 8, quality: 4 },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // wind_down_note — EN
  {
    input: 'read for 20 min before bed',
    output: {
      action: 'wind_down_note',
      payload: { note: 'read for 20 min before bed' },
      confidence: 0.92,
      language: 'en',
    },
  },
  // wind_down_note — ES
  {
    input: 'me tomé una manzanilla antes de dormir',
    output: {
      action: 'wind_down_note',
      payload: { note: 'me tomé una manzanilla antes de dormir' },
      confidence: 0.9,
      language: 'es',
    },
  },
  // dream_log — ES
  {
    input: 'soñé que volaba',
    output: {
      action: 'dream_log',
      payload: { text: 'volaba' },
      confidence: 0.94,
      language: 'es',
    },
  },
  // dream_log — EN
  {
    input: 'dreamt I was back at school and forgot my locker combination',
    output: {
      action: 'dream_log',
      payload: { text: 'back at school and forgot my locker combination' },
      confidence: 0.93,
      language: 'en',
    },
  },
  // log_insomnia — TR (with cross-route med hint)
  {
    input: 'uyuyamadım, 5mg melatonin aldım',
    output: {
      action: 'log_insomnia',
      payload: { med_taken: 'melatonin', med_dose: '5mg' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // log_insomnia — EN (duration_attempted_min)
  {
    input: "couldn't sleep, lay there 2 hours",
    output: {
      action: 'log_insomnia',
      payload: { duration_attempted_min: 120 },
      confidence: 0.93,
      language: 'en',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's sleep-module Layer 2 AI. The user dumped a fragment that has already been routed to the sleep module. Pick the most specific sleep action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- log_sleep: a slept-night log. payload: { bedtime? (24h "HH:MM"), wake? (24h "HH:MM"), quality? (1-5: 1=very bad, 2=bad, 3=ok, 4=good, 5=great — derive from words like "well/iyi/bien"→4, "badly/kötü/mal"→2), hours? (number) }
    Always emit \`hours\` when the user states a duration ("slept 7 hours" / "8 saat uyudum" / "dormí 6 horas"). Omit bedtime/wake unless the user gave explicit times like "11-7" / "23:00 - 07:00". Quality only when expressed.
    Triggers: "slept", "uyudum", "dormí", "got X hours", "X saat uyudum".
- wind_down_note: a pre-bed wind-down activity (reading, tea, dim lights, screens-off). payload: { note (REQUIRED — the wind-down activity itself, preserve user's wording) }
    Triggers: "read before bed", "before sleeping I…", "yatmadan önce…", "antes de dormir…".
- dream_log: the user is logging the content of a dream. payload: { text (REQUIRED — the dream content, NOT the framing verb. "dreamt I was flying" → text: "I was flying" / "soñé que volaba" → text: "volaba") }
    Triggers: "dreamt", "had a dream", "rüyamda", "soñé".
- log_insomnia: an explicit can't-sleep / fragmented-sleep event (semantically distinct from log_sleep with quality=1 — insomnia means the user lay awake or repeatedly woke, not "slept badly"). payload: { duration_attempted_min? (number — minutes spent trying to sleep), woke_count? (number of overnight wakings), med_taken? (CROSS-ROUTE HINT — the med name lowercase if the user took a sleep aid like melatonin/ambien/trazodone/mirtazapine/doxepin; the handler mirrors this to medication.log_dose), med_dose? (preserve user's units e.g. "5mg") }
    Triggers: "couldn't sleep", "uyuyamadım", "no podía dormir", "kept waking up", "lay awake".

DISAMBIGUATION:
- "slept badly" / "quality was awful" → log_sleep with quality=1 (the user DID sleep). Use log_insomnia only when the user did NOT sleep or fragmented heavily.
- "dreamt I was flying" → dream_log with text="I was flying" (strip the framing verb). Do NOT put "dreamt I was flying" into text.
- "couldn't sleep so took melatonin" → log_insomnia with med_taken="melatonin". Do NOT split into two actions — Layer 1 already chose sleep, and the cross-route mirror is handled by the sleep handler downstream.
- "took 5mg melatonin before bed" (no insomnia mentioned) → this is genuinely ambiguous between log_insomnia (med_taken) and wind_down_note. Prefer log_insomnia with med_taken when a sleep aid is named; prefer wind_down_note for non-pharmacological wind-down like reading or tea.
- "had a weird dream" with no content → dream_log with text="weird dream" (confidence around 0.6 — let escalation decide).

OUTPUT — respond ONLY with the classify_sleep_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_sleep_action',
    description: 'Resolve the specific sleep action + payload for a fragment already routed to the sleep module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'log_sleep',
            'wind_down_note',
            'dream_log',
            'log_insomnia',
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
            // log_sleep
            bedtime: { type: 'string' },
            wake: { type: 'string' },
            quality: { type: 'number' },
            hours: { type: 'number' },
            // wind_down_note
            note: { type: 'string' },
            // dream_log
            text: { type: 'string' },
            // log_insomnia
            duration_attempted_min: { type: 'number' },
            woke_count: { type: 'number' },
            med_taken: { type: 'string' },
            med_dose: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const sleepConfig: ModuleConfig<SleepClassification, undefined> = {
  moduleName: 'sleep',
  canonicalItems: [], // sleep has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
