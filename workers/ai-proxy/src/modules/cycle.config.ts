/**
 * cycle.config.ts — Module-specific config for `/route/cycle` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the cycle module
 * with a chosen action. Layer 2 = cycle-specific AI that takes the raw
 * fragment and resolves the specific action + payload. Port of sleep.config.ts
 * (same ModuleConfig, same tier ladder, same trilingual few-shot convention).
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same pair as sleep (commits 0b098e1 + a81567a).
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the cycle block in src/router/dump-classify.ts (~line 126):
 *   - log_period_start — { } — no fields
 *   - log_period_end   — { } — no fields
 *   - log_symptom      — { symptom: string REQUIRED }
 *   - pill_logged      — { } — no fields (birth-control pill context)
 *
 * No cross-route mirror. Cycle is standalone Layer 2 — no secondary dispatch.
 *
 * PII note: cycle data (period dates, symptoms like "cramps", "bloating",
 * "mood swings") is medically sensitive but not crisis-level. The worker-local
 * scrubber (src/pii.ts) targets identity PII only — cycle symptom terms pass
 * through unchanged, which is exactly what Layer 2 needs. Do NOT add cycle
 * terms to the PII scrub allowlist; the storage layer handles sensitivity.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type CycleAction =
  | 'log_period_start'
  | 'log_period_end'
  | 'log_symptom'
  | 'pill_logged'
  // Pregnancy PAUSE (not tracking). set_pregnant → cycle dormant;
  // end_pregnancy → resume. One neutral end for birth/miscarriage/termination.
  | 'set_pregnant'
  | 'end_pregnancy';

export interface CycleClassification {
  action: CycleAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear "period
 * started" / "tomé la pastilla" style fragments). When the model returns
 * confidence < ESCALATE_THRESHOLD we re-call with the accurate tier
 * (GPT-OSS 120B — has Groq prompt caching). Same pair as sleep, same
 * threshold, same reasoning (commits 0b098e1 + a81567a).
 */
export const CYCLE_MODEL_FAST = 'llama-3.1-8b-instant';
export const CYCLE_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const CYCLE_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (8 = 2 per action) ─────────────────────────
// Mix EN / ES / TR across the set. 3 EN + 3 ES + 2 TR distributed across actions,
// matching the sleep distribution pattern.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: CycleClassification }> = [
  // log_period_start — EN
  {
    input: 'period started',
    output: {
      action: 'log_period_start',
      payload: {},
      confidence: 0.97,
      language: 'en',
    },
  },
  // log_period_start — ES
  {
    input: 'me bajó',
    output: {
      action: 'log_period_start',
      payload: {},
      confidence: 0.96,
      language: 'es',
    },
  },
  // log_period_end — TR
  {
    input: 'regl bitti',
    output: {
      action: 'log_period_end',
      payload: {},
      confidence: 0.96,
      language: 'tr',
    },
  },
  // log_period_end — EN
  {
    input: 'period is over',
    output: {
      action: 'log_period_end',
      payload: {},
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_symptom — ES
  {
    input: 'tengo calambres hoy',
    output: {
      action: 'log_symptom',
      payload: { symptom: 'cramps' },
      confidence: 0.95,
      language: 'es',
    },
  },
  // log_symptom — TR
  {
    input: 'kramp girdim',
    output: {
      action: 'log_symptom',
      payload: { symptom: 'cramps' },
      confidence: 0.94,
      language: 'tr',
    },
  },
  // pill_logged — EN
  {
    input: 'took my pill',
    output: {
      action: 'pill_logged',
      payload: {},
      confidence: 0.95,
      language: 'en',
    },
  },
  // pill_logged — ES
  {
    input: 'tomé la pastilla',
    output: {
      action: 'pill_logged',
      payload: {},
      confidence: 0.96,
      language: 'es',
    },
  },
  // set_pregnant — EN (pause)
  {
    input: "i'm pregnant",
    output: {
      action: 'set_pregnant',
      payload: {},
      confidence: 0.97,
      language: 'en',
    },
  },
  // set_pregnant — TR
  {
    input: 'hamileyim',
    output: {
      action: 'set_pregnant',
      payload: {},
      confidence: 0.96,
      language: 'tr',
    },
  },
  // end_pregnancy — EN (birth)
  {
    input: 'i had the baby',
    output: {
      action: 'end_pregnancy',
      payload: {},
      confidence: 0.96,
      language: 'en',
    },
  },
  // end_pregnancy — EN (loss; must read as neutral as birth)
  {
    input: 'i lost the pregnancy',
    output: {
      action: 'end_pregnancy',
      payload: {},
      confidence: 0.95,
      language: 'en',
    },
  },
  // end_pregnancy — ES
  {
    input: 'el embarazo terminó',
    output: {
      action: 'end_pregnancy',
      payload: {},
      confidence: 0.94,
      language: 'es',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's cycle-module Layer 2 AI. The user dumped a fragment that has already been routed to the cycle module. Pick the most specific cycle action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- log_period_start: the user is marking the beginning of their period. payload: { } — no fields.
    Triggers: "period started", "got my period today", "got my period", "regl başladı", "me bajó", "me vino la regla".
- log_period_end: the user is marking the end of their period. payload: { } — no fields.
    Triggers: "period ended", "period is over", "period stopped", "regl bitti", "se me fue la regla".
- log_symptom: a cycle-related physical symptom (cramps, bloating, mood swings, spotting, breast tenderness, fatigue, etc.). payload: { symptom (REQUIRED, lowercase canonical e.g. "cramps"/"bloating"/"mood swings"/"spotting"/"breast tenderness"/"fatigue") }
    Triggers: "cramps bad rn", "kramp girdim", "tengo calambres", "me siento hinchada", "şişkinlik var", "bloating", "mood swings".
- pill_logged: the user took their birth-control pill (cycle context — Layer 1 has already distinguished this from general medication). payload: { } — no fields.
    Triggers: "took my pill", "took my birth control", "tomé la pastilla", "hapı aldım", "birth control taken".
- set_pregnant: the user is declaring a pregnancy. This PAUSES the cycle. payload: { } — no fields. NOT pregnancy tracking — no due date, no trimester, no fields.
    Triggers: "i'm pregnant", "i am pregnant", "we're expecting", "estoy embarazada", "hamileyim", "hamile kaldım".
- end_pregnancy: the pregnancy ENDED by ANY path — birth, miscarriage, or termination. This RESUMES the cycle. payload: { } — no fields. ONE neutral action for every kind of ending; never branch on which, never ask the user to specify.
    Triggers (birth): "i had the baby", "gave birth", "di a luz", "doğum yaptım".
    Triggers (loss): "i lost the pregnancy", "i had a miscarriage", "perdí el embarazo", "düşük yaptım".
    Triggers (termination / generic): "the pregnancy ended", "i had an abortion", "el embarazo terminó", "hamileliğim sona erdi", "i'm not pregnant anymore".

DISAMBIGUATION:
- "i'm pregnant" → set_pregnant. Do NOT treat as a symptom.
- Any ending of a pregnancy — birth, miscarriage, termination — → end_pregnancy with EMPTY payload. Treat all three identically and neutrally; do not record which kind.
- "i'm not pregnant anymore" / "lost it" in a pregnancy context → end_pregnancy.
- "got my period" → log_period_start. Clear unambiguous trigger.
- "my period started a few days ago" → log_period_start (log-now semantics; timestamp is applied at dispatch).
- "cramps bad rn" → log_symptom with symptom="cramps". Even without "period" context, cramps in the cycle module = log_symptom.
- "feeling bloated" → log_symptom with symptom="bloating".
- "mood swings today" → log_symptom with symptom="mood swings".
- "took my pill" (in cycle context) → pill_logged. This is specifically birth-control; Layer 1 has already routed it here.
- "headache" alone in cycle context → log_symptom with symptom="headache" (cycle-related symptom, confidence ~0.6 — let escalation decide if ambiguous with body module).
- Fragment that could be either period start/end AND a symptom → pick the most dominant signal. "period started, cramps too" → log_period_start (the start event is the primary log; symptom is incidental).

OUTPUT — respond ONLY with the classify_cycle_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_cycle_action',
    description: 'Resolve the specific cycle action + payload for a fragment already routed to the cycle module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'log_period_start',
            'log_period_end',
            'log_symptom',
            'pill_logged',
            'set_pregnant',
            'end_pregnancy',
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
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const cycleConfig: ModuleConfig<CycleClassification, undefined> = {
  moduleName: 'cycle',
  canonicalItems: [], // cycle has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
