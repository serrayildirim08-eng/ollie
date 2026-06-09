/**
 * work.config.ts — Module-specific config for `/route/work` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the work module
 * with a chosen action. Layer 2 = work-specific AI that takes the raw
 * fragment + (optional) Layer 1 hint and resolves the specific action +
 * payload. Mirrors the sleep Layer 2 shape (see sleep.config.ts) one-to-one
 * — same ModuleConfig, same tier ladder, same trilingual few-shot
 * convention.
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same rationale that drove body's 70B→120B swap
 *      in commit a81567a 2026-05-30 and the sleep port in 1b0f898.
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the work block in src/router/dump-classify.ts (~line 96):
 *   - log_focus_session   — { durationMin?, project?, skipped_meals? }
 *   - create_task         — { text: REQUIRED, project? }
 *   - log_deadline        — { text: REQUIRED, dueDate? }
 *   - log_meeting         — { with?, durationMin? }
 *   - distraction_journal — { what: REQUIRED }
 *
 * Cross-route hint (already wired in Layer 1 dump-classify and in the
 * native work handler): `log_focus_session.skipped_meals === true` mirrors
 * to `body.log_hunger` (no payload — log_hunger takes {}). Same Approach B
 * convention as sleep's log_insomnia.med_taken → medication.log_dose.
 * The Layer 2 prompt must preserve the hint key when present so the
 * downstream handler can dispatch the mirror.
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type WorkAction =
  | 'log_focus_session'
  | 'create_task'
  | 'log_deadline'
  | 'log_meeting'
  | 'distraction_journal';

export interface WorkClassification {
  action: WorkAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear "90 min
 * deep work" style fragments, simple "need to write the PRD" tasks). When
 * the model returns confidence < ESCALATE_THRESHOLD we re-call with the
 * accurate tier (GPT-OSS 120B — has Groq prompt caching). Same pair as
 * sleep, same threshold, same reasoning.
 */
export const WORK_MODEL_FAST = 'llama-3.1-8b-instant';
export const WORK_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const WORK_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (10 = 2 per action) ────────────────────────
// Mix EN / ES / TR across the set so the model sees all three in context.
// Two examples explicitly demonstrate the skipped_meals cross-route hint so
// the model learns the convention from the few-shot block alone.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: WorkClassification }> = [
  // log_focus_session — EN (duration + project)
  {
    input: '90 min deep work on atelier',
    output: {
      action: 'log_focus_session',
      payload: { durationMin: 90, project: 'atelier' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_focus_session — EN (duration + skipped_meals cross-route hint)
  {
    input: 'deep work 3h forgot lunch',
    output: {
      action: 'log_focus_session',
      payload: { durationMin: 180, skipped_meals: true },
      confidence: 0.94,
      language: 'en',
    },
  },
  // log_focus_session — TR (skipped_meals without explicit duration)
  {
    input: 'hyperfocused all morning, didn\'t eat',
    output: {
      action: 'log_focus_session',
      payload: { skipped_meals: true },
      confidence: 0.92,
      language: 'en',
    },
  },
  // create_task — EN (future intent, no duration)
  {
    input: 'need to write the PRD',
    output: {
      action: 'create_task',
      payload: { text: 'write the PRD' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // create_task — ES (future intent)
  {
    input: 'tengo que escribir el PRD',
    output: {
      action: 'create_task',
      payload: { text: 'escribir el PRD' },
      confidence: 0.94,
      language: 'es',
    },
  },
  // log_deadline — EN (date + work item)
  {
    input: 'PRD due friday',
    output: {
      action: 'log_deadline',
      payload: { text: 'PRD', dueDate: 'friday' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_deadline — TR (date + work item)
  {
    input: 'PRD cuma deadline',
    output: {
      action: 'log_deadline',
      payload: { text: 'PRD', dueDate: 'friday' },
      confidence: 0.93,
      language: 'tr',
    },
  },
  // log_meeting — EN (with + duration)
  {
    input: '30 min sync with boran',
    output: {
      action: 'log_meeting',
      payload: { with: 'boran', durationMin: 30 },
      confidence: 0.95,
      language: 'en',
    },
  },
  // log_meeting — ES (with + duration)
  {
    input: 'reunión con Boran 30 min',
    output: {
      action: 'log_meeting',
      payload: { with: 'Boran', durationMin: 30 },
      confidence: 0.94,
      language: 'es',
    },
  },
  // distraction_journal — EN (reflection on what pulled them away)
  {
    input: 'got sucked into twitter again',
    output: {
      action: 'distraction_journal',
      payload: { what: 'twitter' },
      confidence: 0.93,
      language: 'en',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's work-module Layer 2 AI. The user dumped a fragment that has already been routed to the work module. Pick the most specific work action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- log_focus_session: a PAST-TENSE deep-work / hyperfocus block the user already completed. payload: { durationMin? (number — minutes spent focused, e.g. "90 min" → 90, "3 hours" → 180, "2 saat" → 120), project? (the project/area worked on, lowercase noun like "atelier"/"prd"), skipped_meals? (CROSS-ROUTE HINT — set true ONLY when the user explicitly mentions skipping food during the focus block, like "didn't eat"/"forgot lunch"/"hiç yemedim"/"no comí". Handler mirrors this to body.log_hunger.) }
    Triggers: "deep work", "focused", "hyperfocused", "odaklandım", "odaklı çalıştım", "deep work en…".
- create_task: a FUTURE-INTENT work item the user needs to do. payload: { text (REQUIRED — the task itself, strip the framing verb. "need to write the PRD" → text: "write the PRD" / "tengo que escribir el PRD" → text: "escribir el PRD"), project? }
    Triggers: "need to", "have to", "tengo que", "yapmam lazım", "lazım".
- log_deadline: a work item WITH an explicit date/timeframe. payload: { text (REQUIRED — the work item, NOT the date), dueDate? (preserve user's wording: "friday"/"cuma"/"march 5"/"next tuesday") }
    Triggers: "due", "deadline", "by friday", "cuma deadline", "cuma'ya kadar".
- log_meeting: a meeting with a counterparty. payload: { with? (the other person's name, preserve user's casing for proper nouns: "boran" / "Boran"), durationMin? (number — minutes) }
    Triggers: "sync with", "meeting with", "call with", "reunión con", "toplantı", "boranla".
    NOT for generic appointments (dentist/doctor/DMV — those go to admin). Meetings require a named human counterparty + work context.
- distraction_journal: the user is REFLECTING on something that pulled them away from focus. payload: { what (REQUIRED — what pulled them away, lowercase noun like "twitter"/"slack"/"tiktok") }
    Triggers: "got sucked into", "couldn't stop checking", "me distraje con", "daldım yine".
    NOT triggered by the bare app name alone ("twitter") — there must be a distraction frame.

DISAMBIGUATION:
- log_focus_session vs create_task: focus session is PAST tense + has duration ("90 min on atelier", "deep work 3 hours", "2 saat odaklı çalıştım"). create_task is FUTURE intent ("need to write the PRD", "tengo que…"). When in doubt and no duration is mentioned, prefer create_task.
- log_deadline vs create_task: deadline has a DATE ("PRD due friday", "cuma deadline"). create_task is just the work item with no date. If the user said BOTH the item AND a date, pick log_deadline.
- log_meeting vs admin.schedule_appointment: meeting has a NAMED counterparty + work context. Generic appointments (dentist/doctor) are admin, NOT work. Layer 1 already chose work, so trust it — when the fragment names a person ("with boran"/"con Boran") use log_meeting.
- distraction_journal: requires a reflection frame ("got sucked into twitter again", "couldn't stop checking slack"). The bare word "twitter" alone is too thin — return low confidence (< 0.7) so the router escalates.
- SKIPPED-MEAL detection: be CONSERVATIVE. Only set skipped_meals: true when the user explicitly mentions skipping food during the focus block: "didn't eat", "forgot lunch", "skipped meals", "hiç yemedim", "yemek yemedim", "no comí", "olvidé comer". A bare "hyperfocused all morning" with no food mention → skipped_meals stays unset.

OUTPUT — respond ONLY with the classify_work_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_work_action',
    description: 'Resolve the specific work action + payload for a fragment already routed to the work module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'log_focus_session',
            'create_task',
            'log_deadline',
            'log_meeting',
            'distraction_journal',
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
            // log_focus_session
            durationMin: { type: 'number' },
            project: { type: 'string' },
            skipped_meals: { type: 'boolean' },
            // create_task / log_deadline
            text: { type: 'string' },
            // log_deadline
            dueDate: { type: 'string' },
            // log_meeting
            with: { type: 'string' },
            // distraction_journal
            what: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const workConfig: ModuleConfig<WorkClassification, undefined> = {
  moduleName: 'work',
  canonicalItems: [], // work has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
