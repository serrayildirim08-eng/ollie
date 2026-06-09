/**
 * habits.config.ts — Module-specific config for `/route/habits` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the habits module
 * with a chosen action. Layer 2 = habits-specific AI that takes the raw
 * fragment + (optional) Layer 1 hint and resolves the specific action +
 * payload. Mirrors the medication Layer 2 shape (see medication.config.ts)
 * one-to-one — same ModuleConfig, same tier ladder, same trilingual few-shot
 * convention.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same pair as sleep/body/medication.
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the habits block in src/router/dump-classify.ts (~line 156):
 *   - complete          — { habitName: REQUIRED }
 *   - identity_statement— { text: REQUIRED }
 *   - streak_break_note — LEGACY. Layer 1 will NEVER route here
 *     (Ollie has no streaks — ADHD-shame mechanic, rejected). The action
 *     stays in the enum because it exists in the schema, but Layer 2
 *     demotes any arriving fragment with this action to dump_only and
 *     attaches reason: 'habits_streak_break_legacy'. No few-shots.
 *
 * No-streaks decision: locked 2026-05-07. See feedback_ollie_no_streaks.md.
 * Layer 1 SYSTEM_PROMPT (~line 65): "NEVER classify anything as
 * habits.streak_break_note." 'Broke my X habit' / 'missed 5 days of X'
 * → identity_statement (reflective) or dump_only (observational).
 *
 * Few-shots: 6 = 3 per effective action × 2 actions, distributed EN/ES/TR.
 * Effective actions: complete + identity_statement.
 * fall-off-reflective pattern ("missed running today, too tired") →
 * identity_statement (not complete, not dump_only) when the tone is
 * self-reflective. Two few-shots explicitly demonstrate this.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type HabitsAction =
  | 'complete'
  | 'identity_statement'
  | 'streak_break_note'; // LEGACY — Layer 2 demotes to dump_only

export interface HabitsClassification {
  action: HabitsAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear
 * "did my morning stretch" style fragments). When the model returns
 * confidence < ESCALATE_THRESHOLD we re-call with the accurate tier
 * (GPT-OSS 120B — has Groq prompt caching). Same pair and threshold
 * as sleep/body/medication.
 */
export const HABITS_MODEL_FAST = 'llama-3.1-8b-instant';
export const HABITS_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const HABITS_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (6 = 3 per effective action) ───────────────
// Mix EN / ES / TR across the set so the model sees all three in context.
// complete: bread-and-butter ("did my morning stretch", "meditation done").
// identity_statement: reflective affirmations + fall-off-the-wagon reflections.
// NO few-shots for streak_break_note — don't reinforce the dead action.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: HabitsClassification }> = [
  // complete — EN (clear completion)
  {
    input: 'did my morning stretch',
    output: {
      action: 'complete',
      payload: { habitName: 'morning stretch' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // complete — TR (straightforward)
  {
    input: 'meditasyonu yaptım',
    output: {
      action: 'complete',
      payload: { habitName: 'meditasyon' },
      confidence: 0.96,
      language: 'tr',
    },
  },
  // complete — ES (yoga)
  {
    input: 'hice yoga esta mañana, 20 minutos',
    output: {
      action: 'complete',
      payload: { habitName: 'yoga' },
      confidence: 0.95,
      language: 'es',
    },
  },
  // identity_statement — EN (affirmation)
  {
    input: "i'm finally a runner",
    output: {
      action: 'identity_statement',
      payload: { text: "i'm finally a runner" },
      confidence: 0.95,
      language: 'en',
    },
  },
  // identity_statement — TR (affirmation)
  {
    input: 'yazılım yapan biriyim artık',
    output: {
      action: 'identity_statement',
      payload: { text: 'yazılım yapan biriyim artık' },
      confidence: 0.94,
      language: 'tr',
    },
  },
  // identity_statement — ES (fall-off-reflective: "missed" but tone is self-reflective)
  {
    input: 'hoy no corrí, estoy cansada pero sigo siendo alguien que corre',
    output: {
      action: 'identity_statement',
      payload: { text: 'hoy no corrí, estoy cansada pero sigo siendo alguien que corre' },
      confidence: 0.88,
      language: 'es',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's habits-module Layer 2 AI. The user dumped a fragment that has already been routed to the habits module. Pick the most specific habits action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- complete: user completed / did a habit. payload: { habitName (REQUIRED — the habit name, extracted from the user's wording; use their exact name, not a rephrased version) }
    Triggers: "did X", "X done", "finished X", "completed X", "X yaptım", "hice X", "20 min yoga", "meditation done", "morning run ✓".
    habitName should be the habit label, not the full sentence. "did my morning stretch" → habitName="morning stretch".
- identity_statement: user makes a reflective claim about who they are, or reflects on a habit pattern (including fall-off-the-wagon moments that are self-reflective). payload: { text (REQUIRED — the full reflective statement, preserve user's wording) }
    Triggers:
      - Affirmations: "i am someone who X", "i'm a X person", "yazılım yapan biriyim", "ya soy alguien que X".
      - Fall-off reflective: "missed running today, too tired but I'm still a runner", "broke my reading habit but I know I'll get back to it", "X alışkanlığımı kaybettiğimi hissediyorum" when the tone shows self-reflection on identity.
    IMPORTANT: "I didn't do X today" with NO reflective framing → complete is wrong, identity_statement is borderline; prefer dump_only (confidence < 0.7 → escalation will decide).
    "I missed running today, I'm tired" with reflective framing → identity_statement.

DISAMBIGUATION:
- "meditation done" → complete with habitName="meditation". Clear completion, no ambiguity.
- "20 min yoga ✓" → complete with habitName="yoga". Checkmark signals completion.
- "i am someone who writes daily" → identity_statement. This is an affirmation, not a completion.
- "i'm finally a runner" → identity_statement. Self-identity claim.
- "missed running today, too tired but I'm still a runner" → identity_statement. Fall-off with reflective self-framing.
- "broke my reading habit" → identity_statement if reflective ("I let myself down, I'll restart"), dump_only if purely observational (confidence < 0.7 → escalate).
- "missed 5 days of yoga" purely factual → confidence < 0.7 (let escalation decide between identity_statement and dump_only). NEVER streak_break_note.
- streak_break_note: DEAD ACTION. Layer 1 will never route here. If this action somehow appears in the fragment hint, ignore it and pick complete or identity_statement based on content.

OUTPUT — respond ONLY with the classify_habits_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous (unclear action, unclear habitName), return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_habits_action',
    description: 'Resolve the specific habits action + payload for a fragment already routed to the habits module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'complete',
            'identity_statement',
            'streak_break_note', // LEGACY — present in schema, demoted by handler
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
            // complete
            habitName: { type: 'string' },
            // identity_statement
            text: { type: 'string' },
            // streak_break_note (LEGACY) — reason is optional
            reason: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const habitsConfig: ModuleConfig<HabitsClassification, undefined> = {
  moduleName: 'habits',
  canonicalItems: [], // habits has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
