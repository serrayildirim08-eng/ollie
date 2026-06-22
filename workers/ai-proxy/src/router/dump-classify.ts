/**
 * Per-fragment classification · Groq Llama 3.3 70B with JSON mode
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

import { groqChat } from '../groq';
import { jsonCascade, type JsonProviders } from './json-cascade';
import type { FragmentLanguage, Module } from './dump-schema';

// Allowed Module values (enumerated in the system prompt so the model
// stays on the rails even though Groq's JSON mode doesn't enforce a schema).
const MODULES: Module[] = [
  'crisis',
  'work',
  'admin',
  'pets',
  'cycle',
  'finance',
  'sleep',
  'body',
  'mood',
  'habits',
  'goals',
  'grocery',
  'medication',
  'dump_only',
];

// LEAN LAYER 1 ROUTER PROMPT (refactor 2026-06-01).
// Job: fragment → { module, action, confidence, payload }. Pick the right
// MODULE + the right ACTION enum value, and emit cross-module HINT FIELDS
// when applicable. Detailed payload field requirements live in each module's
// Layer 2 config (workers/ai-proxy/src/modules/<module>.config.ts). Do NOT
// re-inline Layer-2 payload schemas here — that ballooned the prompt past
// Groq's 8k TPM ceiling (commit refactor: 36k → ~7k chars).
const SYSTEM_PROMPT = `You are Ollie's brain-dump router (Layer 1). For one fragment: pick MODULE + ACTION + confidence. Detailed payload extraction is Layer 2 — emit only obvious values + the cross-module hint fields named below.

Languages: TR/EN/ES, mixable in one sentence. Classify by intent. Never paraphrase, never refuse.

MODULES → ACTIONS
- crisis: boundary_shown (rare; upstream lexicon catches first)
- work: log_focus_session | create_task | log_deadline | log_meeting | distraction_journal | start_timer
- admin: create_task | create_phone_task | schedule_appointment | log_paperwork | recurring_decision | log_renewal
- pets: log_care | log_observation | log_vet | log_feed | log_supplement
- cycle: log_period_start | log_period_end | log_symptom | pill_logged | set_pregnant | end_pregnancy
- finance: log_transaction | log_income | log_refund | spending_reflection | pending_decision | add_bill | savings_note | subscription_log
- sleep: log_sleep | wind_down_note | dream_log | log_insomnia
- body: log_symptom | log_water | log_supplement | log_episode | log_posture | log_hunger | log_movement
- mood: log_mood | log_energy | self_talk
- habits: complete | identity_statement   (streak_break_note FORBIDDEN; Ollie has no streaks)
- goals: progress_note | create_goal | milestone_hit | obstacle_note
- grocery: pantry_add | pantry_use | pantry_depleted | shopping_list_add | pantry_low_flag | meal_request | recipe_cooked
- medication: log_dose | missed_dose | side_effect_note
- dump_only: archive_only

ROUTING RULES (drive MODULE choice; Layer 2 owns full field extraction)

Purchase / past-tense (bought / got / picked up / aldım / compré / paid for): NEVER create_task, NEVER dump_only.
- Consumable (food/drink/toiletry/cleaning/household) → grocery.pantry_add even with a price (grocery mirrors finance — no separate finance fragment).
- Else (book/electronics/clothes/makeup/furniture/software/service/experience) → finance.log_transaction. Unidentifiable purchase → finance.log_transaction with empty payload.
- Orphan single noun: pantry/bathroom noun ("milk", "oil", "tampons", "toilet paper") → grocery.pantry_add. Non-grocery orphan ("book", "headphones") or filler ("etc", "and", "stuff") → dump_only.
- Compound product names stay one item ("mac and cheese", "salt and pepper", "peanut butter", "half and half").

Finance sub-routing (one fragment → one action):
- log_transaction: one-off non-grocery spend.
- log_income: money IN ("got paid", "deposited", "geldi", "ödediler", "depositaron", "me pagaron", "maaş", "paycheck"). NOT a refund.
- log_refund: money came back ("refunded", "returned the X", "iade aldım", "me devolvieron").
- spending_reflection: PATTERN, not one event. Markers: "too much"/"demasiado"/"çok", "always", "again", Nth-time, "keep buying", "forgot to cancel … again".
- pending_decision: money NOT yet spent. Markers: "should I…", "thinking about…", "quote", "deposit" (no payment verb), "comprar o no", "almalı mıyım", "got a quote".
- add_bill: recurring fixed expense ("rent $1800/month", "kira aylık").
- subscription_log: streaming / software / app ("renewed spotify").
- savings_note: transfer to savings ("moved 500 to savings", "ahorré").

Work vs admin:
- CLIENT/professional deliverable → work. Signals: name-possessive over a deliverable ("yeo's ds forms", "smith contract"), named client/matter/case, billable output. Even when words "forms"/"paperwork"/"application"/"docs" appear, client-facing → work.
- PERSONAL life-admin → admin (user's OWN passport, taxes, dentist, registration).
- DEADLINE PRESERVATION: client deliverable + due date → work.log_deadline (keep text + dueDate). Client deliverable with no date → work.create_task. NEVER admin.log_paperwork for anything dated (it has no date field).

Other module-choice hints:
- sleep.log_insomnia (didn't sleep) vs sleep.log_sleep quality=1 (slept badly).
- admin.log_renewal (paperwork w/ expiry) vs admin.recurring_decision (cancel-or-keep).
- grocery FUTURE intent to acquire ("need to buy", "have to get", "need", "pick up", "buy", "get me", "gotta grab", "almam lazım", "lazım", "comprar", "tengo que comprar") → shopping_list_add — EVEN for household/cleaning/toiletry items (trash bags, detergent, paper towels, toilet paper). Future intent OVERRIDES the consumable→pantry_add rule (that rule is for PAST purchases only).
- grocery.pantry_low_flag ("running low") vs shopping_list_add ("need to buy") vs pantry_depleted ("out of"/"ran out"/"bitti"/"se acabó") vs pantry_add (PAST "bought/got/picked up").
- pets.log_supplement (named vitamin/calcium) vs pets.log_care (generic).
- body.log_movement covers ALL physical activity (walk/run/yoga/lift/stretch/swim).
- MOOD vs body vs habits (mood owns feelings/energy/self-talk):
  · Transient EMOTION (anxious, sad, happy, numb, overwhelmed, scared, "X is scaring me", "did nothing today" as a feeling) → mood.log_mood { label, valence:"pos"|"neu"|"neg" }.
  · ENERGY state (tired, exhausted, drained, wired, "no energy", "running on empty") → mood.log_energy { level:"low"|"mid"|"high", label }. NOT body — body is PHYSICAL symptoms only (headache, cramp, nausea, dizzy, sore).
  · SELF-TALK / self-evaluation ("don't like myself", "I'm failing", "I'm lazy", "habits all empty this week", "hate myself") → mood.self_talk { statement, valence:"pos"|"neg" }.
  · habits.identity_statement is now ONLY a DELIBERATE positive identity goal ("I'm becoming someone who reads daily"). Negative self-judgment → mood.self_talk, NOT habits.
- cycle.pill_logged is BIRTH CONTROL pill. Generic Rx → medication.log_dose.
- habits.streak_break_note FORBIDDEN. "Broke X habit" / "missed 5 days" said as self-judgment → mood.self_talk; as neutral observation → dump_only. NEVER identity_statement for negative habit talk.
- TIME-DEFERRED REMINDER ("remind me to X in N", "Y dakika sonra hatırlat", "recuérdame X en N"): classify by what to do (e.g. "remind me to call mama in 1 min" → admin.create_phone_task person="mama"), add top-level \`remindIn: { amount: number, unit: "sec"|"min"|"hr"|"day" }\`. Never a separate reminder fragment, never dump_only when remindIn present. "Remind me to take <med> in N" → admin.create_task text="take <med>" + remindIn (NOT medication.log_dose — that is past-tense).

CROSS-MODULE HINT FIELDS (Layer 1 emits hint on payload; primary handler mirrors to secondary — never emit a separate fragment):
- body.log_movement → \`pet\` (proper noun like "buddy"/"tontin"; omit for species-only "the dog") → mirrors pets.log_care.
- sleep.log_insomnia → \`med_taken\` (e.g. "melatonin") + optional \`med_dose\` → mirrors medication.log_dose.
- work.log_focus_session → \`skipped_meals: true\` ONLY when hyperfocus is explicitly paired with not eating ("didn't eat"/"forgot lunch"/"hiç yemedim"/"no comí") → mirrors body.log_hunger.
- finance.log_transaction → \`renewal_for\` ("passport"|"license"|"visa"|"lease"|"insurance"|"id"|"work_permit"|"residency_permit") ONLY when the fragment names the document ("passport fee", "vize ücreti", "lease deposit paid") → mirrors admin.log_renewal. Generic "expedite fee 89" → plain log_transaction.
- grocery.pantry_add → \`price\` + \`currency\` when stated → mirrors finance.log_transaction.
- admin.create_task / admin.create_phone_task / work.create_task → \`remindIn\` (per TIME-DEFERRED REMINDER).

NEGATION: "did NOT take" / "skipped" / "almadım" / "no tomé" → medication.missed_dose. "no comí nada" → body.log_hunger.

RETROSPECTIVE: when the fragment references a past day ("dün"/"yesterday"/"3 days ago"/"ayer"), add \`daysAgo: number\` to payload.

CRISIS: ONLY for unambiguous suicidal ideation, self-harm intent, or method-seeking. NOT sadness/venting/anger. payload: \`{ tier: 2 | 3 }\` (2=ideation, 3=method-seeking). Confidence must be ≥ 0.9; otherwise pick dump_only.

RESPONSE FORMAT — return ONLY a valid JSON object, no prose, no markdown, no code fences. The object MUST contain ALL FOUR keys (module, action, confidence, payload) every time. Never omit a key. Never return an empty string. If you have no payload fields, return payload: {}.

{
  "module": one of [${MODULES.join(', ')}],
  "action": one of that module's actions for the chosen module,
  "confidence": a number between 0 and 1,
  "payload": an object with the obvious fields extracted from the fragment, plus any cross-module hint field listed above, plus optional daysAgo, plus optional remindIn. Use {} when no fields apply.
}

MINI EXAMPLES:
- "90 min deep work on atelier" → work.log_focus_session { durationMin:90, project:"atelier" }
- "fill yeo's ds forms, due tuesday" → work.log_deadline { text:"fill yeo's ds forms", dueDate:"tuesday" }
- "remind me to call mama in 1 minute" → admin.create_phone_task { person:"mama", remindIn:{ amount:1, unit:"min" } }
- "fed tontin" → pets.log_feed { petName:"tontin" }
- "hamileyim" → cycle.set_pregnant {}
- "spent $40 at sephora" → finance.log_transaction { amount:40, currency:"USD", merchant:"sephora" }
- "maaş geldi" → finance.log_income { source:"salary" }
- "couldn't sleep so took melatonin" → sleep.log_insomnia { med_taken:"melatonin" }
- "slept 6 hours last night" → sleep.log_sleep { hours:6 }   (a plain duration, no insomnia signal, is STILL a sleep log — never dump_only)
- "i slept 6 hours last night i feel tired" → TWO fragments: sleep.log_sleep { hours:6 } + mood.log_energy { level:"low", label:"tired" }
- "walked buddy 30 min" → body.log_movement { type:"walk", duration_min:30, pet:"buddy" }
- "meditation done" → habits.complete { habitName:"meditation" }
- "so tired today" → mood.log_energy { level:"low", label:"tired" }
- "feeling really anxious" → mood.log_mood { label:"anxious", valence:"neg" }
- "i don't like myself" → mood.self_talk { statement:"don't like myself", valence:"neg" }
- "want to run a half marathon" → goals.create_goal { what:"run a half marathon" }
- "bought milk" → grocery.pantry_add { item:"milk" }
- "i need to buy large trash bags" → grocery.shopping_list_add { item:"large trash bags" }
- "have to get more detergent" → grocery.shopping_list_add { item:"detergent" }
- "out of lemons" → grocery.pantry_depleted { item:"lemons" }
- "took 50mg sertraline" → medication.log_dose { medName:"sertraline", dose:"50mg" }
- "ugh today is weird" → dump_only.archive_only { reason:"no_module_match" }

Confidence < 0.6 → dump_only.`;

// Sanity guardrail: log Layer 1 prompt size at module load so a future regression
// (someone re-inlining Layer-2 payload schemas) shows up in CF Workers logs and
// CI captures. Target after 2026-06-01 refactor: ≤ 8000 chars (~2.5k tokens).
console.log(`[Layer1] dump-classify SYSTEM_PROMPT chars=${SYSTEM_PROMPT.length}`);

export interface ClassifyResult {
  module: Module;
  payload: Record<string, unknown>;
  confidence: number;
}

/**
 * Confidence the router falls back to when the model returns a non-numeric /
 * NaN / missing confidence. The floor of the needs-confirm band (0.60), so a
 * parse glitch surfaces the fragment for confirmation instead of demoting it
 * to dump_only (silent data loss — audit #5a).
 */
export const UNCERTAIN_CONFIDENCE = 0.6;

/**
 * Coerce a model-supplied confidence into a safe [0,1] number. A real finite
 * number is clamped; anything else (string, NaN, undefined) becomes
 * UNCERTAIN_CONFIDENCE — NEVER 0, which would discard a possibly-correct route.
 */
export function normalizeConfidence(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.min(1, Math.max(0, v));
  return UNCERTAIN_CONFIDENCE;
}

export async function classifyFragment(
  fragmentText: string,
  language: FragmentLanguage,
  apiKey: string,
): Promise<ClassifyResult> {
  const userMessage = `Fragment language: ${language}\nFragment: ${fragmentText}`;

  const choice = await groqChat(
    {
      apiKey,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      jsonMode: true,
      maxTokens: 512,
    },
    'classify',
  );

  const rawText = choice.message.content ?? '';
  if (!rawText) {
    throw new Error(
      `classify groq empty content (finish=${choice.finish_reason})`,
    );
  }

  let parsed: {
    module: Module;
    action: string;
    confidence: number;
    payload: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`classify groq bad json: ${rawText.slice(0, 300)}`);
  }

  return {
    module: parsed.module,
    payload: { ...parsed.payload, module: parsed.module, action: parsed.action },
    confidence: normalizeConfidence(parsed.confidence),
  };
}

/** Parse a `{ results: [...] }` batch payload into ClassifyResults. Throws on
 *  malformed JSON or a count that doesn't match the request, so the caller
 *  never silently misaligns classifications to fragments. */
function parseBatchResults(rawText: string, expected: number, provider: string): ClassifyResult[] {
  let parsed: {
    results?: Array<{
      module: Module;
      action: string;
      confidence: number;
      payload: Record<string, unknown>;
    }>;
  };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`classify-batch ${provider} bad json: ${rawText.slice(0, 300)}`);
  }

  const results = parsed?.results;
  if (!Array.isArray(results) || results.length !== expected) {
    const got = Array.isArray(results) ? results.length : 'none';
    throw new Error(`classify-batch ${provider} count mismatch: got ${got} want ${expected}`);
  }

  return results.map((r) => ({
    module: r.module,
    payload: { ...r.payload, module: r.module, action: r.action },
    confidence: normalizeConfidence(r.confidence),
  }));
}

/**
 * Classify one or more fragments in a SINGLE upstream call.
 *
 * The ~4k-token SYSTEM_PROMPT is the dominant token cost; sending it once per
 * dump instead of once per fragment turns a 3-fragment dump from ~12k tokens
 * (3 separate calls) into ~4.5k (one batched call) — the difference between a
 * reliable 502 and a working dump on Groq's free tier (8k tokens/minute).
 *
 * Provider strategy (free-tier, no paid Groq Dev Tier):
 *   - PRIMARY: Groq gpt-oss-120b — fast, but only 8k tokens/min.
 *   - FALLBACK: Gemini 2.5 Flash — ~31× the TPM (250k/min) so it absorbs
 *     overflow when Groq returns 429 (or a transient 5xx). Stacking the two
 *     free tiers covers far more throughput than either alone. Gemini is
 *     skipped if `keys.gemini` is absent (then a Groq 429 bubbles up so the
 *     caller can surface a soft rate-limit message).
 *
 * Output order matches input order; a count mismatch throws.
 */
/** @deprecated alias — the cascade now lives in `json-cascade.ts`. Kept so
 *  existing callers (`classifyBatch(..., providers)`) read unchanged. */
export type ClassifyProviders = JsonProviders;

export async function classifyBatch(
  items: Array<{ text: string; language: FragmentLanguage }>,
  providers: ClassifyProviders,
): Promise<ClassifyResult[]> {
  if (items.length === 0) return [];

  const list = items
    .map((it, i) => `[${i}] (lang=${it.language}) ${it.text}`)
    .join('\n');
  const userMessage =
    `You are given ${items.length} fragment(s) below, one per line, each prefixed with its index [i].\n` +
    `Classify EACH fragment independently using the rules above.\n` +
    `IGNORE the single-object response instruction above. Instead respond with a JSON object EXACTLY of the form:\n` +
    `{ "results": [ { "module": ..., "action": ..., "confidence": ..., "payload": {...} } ] }\n` +
    `The results array MUST contain exactly ${items.length} object(s), in the SAME order as the input indices.\n\n` +
    `Fragments:\n${list}`;

  const maxTokens = 256 * items.length + 256;

  // Free-tier cascade (Groq → Cloudflare → Gemini → OpenRouter). A provider
  // that errors OR returns a body `parseBatchResults` rejects (bad JSON /
  // count mismatch) advances to the next; the last provider's error bubbles
  // up so the caller can map a final 429/503 to a soft "rate_limited".
  return jsonCascade(
    { system: SYSTEM_PROMPT, user: userMessage, maxTokens, label: 'classify-batch' },
    providers,
    (rawText, provider) => parseBatchResults(rawText, items.length, provider),
  );
}
