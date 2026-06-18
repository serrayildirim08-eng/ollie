/**
 * Queue drain handler — pulls PII-scrubbed brain-dumps from CACHE_KV,
 * calls Anthropic Haiku 4.5 to extract structured signals, then INSERTs
 * one row into raw_dumps and one into enriched_signals.
 *
 * Runs every 5 minutes via the every-5-minutes cron schedule. Cap of 50 dumps per
 * run keeps us well inside the worker CPU/wall-clock limits even when
 * the Anthropic API is slow.
 *
 * Retry policy:
 *   - On any failure (Anthropic OR Supabase) we LEAVE the KV entry intact.
 *   - The KV TTL (3 days, set by enrich-dump) gives natural drop-dead.
 *   - We track retry counts via a sibling `qretry:enrich:<id>` counter
 *     (deliberately NOT under `q:enrich:` so the BATCH_CAP scan skips it).
 *     After 12 retries (~1 hour) we copy the payload to `dlq:enrich:<id>`
 *     and delete the live entry so it stops re-queueing.
 *
 * Intentional choices:
 *   - We do NOT call our own ai-proxy /brain-dump — calling Anthropic
 *     directly is one fewer hop, and prompt-caching wouldn't help here
 *     because each dump's user text is unique. We do still include a
 *     stable system prompt with ephemeral cache_control to amortize the
 *     system tokens across the batch.
 *   - We UPSERT raw_dumps first (on the `id` primary key), then INSERT
 *     enriched_signals (FK), then DELETE the KV entry / ack the message.
 *     If we crash between the raw write and the signal write, the retry
 *     re-runs processOne — the raw_dumps write is an idempotent upsert
 *     keyed on `dump.id`, so it merges instead of inserting a duplicate
 *     row (audit item #12). enriched_signals stays a plain INSERT: a
 *     duplicate there would need its own dedup key, but in practice a
 *     retry only re-reaches it after the raw upsert succeeds, and the
 *     enriched write either fully succeeded last time (then the KV entry
 *     was already deleted / message acked) or fully failed.
 */

// ─── env ──────────────────────────────────────────────────────────────────────

export interface DrainEnv {
  CACHE_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  AI_PROXY: Fetcher;
}

// ─── shapes ───────────────────────────────────────────────────────────────────

export interface QueuedDumpPayload {
  user_hash: string;
  device_id: string;
  event_ts: string;
  locale: string;
  country: string;
  modality: 'voice' | 'text' | 'paste';
  scrubbed_text: string;
  char_count: number;
  routing_module: string | null;
  app_version: string;
}

export interface QueuedDump {
  id: string;
  payload: QueuedDumpPayload;
  queued_at: string;
}

export interface EnrichedSignals {
  sectors: string[];
  brands: string[];
  topic: string | null;
  sentiment: string | null;
  intent: string | null;
  urgency: string | null;
  demographic_hints: Record<string, unknown> | null;
}

const QUEUE_PREFIX = 'q:enrich:';
// Disjoint from QUEUE_PREFIX (audit #42). If retry counters lived under
// `q:enrich:` they'd be returned by `list({ prefix: QUEUE_PREFIX })` and eat
// the BATCH_CAP budget, starving real payloads under backlog. A separate
// top-level prefix keeps them out of the scan entirely.
const RETRY_PREFIX = 'qretry:enrich:';
const DLQ_PREFIX = 'dlq:enrich:';
const MAX_RETRIES = 12;
const BATCH_CAP = 50;

// Haiku 4.5 — pricing as of 2026-05. Used for the per-call cost log row.
// Source: https://www.anthropic.com/pricing (Haiku 4.5)
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_INPUT_PER_MTOK_USD = 1.0;
const HAIKU_OUTPUT_PER_MTOK_USD = 5.0;

// notif-scope-allow — LLM system prompt. Categorizer, not a push channel.
const ENRICH_SYSTEM_PROMPT = `You are a privacy-preserving categorizer for an ADHD productivity app's anonymized brain-dump stream.

INPUT: one short text. It has already been PII-scrubbed (names → [NAME], phones → [PHONE], emails → [EMAIL], addresses → [ADDRESS], GPS → [GPS]). Brand names are intentionally kept — they are the highest-value signal.

YOUR JOB: return ONE JSON object with these exact keys:
{
  "sectors": string[],                  // industry tags, e.g. ["fintech","cpg","health"]. 0-4 items, lowercase, snake_case.
  "brands": string[],                   // brand mentions, lowercase. 0-6 items. omit generic words.
  "topic": string | null,               // one snake_case slug, e.g. "subscription_forgot_cancel", "morning_routine_miss".
  "sentiment": "joyful" | "calm" | "neutral" | "frustrated" | "anxious" | "sad" | "angry" | "overwhelmed",
  "intent": "cancel" | "remind" | "vent" | "plan" | "purchase" | "research" | "log" | "seek_help" | null,
  "urgency": "low" | "medium" | "high",
  "demographic_hints": object | null    // best-guess only, e.g. {"age_band":"25-34"} — null if no evidence.
}

CRITICAL PRIVACY RULE: do NOT echo any PII in any field. If you detect any human name, phone number, email, postal address, or GPS coordinate in the input that survived the regex scrubber, replace it with [NAME], [PHONE], [EMAIL], [ADDRESS], or [GPS] respectively before using it. Never paste raw PII into "topic", "brands", or anywhere else.

Return ONLY the JSON object. No prose, no markdown fences.`;

// ─── orchestrator ─────────────────────────────────────────────────────────────

export async function drainEnrichQueue(env: DrainEnv): Promise<{
  scanned: number;
  succeeded: number;
  failed: number;
  dlq: number;
}> {
  let scanned = 0;
  let succeeded = 0;
  let failed = 0;
  let dlq = 0;

  const list = await env.CACHE_KV.list({ prefix: QUEUE_PREFIX, limit: BATCH_CAP });

  for (const entry of list.keys) {
    // Safety net: retry counters now use a disjoint prefix (audit #42) so the
    // list above never returns them, but keep the guard in case a legacy
    // `q:enrich:retry:*` key lingers in KV from before the prefix change.
    if (entry.name.startsWith(RETRY_PREFIX) || entry.name.startsWith('q:enrich:retry:')) continue;
    scanned++;

    const raw = await env.CACHE_KV.get(entry.name);
    if (!raw) continue;

    let parsed: QueuedDump;
    try {
      parsed = JSON.parse(raw) as QueuedDump;
    } catch {
      // Corrupt entry — move to DLQ so a human can look.
      await env.CACHE_KV.put(`${DLQ_PREFIX}corrupt:${entry.name}`, raw, {
        expirationTtl: 60 * 60 * 24 * 14, // 2 weeks
      });
      await env.CACHE_KV.delete(entry.name);
      dlq++;
      continue;
    }

    try {
      await processOne(env, parsed);
      await env.CACHE_KV.delete(entry.name);
      await env.CACHE_KV.delete(`${RETRY_PREFIX}${parsed.id}`);
      succeeded++;
    } catch (err) {
      console.error(`[drain] entry ${parsed.id} failed:`, String(err));
      failed++;
      const retries = await bumpRetry(env.CACHE_KV, parsed.id);
      if (retries >= MAX_RETRIES) {
        // Move to DLQ. Use a 14d TTL so Serra has time to inspect.
        await env.CACHE_KV.put(`${DLQ_PREFIX}${parsed.id}`, raw, {
          expirationTtl: 60 * 60 * 24 * 14,
          metadata: { last_error: String(err).slice(0, 200) },
        });
        await env.CACHE_KV.delete(entry.name);
        await env.CACHE_KV.delete(`${RETRY_PREFIX}${parsed.id}`);
        dlq++;
      }
      // else: leave the entry, retry on the next 5-min tick.
    }
  }

  return { scanned, succeeded, failed, dlq };
}

// ─── Cloudflare Queues consumer (item #4) ──────────────────────────────────────
//
// When the [[queues.consumers]] binding is configured, Cloudflare delivers
// batches of QueuedDump messages here. We process each message and either
// `ack()` it (success) or `retry()` it (failure) — the Queue itself owns
// retry/backoff and the DLQ, so the hand-rolled `q:enrich:retry:*` counter
// and `dlq:enrich:*` keys are no longer needed on this path.
//
// This is wired but DOES NOT take effect until `wrangler queues create` has
// been run and the wrangler.toml producer/consumer blocks are uncommented.
// Until then the worker keeps using `drainEnrichQueue` (the KV-scan path).

export async function handleEnrichQueueBatch(
  batch: MessageBatch<QueuedDump>,
  env: DrainEnv,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processOne(env, message.body);
      message.ack();
    } catch (err) {
      console.error(`[queue:enrich] message ${message.body?.id} failed:`, String(err));
      // retry() hands the message back to the Queue; after max_retries
      // (set in wrangler.toml) the Queue moves it to the configured DLQ.
      message.retry();
    }
  }
}

// ─── per-entry pipeline ───────────────────────────────────────────────────────

async function processOne(env: DrainEnv, dump: QueuedDump): Promise<void> {
  const t0 = Date.now();
  const { signals, costUsd, model } = await callAnthropic(env, dump.payload.scrubbed_text);
  const latencyMs = Date.now() - t0;

  // INSERT raw_dumps first so enriched_signals' FK resolves.
  const dumpId = await insertRawDump(env, dump);
  await insertEnrichedSignal(env, {
    dump_id: dumpId,
    user_hash: dump.payload.user_hash,
    signals,
    enrichment_model: model,
    enrichment_cost_usd: costUsd,
    enrichment_latency_ms: latencyMs,
  });
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

interface AnthropicResponse {
  content?: Array<{ text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callAnthropic(
  env: DrainEnv,
  scrubbedText: string,
): Promise<{ signals: EnrichedSignals; costUsd: number; model: string }> {
  const resp = await env.AI_PROXY.fetch('https://ai-proxy.internal/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-user-id': 'cron-drain',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 300,
      system: [
        {
          type: 'text',
          text: ENRICH_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: scrubbedText }],
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error(`[anthropic] ${resp.status} body=${errBody.slice(0, 300)}`);
    throw new Error(`anthropic_${resp.status}`);
  }

  const data = (await resp.json()) as AnthropicResponse;
  const raw = data?.content?.[0]?.text ?? '';
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed: Partial<EnrichedSignals>;
  try {
    parsed = JSON.parse(stripped) as Partial<EnrichedSignals>;
  } catch {
    throw new Error('anthropic_unparseable');
  }

  const signals: EnrichedSignals = {
    sectors: Array.isArray(parsed.sectors) ? parsed.sectors.slice(0, 4).filter((s): s is string => typeof s === 'string') : [],
    brands: Array.isArray(parsed.brands) ? parsed.brands.slice(0, 6).filter((s): s is string => typeof s === 'string') : [],
    topic: typeof parsed.topic === 'string' ? parsed.topic : null,
    sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : null,
    intent: typeof parsed.intent === 'string' ? parsed.intent : null,
    urgency: typeof parsed.urgency === 'string' ? parsed.urgency : null,
    demographic_hints:
      parsed.demographic_hints && typeof parsed.demographic_hints === 'object' && !Array.isArray(parsed.demographic_hints)
        ? (parsed.demographic_hints as Record<string, unknown>)
        : null,
  };

  const inTok = data?.usage?.input_tokens ?? 0;
  const outTok = data?.usage?.output_tokens ?? 0;
  const costUsd =
    (inTok / 1_000_000) * HAIKU_INPUT_PER_MTOK_USD +
    (outTok / 1_000_000) * HAIKU_OUTPUT_PER_MTOK_USD;

  return { signals, costUsd, model: HAIKU_MODEL };
}

// ─── Supabase REST ────────────────────────────────────────────────────────────

async function insertRawDump(env: DrainEnv, dump: QueuedDump): Promise<string> {
  const row = {
    id: dump.id,
    user_hash: dump.payload.user_hash,
    device_id: dump.payload.device_id,
    event_ts: dump.payload.event_ts,
    locale: dump.payload.locale,
    country: dump.payload.country,
    modality: dump.payload.modality,
    scrubbed_text: dump.payload.scrubbed_text,
    char_count: dump.payload.char_count,
    routing_module: dump.payload.routing_module,
    app_version: dump.payload.app_version,
  };
  // UPSERT on the `id` primary key (audit item #12). A retry after a
  // crash between this write and the enriched_signals write must NOT
  // create a second raw_dumps row. PostgREST treats POST + on_conflict +
  // prefer=resolution=merge-duplicates as an upsert keyed on `id`.
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/raw_dumps?on_conflict=id`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    throw new Error(`supabase_raw_dumps_${resp.status}`);
  }
  return dump.id;
}

async function insertEnrichedSignal(
  env: DrainEnv,
  args: {
    dump_id: string;
    user_hash: string;
    signals: EnrichedSignals;
    enrichment_model: string;
    enrichment_cost_usd: number;
    enrichment_latency_ms: number;
  },
): Promise<void> {
  const row = {
    dump_id: args.dump_id,
    user_hash: args.user_hash,
    sectors: args.signals.sectors,
    brands: args.signals.brands,
    topic: args.signals.topic,
    sentiment: args.signals.sentiment,
    intent: args.signals.intent,
    urgency: args.signals.urgency,
    demographic_hints: args.signals.demographic_hints,
    enrichment_model: args.enrichment_model,
    enrichment_cost_usd: Number(args.enrichment_cost_usd.toFixed(6)),
    enrichment_latency_ms: args.enrichment_latency_ms,
  };
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/enriched_signals`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    throw new Error(`supabase_enriched_signals_${resp.status}`);
  }
}

// ─── retry counter ────────────────────────────────────────────────────────────

async function bumpRetry(kv: KVNamespace, id: string): Promise<number> {
  const key = `${RETRY_PREFIX}${id}`;
  const raw = await kv.get(key);
  const next = (raw ? parseInt(raw, 10) || 0 : 0) + 1;
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 3 });
  return next;
}
