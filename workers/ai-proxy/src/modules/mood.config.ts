/**
 * mood.config.ts — Module-specific config for `/route/mood` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the mood module with a
 * chosen action. Layer 2 = mood-specific AI that takes the raw fragment +
 * (optional) Layer 1 hint and resolves the specific action + payload. Mirrors
 * the habits Layer 2 shape (see habits.config.ts) one-to-one — same
 * ModuleConfig, same tier ladder, same trilingual few-shot convention.
 *
 * Why this exists (S2 · fix 4): Layer 1 can route to `mood`, but the module had
 * no Layer-2 config, so a re-route through `/route/mood` returned 404
 * `unknown_module`. This adds the minimal-but-functional config + registers it
 * in route.ts so the re-route resolves.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7).
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Actions mirror the mood block in src/router/dump-classify.ts (mood owns
 * feelings / energy / self-talk):
 *   - log_mood    — { label: REQUIRED, valence: "pos"|"neu"|"neg" }
 *   - log_energy  — { level: "low"|"mid"|"high", label? }
 *   - self_talk   — { statement: REQUIRED, valence: "pos"|"neg" }
 *
 * Boundary (from the Layer 1 prompt): body owns PHYSICAL symptoms only
 * (headache, cramp, nausea, dizzy, sore). Transient EMOTION + ENERGY state +
 * self-evaluation are mood's, not body's.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type MoodAction = 'log_mood' | 'log_energy' | 'self_talk';

export interface MoodClassification {
  action: MoodAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

export const MOOD_MODEL_FAST = 'llama-3.1-8b-instant';
export const MOOD_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const MOOD_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (6 = 2 per action) ─────────────────────────

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: MoodClassification }> = [
  // log_mood — EN (emotion)
  {
    input: 'feeling really anxious',
    output: {
      action: 'log_mood',
      payload: { label: 'anxious', valence: 'neg' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_mood — ES (emotion)
  {
    input: 'hoy me siento feliz',
    output: {
      action: 'log_mood',
      payload: { label: 'happy', valence: 'pos' },
      confidence: 0.94,
      language: 'es',
    },
  },
  // log_energy — EN (energy state)
  {
    input: 'so tired today',
    output: {
      action: 'log_energy',
      payload: { level: 'low', label: 'tired' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_energy — TR (energy state)
  {
    input: 'çok yorgunum',
    output: {
      action: 'log_energy',
      payload: { level: 'low', label: 'yorgun' },
      confidence: 0.93,
      language: 'tr',
    },
  },
  // self_talk — EN (self-evaluation)
  {
    input: "i don't like myself",
    output: {
      action: 'self_talk',
      payload: { statement: "don't like myself", valence: 'neg' },
      confidence: 0.92,
      language: 'en',
    },
  },
  // self_talk — TR (self-evaluation)
  {
    input: 'kendimden nefret ediyorum',
    output: {
      action: 'self_talk',
      payload: { statement: 'kendimden nefret ediyorum', valence: 'neg' },
      confidence: 0.91,
      language: 'tr',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's mood-module Layer 2 AI. The user dumped a fragment that has already been routed to the mood module (feelings / energy / self-talk). Pick the most specific mood action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- log_mood: a transient EMOTION (anxious, sad, happy, numb, overwhelmed, scared). payload: { label (REQUIRED — the emotion word), valence: "pos"|"neu"|"neg" }
- log_energy: an ENERGY state (tired, exhausted, drained, wired, "no energy", "running on empty"). payload: { level: "low"|"mid"|"high", label (the energy word) }
- self_talk: SELF-EVALUATION / a claim about oneself ("don't like myself", "I'm failing", "I'm lazy", "hate myself"). payload: { statement (REQUIRED — the self-evaluation, preserve user's wording), valence: "pos"|"neg" }

DISAMBIGUATION:
- "so tired" / "exhausted" / "no energy" → log_energy (NOT log_mood).
- "anxious" / "sad" / "happy" / "overwhelmed" → log_mood.
- "I'm lazy" / "I let myself down" / "I hate myself" → self_talk.
- PHYSICAL symptoms (headache, cramp, nausea, dizzy, sore) are NOT mood — those belong to body. If the fragment is purely physical, return confidence < 0.7.

OUTPUT — respond ONLY with the classify_mood_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_mood_action',
    description:
      'Resolve the specific mood action + payload for a fragment already routed to the mood module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: ['log_mood', 'log_energy', 'self_talk'],
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
            // log_mood / log_energy
            label: { type: 'string' },
            // log_mood / self_talk
            valence: { type: 'string', enum: ['pos', 'neu', 'neg'] },
            // log_energy
            level: { type: 'string', enum: ['low', 'mid', 'high'] },
            // self_talk
            statement: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const moodConfig: ModuleConfig<MoodClassification, undefined> = {
  moduleName: 'mood',
  canonicalItems: [], // mood has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
