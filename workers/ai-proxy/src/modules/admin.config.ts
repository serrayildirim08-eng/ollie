/**
 * admin.config.ts — Module-specific config for `/route/admin` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the admin module
 * with a chosen action. Layer 2 = admin-specific AI that takes the raw
 * fragment and resolves the specific action + payload. Port of finance.config.ts
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
 * Actions mirror the admin block in src/router/dump-classify.ts (~line 98):
 *   - create_task          — { text: REQUIRED }
 *   - create_phone_task    — { person: REQUIRED, reason? }
 *   - schedule_appointment — { what: REQUIRED, date? }
 *   - log_paperwork        — { what: REQUIRED }
 *   - recurring_decision   — { what: REQUIRED }
 *   - log_renewal          — { renewal_type: REQUIRED, due_date? }
 *
 * No cross-route mirror — admin is standalone.
 *
 * Admin is the most action-heavy module (6 actions). Disambiguation rules
 * are encoded explicitly in the system prompt to prevent the model from
 * wavering on edge cases (phone-task vs task, appointment vs task,
 * paperwork vs renewal, recurring_decision over-trigger).
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type AdminAction =
  | 'create_task'
  | 'create_phone_task'
  | 'schedule_appointment'
  | 'log_paperwork'
  | 'recurring_decision'
  | 'log_renewal';

export interface AdminClassification {
  action: AdminAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear "call mom"
 * / "filed taxes" style fragments). When the model returns confidence < 0.7
 * we re-call with the accurate tier (GPT-OSS 120B — has Groq prompt caching).
 * Same pair as sleep/finance, same threshold, same reasoning.
 */
export const ADMIN_MODEL_FAST = 'llama-3.1-8b-instant';
export const ADMIN_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const ADMIN_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (12 = 2 per action × 6 actions) ─────────────
// Distribution: EN×4 + ES×4 + TR×4. Natural everyday phrases.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: AdminClassification }> = [
  // create_task — EN
  {
    input: 'renew library card',
    output: {
      action: 'create_task',
      payload: { text: 'renew library card' },
      confidence: 0.95,
      language: 'en',
    },
  },
  // create_task — TR
  {
    input: 'raporu yaz',
    output: {
      action: 'create_task',
      payload: { text: 'raporu yaz' },
      confidence: 0.94,
      language: 'tr',
    },
  },
  // create_phone_task — EN
  {
    input: 'call mom about christmas',
    output: {
      action: 'create_phone_task',
      payload: { person: 'mom', reason: 'christmas' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // create_phone_task — ES
  {
    input: 'llamar al doctor',
    output: {
      action: 'create_phone_task',
      payload: { person: 'doctor' },
      confidence: 0.96,
      language: 'es',
    },
  },
  // schedule_appointment — EN
  {
    input: 'dentist next tuesday',
    output: {
      action: 'schedule_appointment',
      payload: { what: 'dentist', date: 'next tuesday' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // schedule_appointment — TR
  {
    input: 'dişçi randevusu salı',
    output: {
      action: 'schedule_appointment',
      payload: { what: 'dişçi', date: 'salı' },
      confidence: 0.96,
      language: 'tr',
    },
  },
  // log_paperwork — EN
  {
    input: 'filed taxes',
    output: {
      action: 'log_paperwork',
      payload: { what: 'taxes' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_paperwork — ES
  {
    input: 'entregué la solicitud de visa',
    output: {
      action: 'log_paperwork',
      payload: { what: 'solicitud de visa' },
      confidence: 0.95,
      language: 'es',
    },
  },
  // recurring_decision — EN
  {
    input: 'keep netflix or cancel',
    output: {
      action: 'recurring_decision',
      payload: { what: 'netflix' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // recurring_decision — TR
  {
    input: 'Netflix\'i iptal edeyim mi',
    output: {
      action: 'recurring_decision',
      payload: { what: 'Netflix' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // log_renewal — EN
  {
    input: 'passport expires march',
    output: {
      action: 'log_renewal',
      payload: { renewal_type: 'passport', due_date: 'march' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_renewal — ES
  {
    input: 'renovar pasaporte el mes que viene',
    output: {
      action: 'log_renewal',
      payload: { renewal_type: 'pasaporte', due_date: 'el mes que viene' },
      confidence: 0.95,
      language: 'es',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's admin-module Layer 2 AI. The user dumped a fragment that has already been routed to the admin module. Pick the most specific admin action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- create_task: a generic to-do item with no external party and no specific date/slot. payload: { text (REQUIRED — the task description, preserve user's wording) }
    Triggers: "write the report", "raporu yaz", "hacer el informe", "renew library card" (no one to call, no external appointment slot).
- create_phone_task: a task that requires calling or texting a SPECIFIC PERSON. payload: { person (REQUIRED — the person/entity to contact, lowercase), reason? (string — why, if stated) }
    Triggers: "call mom", "anneyi ara", "llamar a mamá", "ring the doctor", "text Sarah about dinner".
    The person must be explicitly named or implied ("the doctor", "my landlord"). Generic "make a call" → create_task.
- schedule_appointment: booking a specific time slot with an external party (doctor, dentist, mechanic, lawyer, etc.). payload: { what (REQUIRED — appointment type/party, lowercase), date? (string — the stated date/time, preserve user's wording) }
    Triggers: "dentist tuesday", "dişçi randevusu", "cita con el médico", "car service friday".
    Requires BOTH an external party AND a time reference. "dentist" alone (no date) → schedule_appointment with date omitted but still valid. "renew library card" (admin task, no external slot) → create_task.
- log_paperwork: recording that a document/form has been COMPLETED or SUBMITTED (past action). payload: { what (REQUIRED — the document or paperwork type, lowercase) }
    Triggers: "filed taxes", "submitted application", "vergi beyannamesini verdim", "entregué la solicitud".
    Past tense signals completion. Future-oriented → use log_renewal or create_task instead.
- recurring_decision: an explicit "keep or cancel" evaluation for a subscription or recurring service. payload: { what (REQUIRED — the service/subscription name, lowercase) }
    Triggers: "keep netflix or cancel", "should I cancel spotify", "decidir si cancelar Spotify", "Netflix'i iptal edeyim mi".
    ONLY trigger for explicit subscription keep/cancel decisions. "spotify is great" → do NOT use recurring_decision. "I use netflix a lot" → do NOT use recurring_decision.
- log_renewal: an upcoming expiry or required renewal action — something that needs renewing SOON or has a future due date. payload: { renewal_type (REQUIRED — the item type, lowercase), due_date? (string — the stated date/deadline, preserve user's wording) }
    Triggers: "passport expires march", "license due in 2 weeks", "lease renewal next month", "sigorta yenileme", "renovar pasaporte".
    Keywords: "expires", "due", "renew", "renewal", "bitiyor", "yenileme", "vence", "renovar". These keywords signal log_renewal, not log_paperwork.

DISAMBIGUATION:
- "call mom" / "anneyi ara" / "llamar a mamá" → create_phone_task (explicit person). "write the report" → create_task (no person).
- "dentist tuesday" → schedule_appointment (external party + time). "renew library card" → create_task (no external slot booking).
- "filed taxes" → log_paperwork (completed, past tense). "passport expires march" → log_renewal (upcoming expiry with date).
- "passport due march" / "license renews next month" → log_renewal even if phrased ambiguously. The keywords "expires"/"due"/"renew" are decisive.
- "keep netflix or cancel" → recurring_decision. "Netflix is great" / "I use Netflix" → dump_only (caller already routed to admin, so use create_task as closest match if forced, but prefer low confidence to trigger escalation).
- "llamar a mamá el martes" → create_phone_task with person="mamá", reason omitted. The date is part of the task context, not an appointment slot — no external party booking.
- "cita con dentista" → schedule_appointment. "llamar al doctor" → create_phone_task (phone call, not booking a slot).

OUTPUT — respond ONLY with the classify_admin_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_admin_action',
    description: 'Resolve the specific admin action + payload for a fragment already routed to the admin module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'create_task',
            'create_phone_task',
            'schedule_appointment',
            'log_paperwork',
            'recurring_decision',
            'log_renewal',
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
            // create_task
            text: { type: 'string' },
            // create_phone_task
            person: { type: 'string' },
            reason: { type: 'string' },
            // schedule_appointment
            what: { type: 'string' },
            date: { type: 'string' },
            // log_renewal
            renewal_type: { type: 'string' },
            due_date: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const adminConfig: ModuleConfig<AdminClassification, undefined> = {
  moduleName: 'admin',
  canonicalItems: [], // admin has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
