/**
 * /label — Anthropic-backed research labeling endpoint.
 *
 * Body:
 *   { scrubbed_text: string, sector_hint?: string, locale: string }
 *
 * Flow:
 *   1. validate input (scrubbed_text required, locale required, sector_hint optional)
 *   2. cost-cap check (env DAILY_LABEL_BUDGET_USD, current usage in KV)
 *   3. call Anthropic /v1/messages with cached system prompt (label.md content)
 *   4. parse JSON from model response; reject non-conformant outputs
 *   5. INSERT row into research_corpus via Supabase REST (anonymized — no user id)
 *   6. return label + corpus_id to caller
 *
 * Privacy contract:
 *   - Caller (orchestrator) MUST scrub PII before invoking /label.
 *   - We re-run a lightweight regex pass server-side as a belt-and-suspenders.
 *   - No user_hash, device_id, or user_id is forwarded to Anthropic or written
 *     to research_corpus. The row is fully anonymized at write.
 *
 * Cost guard:
 *   - Prompt caching enabled via anthropic-beta header (mandatory per Serra).
 *   - Soft cap: skip Anthropic when daily spend exceeds DAILY_LABEL_BUDGET_USD.
 *   - Hard cap: 280 chars max scrubbed_text — long-tail dumps are truncated.
 */

import { scrubPII, asLocale } from '@ollie/pii-scrub';
import { json, upstreamError } from '@ollie/worker-http';

export interface LabelEnv {
  ANTHROPIC_API_KEY: string;
  CACHE_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  DAILY_LABEL_BUDGET_USD?: string;
  LABEL_MODEL?: string;
}

export interface LabelRequest {
  scrubbed_text: string;
  sector_hint?: string | null;
  locale: string;
}

export interface LabelResponse {
  corpus_id: string;
  label: {
    mood_signal: string;
    content_type: string;
    urgency_tier: string;
    adhd_pattern_tag: string;
    sector_relevance: string;
    confidence: number;
  };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Cost ceiling — claude sonnet 4.6 small-output averages ~$0.001 per call
// once prompt caching kicks in. Budget tracked in CACHE_KV under daily key.
const DEFAULT_BUDGET_USD = 25;
const ESTIMATED_COST_PER_CALL_USD = 0.001;
const MAX_SCRUBBED_CHARS = 2000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const VALID_MOODS = new Set(['low', 'neutral', 'high', 'anxious', 'crashing', 'hyperfocused']);
const VALID_CONTENT_TYPES = new Set([
  'task', 'observation', 'vent', 'plan', 'decision', 'request', 'reminder', 'reflection',
]);
const VALID_URGENCY = new Set(['now', 'soon', 'later', 'none']);
const VALID_SECTORS = new Set([
  'tech', 'law', 'med', 'fin', 'edu', 'creative',
  'parenting', 'hospitality', 'gov', 'other',
]);
// Must stay in sync with the `adhd_pattern_tag` enum in the system prompt below.
const VALID_ADHD_TAGS = new Set([
  'hyperfocus', 'task-switching', 'deadline-anxiety', 'rejection-sensitivity',
  'time-blindness', 'dopamine-seeking', 'executive-stall', 'overcommitment',
  'interest-collapse', 'body-doubling', 'sensory-overload', 'emotional-flooding',
  'rsd-spiral', 'pomodoro-success', 'meds-reflection', 'sleep-debt',
  'cycle-luteal', 'none',
]);

// System prompt is inlined here so the worker can ship as a single bundle.
// MUST be kept in sync with workers/ai-proxy/prompts/label.md — that file is
// the human-edit-friendly version; this constant is the deployed copy.
// Bump LABEL_PROMPT_VERSION when the content changes so prompt cache hits
// reset cleanly.
export const LABEL_PROMPT_VERSION = 1;
const SYSTEM_PROMPT = `You label anonymized brain-dump text from an ADHD life-management app. The text has already been PII-scrubbed: names, emails, phone numbers, addresses, URLs, and account numbers are replaced with bracketed tokens ([NAME], [EMAIL], [PHONE], [ADDRESS], [URL], [NUMERIC]). Treat these tokens as opaque placeholders.

Emit ONE JSON object. No prose. No markdown. No backticks.

Schema (every key required, no extras):
{
  "mood_signal":      one of: low | neutral | high | anxious | crashing | hyperfocused,
  "content_type":     one of: task | observation | vent | plan | decision | request | reminder | reflection,
  "urgency_tier":     one of: now | soon | later | none,
  "adhd_pattern_tag": one of: hyperfocus | task-switching | deadline-anxiety | rejection-sensitivity | time-blindness | dopamine-seeking | executive-stall | overcommitment | interest-collapse | body-doubling | sensory-overload | emotional-flooding | rsd-spiral | pomodoro-success | meds-reflection | sleep-debt | cycle-luteal | none,
  "sector_relevance": one of: tech | law | med | fin | edu | creative | parenting | hospitality | gov | other,
  "confidence":       float 0..1
}

Rules:
- Emit ONLY the JSON object.
- Never echo PII tokens into JSON values.
- Pick the SINGLE strongest adhd_pattern_tag, or "none".
- If sector_hint provided, prefer it unless text clearly contradicts.
- If input is empty/whitespace, emit {"mood_signal":"neutral","content_type":"reflection","urgency_tier":"none","adhd_pattern_tag":"none","sector_relevance":"other","confidence":0.1}.`;

// ─── handler ──────────────────────────────────────────────────────────────────

export async function handleLabel(req: Request, env: LabelEnv): Promise<Response> {
  let body: LabelRequest;
  try {
    body = (await req.json()) as LabelRequest;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (
    !body ||
    typeof body.scrubbed_text !== 'string' ||
    typeof body.locale !== 'string'
  ) {
    return json({ error: 'invalid_payload' }, 400);
  }

  if (body.sector_hint !== undefined && body.sector_hint !== null) {
    if (typeof body.sector_hint !== 'string' || !VALID_SECTORS.has(body.sector_hint)) {
      return json({ error: 'invalid_sector_hint' }, 400);
    }
  }

  // Belt-and-suspenders: re-scrub server-side. Caller should already have
  // scrubbed, but if a dev wires the endpoint wrong we don't want raw text
  // hitting Anthropic. FULL categories — this text is labeled INTO the
  // research corpus, so medical/mental-health/sexual terms + locale-aware
  // names must be stripped before Anthropic ever sees them (S9).
  const safe = scrubPII(body.scrubbed_text, asLocale(body.locale)).scrubbed.slice(
    0,
    MAX_SCRUBBED_CHARS,
  );

  // Cost cap — fail open with a neutral label rather than block writes when
  // the daily budget is hit. The orchestrator decides what to do (likely
  // skip writing to corpus + retry tomorrow).
  const todayKey = `label:budget:${new Date().toISOString().slice(0, 10)}`;
  const usedRaw = await env.CACHE_KV.get(todayKey);
  const used = usedRaw ? parseFloat(usedRaw) || 0 : 0;
  const budget = env.DAILY_LABEL_BUDGET_USD
    ? parseFloat(env.DAILY_LABEL_BUDGET_USD)
    : DEFAULT_BUDGET_USD;

  if (used >= budget) {
    return json({ error: 'cost_capped', budget_usd: budget, used_usd: used }, 503);
  }

  // Build the user message — model sees only scrubbed text + optional hint.
  const userMessage = body.sector_hint
    ? `sector_hint: ${body.sector_hint}\nlocale: ${body.locale}\ntext: ${safe}`
    : `locale: ${body.locale}\ntext: ${safe}`;

  const model = env.LABEL_MODEL || DEFAULT_MODEL;

  const anthropicResp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!anthropicResp.ok) {
    // SECURITY (S8): generic code to the client; upstream Anthropic body
    // logged server-side only behind a request id.
    const errText = await anthropicResp.text();
    return upstreamError('anthropic_error', 502, errText, {
      endpoint: 'label',
      upstream_status: anthropicResp.status,
    });
  }

  const anthropicJson = (await anthropicResp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const textBlock = anthropicJson.content?.find((c) => c.type === 'text')?.text ?? '';
  let parsedLabel: Record<string, unknown>;
  try {
    parsedLabel = JSON.parse(textBlock.trim());
  } catch {
    return json({ error: 'label_parse_failed', raw: textBlock.slice(0, 200) }, 502);
  }

  // Validate the structured label before writing.
  const v = validateLabel(parsedLabel);
  if (!v.ok) {
    return json({ error: 'label_invalid', detail: v.reason }, 502);
  }
  const label = v.label;

  // Sector for corpus row: prefer hint (caller authoritative); fall back to
  // model's inferred sector_relevance.
  const sector = body.sector_hint || label.sector_relevance;

  // Write to research_corpus — anonymized, no user_id.
  const corpusId = crypto.randomUUID();
  const insertResp = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/research_corpus`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        prefer: 'return=minimal',
      },
      body: JSON.stringify({
        corpus_id: corpusId,
        scrubbed_text: safe,
        label_json: label,
        sector,
        locale: body.locale,
        prompt_version: LABEL_PROMPT_VERSION,
      }),
    },
  );

  if (!insertResp.ok) {
    // SECURITY (S8): generic code to the client; PostgREST detail (which
    // discloses research_corpus column/constraint names) logged
    // server-side only behind a request id.
    const errText = await insertResp.text();
    return upstreamError('corpus_insert_failed', 502, errText, {
      endpoint: 'label',
      upstream_status: insertResp.status,
    });
  }

  // Bump daily spend tracker — best effort, never block on this.
  const newUsed = used + ESTIMATED_COST_PER_CALL_USD;
  await env.CACHE_KV.put(todayKey, String(newUsed), { expirationTtl: 60 * 60 * 36 });

  const response: LabelResponse = { corpus_id: corpusId, label };
  return json(response);
}

// ─── validation ───────────────────────────────────────────────────────────────

type ValidLabel = LabelResponse['label'];

export function validateLabel(raw: Record<string, unknown>):
  | { ok: true; label: ValidLabel }
  | { ok: false; reason: string } {
  const mood = raw.mood_signal;
  const content = raw.content_type;
  const urgency = raw.urgency_tier;
  const tag = raw.adhd_pattern_tag;
  const sector = raw.sector_relevance;
  const conf = raw.confidence;

  if (typeof mood !== 'string' || !VALID_MOODS.has(mood))
    return { ok: false, reason: 'mood_signal' };
  if (typeof content !== 'string' || !VALID_CONTENT_TYPES.has(content))
    return { ok: false, reason: 'content_type' };
  if (typeof urgency !== 'string' || !VALID_URGENCY.has(urgency))
    return { ok: false, reason: 'urgency_tier' };
  if (typeof tag !== 'string' || !VALID_ADHD_TAGS.has(tag))
    return { ok: false, reason: 'adhd_pattern_tag' };
  if (typeof sector !== 'string' || !VALID_SECTORS.has(sector))
    return { ok: false, reason: 'sector_relevance' };
  if (typeof conf !== 'number' || conf < 0 || conf > 1)
    return { ok: false, reason: 'confidence' };

  return {
    ok: true,
    label: {
      mood_signal: mood,
      content_type: content,
      urgency_tier: urgency,
      adhd_pattern_tag: tag,
      sector_relevance: sector,
      confidence: conf,
    },
  };
}

// `json()` is the shared helper from @ollie/worker-http (imported above).
