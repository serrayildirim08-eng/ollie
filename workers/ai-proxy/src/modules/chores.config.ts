/**
 * chores.config.ts — Module-specific config for `/route/chores` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the chores module with a
 * chosen action. Layer 2 = chores-specific AI that takes the raw fragment +
 * (optional) Layer 1 hint and resolves the specific action + payload. Mirrors
 * the habits Layer 2 shape (see habits.config.ts) one-to-one — same
 * ModuleConfig, same tier ladder, same trilingual few-shot convention.
 *
 * Why this exists (S2 · fix 4): Layer 1 can route to `chores`, but the module
 * had no Layer-2 config, so a re-route through `/route/chores` returned 404
 * `unknown_module`. This adds the minimal-but-functional config + registers it
 * in route.ts so the re-route resolves.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7).
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Actions mirror the chores block in src/router/dump-classify.ts:
 *   - chore_done           — { chore: REQUIRED }            (resets a recurring clock)
 *   - add_chore            — { chore: REQUIRED }            (one-off future chore)
 *   - add_recurring_chore  — { chore: REQUIRED, weekdays?: number[], cadenceDays?: number }
 *       weekdays use local 0=Sun..6=Sat. Prefer weekdays when specific days are
 *       named; use cadenceDays (weekly→7, daily→1, every N→N, monthly→30) only
 *       when no specific weekday is given.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type ChoresAction = 'chore_done' | 'add_chore' | 'add_recurring_chore';

export interface ChoresClassification {
  action: ChoresAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

export const CHORES_MODEL_FAST = 'llama-3.1-8b-instant';
export const CHORES_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const CHORES_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (6 = 2 per action) ─────────────────────────

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: ChoresClassification }> = [
  // chore_done — EN
  {
    input: 'cleaned the kitchen',
    output: {
      action: 'chore_done',
      payload: { chore: 'clean the kitchen' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // chore_done — ES
  {
    input: 'limpié la cocina',
    output: {
      action: 'chore_done',
      payload: { chore: 'clean the kitchen' },
      confidence: 0.95,
      language: 'es',
    },
  },
  // add_chore — EN (one-off future)
  {
    input: 'need to vacuum',
    output: {
      action: 'add_chore',
      payload: { chore: 'vacuum' },
      confidence: 0.93,
      language: 'en',
    },
  },
  // add_chore — TR (one-off future)
  {
    input: 'banyoyu temizlemem lazım',
    output: {
      action: 'add_chore',
      payload: { chore: 'clean the bathroom' },
      confidence: 0.92,
      language: 'tr',
    },
  },
  // add_recurring_chore — EN (by weekday)
  {
    input: 'do laundry on wednesdays',
    output: {
      action: 'add_recurring_chore',
      payload: { chore: 'do laundry', weekdays: [3] },
      confidence: 0.94,
      language: 'en',
    },
  },
  // add_recurring_chore — EN (by interval)
  {
    input: 'vacuum every 7 days',
    output: {
      action: 'add_recurring_chore',
      payload: { chore: 'vacuum', cadenceDays: 7 },
      confidence: 0.93,
      language: 'en',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's chores-module Layer 2 AI. The user dumped a fragment that has already been routed to the chores module (household cleaning/upkeep tasks). Pick the most specific chores action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- chore_done: a household chore was COMPLETED (past tense). payload: { chore (REQUIRED — the chore as a short imperative label, e.g. "vacuumed" → "vacuum", "cleaned the kitchen" → "clean the kitchen") }
    Triggers: "vacuumed", "did the dishes", "took out the trash", "cleaned X", "süpürdüm", "limpié X".
- add_chore: a ONE-OFF future chore to do (no recurrence). payload: { chore (REQUIRED) }
    Triggers: "need to vacuum", "have to do the dishes", "clean the bathroom", "banyoyu temizlemem lazım".
- add_recurring_chore: a chore that repeats. payload: { chore (REQUIRED), weekdays?: number[], cadenceDays?: number }
    - By WEEKDAY ("do laundry on wednesdays", "vacuum on mondays", "çarşambaları çamaşır", "los lunes paso la aspiradora"): use weekdays, local 0=Sun..6=Sat (wednesday→[3], "mon & thu"→[1,4], weekdays→[1,2,3,4,5]). PREFER weekdays whenever specific days are named.
    - By INTERVAL ("every week", "every 7 days", "weekly", "her hafta", "monthly"): use cadenceDays (weekly→7, daily→1, every N days→N, monthly→30, biweekly→14). Use cadenceDays ONLY when no specific weekday is named.

DISAMBIGUATION:
- A chore mentioned with a PRICE or a purchased item is NOT a chore (buying a vacuum → finance/grocery). If the fragment is clearly a purchase, return confidence < 0.7.
- Past tense → chore_done. Future one-off → add_chore. Repeating → add_recurring_chore.

OUTPUT — respond ONLY with the classify_chores_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_chores_action',
    description:
      'Resolve the specific chores action + payload for a fragment already routed to the chores module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: ['chore_done', 'add_chore', 'add_recurring_chore'],
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
            chore: { type: 'string' },
            weekdays: { type: 'array', items: { type: 'number' } },
            cadenceDays: { type: 'number' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const choresConfig: ModuleConfig<ChoresClassification, undefined> = {
  moduleName: 'chores',
  canonicalItems: [], // chores has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
