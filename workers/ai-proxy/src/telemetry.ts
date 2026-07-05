/**
 * Telemetry endpoints for the ai-proxy worker.
 *
 * /enrich-dump  — receives a raw brain-dump from the client. Runs the
 *                 Layer-1 PII scrub, applies the US-cycle drop rule, and
 *                 queues the payload in CACHE_KV under `q:enrich:*`. The
 *                 cron worker drains the queue every 5 minutes, calls
 *                 Anthropic Haiku 4.5 for structured enrichment, then
 *                 INSERTs into raw_dumps + enriched_signals.
 *
 *                 We use the CACHE_KV namespace (not a new one) to avoid a
 *                 second binding for what's a low-volume queue. Keys are
 *                 prefixed so they never collide with the proxy's cache:ai:*
 *                 entries.
 *
 * /ingest-event — receives non-dump rows (retention/session/module/crisis/
 *                 consent_audit) and INSERTs straight to Supabase via REST.
 *                 No Anthropic call, no queue. Worker-side validation is
 *                 minimal — Supabase column constraints catch the rest.
 *
 * Privacy rules enforced here:
 *   - Brain-dumps: PII scrub before queue. Anthropic layer in cron is the
 *     second pass.
 *   - US users + cycle module: brain-dump never queued (dropped at intake).
 *     module_events row dropped silently (returns ok:true so client doesn't
 *     retry forever).
 *   - No request body content is ever logged.
 */

import { scrubPII, asLocale } from '@ollie/pii-scrub';
import { json, upstreamError, exceedsContentLength, payloadTooLarge } from '@ollie/worker-http';

/**
 * Server-side anonymized user identity (audit #4 — IDOR fix).
 *
 * The verified Clerk userId is the ONLY source of truth. We derive the
 * `user_hash` here from it + a server-held salt, and ignore/overwrite any
 * client-supplied `user_hash`/`user_id` so a caller can never write or enrich
 * telemetry on behalf of another user. SHA-256 hex; deterministic per user.
 *
 * The salt should be set (secret `USER_HASH_SALT`) and, to keep analytics
 * continuity with previously client-hashed rows, match the client salt. If the
 * salt is absent the hash is still server-derived (so the IDOR is still closed)
 * — it just isn't salted; we warn so the missing secret is visible in logs.
 */
export async function deriveUserHash(userId: string, salt: string | undefined): Promise<string> {
  if (!salt) console.warn('[telemetry] USER_HASH_SALT unset — hashing userId unsalted');
  const data = new TextEncoder().encode(`${salt ?? ''}:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface EnrichEnv {
  CACHE_KV: KVNamespace;
  /** Server-side salt for deriving user_hash from the verified Clerk userId. */
  USER_HASH_SALT?: string;
  // Cloudflare Queues producer binding (item #4). OPTIONAL: when the
  // [[queues.producers]] block in wrangler.toml is uncommented (after
  // `wrangler queues create ollie-enrich-queue`) this is bound and the
  // dump is sent to the durable Queue. When absent, the handler falls
  // back to the legacy `q:enrich:*` KV queue so a routine deploy that
  // has NOT provisioned the queue keeps working unchanged.
  ENRICH_QUEUE?: Queue<QueuedDump>;
}

export interface IngestEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  /** Server-side salt for deriving user_hash from the verified Clerk userId. */
  USER_HASH_SALT?: string;
}

const ALLOWED_TABLES = new Set([
  'retention_events',
  'session_events',
  'module_events',
  'crisis_events',
  'consent_audit',
  'funnel_events',
]);

// audit #155 — per-table column whitelist. /ingest-event forwards the client
// row straight to the Supabase REST endpoint, so without this the only thing
// stopping an arbitrary key from being written is the DB schema. Mirror each
// telemetry table's columns here and drop anything not on the list before
// forwarding. Keep in sync with supabase/migrations/*. `id` is omitted on
// purpose — it is server-generated (gen_random_uuid default).
const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  retention_events: new Set([
    'user_hash', 'event_type', 'event_at', 'session_count',
    'hours_since_install', 'country', 'locale', 'device_id', 'app_version',
  ]),
  session_events: new Set([
    'user_hash', 'session_id', 'started_at', 'ended_at', 'duration_seconds',
    'modules_opened', 'voice_used', 'text_used', 'brain_dumps_count',
    'country', 'device_id', 'app_version',
  ]),
  module_events: new Set([
    'user_hash', 'session_id', 'module', 'opened_at', 'closed_at',
    'duration_seconds', 'actions_count', 'country',
  ]),
  crisis_events: new Set([
    'event_at', 'country', 'hotline_shown', 'app_version',
  ]),
  consent_audit: new Set([
    'user_hash', 'consent_necessary', 'consent_marketing', 'consented_at',
    'event_source', 'ip_country', 'user_agent', 'app_version',
  ]),
  funnel_events: new Set([
    'user_hash', 'event_type', 'value', 'minutes_since_install',
    'app_version', 'app', 'event_at',
  ]),
};

// 3 days — long enough that a wedged cron can still catch up after a weekend.
const QUEUE_TTL_SEC = 60 * 60 * 24 * 3;
/** Bound the raw dump text before scrubbing + queuing (audit #84). A brain
 *  dump is short by nature; this mirrors the /route/dump 10k cap so an abusive
 *  payload can't push unbounded text through the PII scrubber into the queue. */
const MAX_RAW_TEXT_CHARS = 10_000;
/** Whole-body memory-DoS bound (audit #38/#84): generous headroom over the
 *  text cap + small metadata fields. */
const MAX_ENRICH_BODY_BYTES = 64 * 1024;

// ─── /enrich-dump ──────────────────────────────────────────────────────────────

export interface EnrichDumpRequest {
  user_hash: string;
  device_id: string;
  event_ts: string;          // ISO string
  locale: string;
  country: string;
  modality: 'voice' | 'text' | 'paste';
  raw_text: string;
  routing_module?: string | null;
  app_version: string;
}

export interface QueuedDump {
  id: string;
  payload: {
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
  };
  queued_at: string;
}

export async function handleEnrichDump(
  req: Request,
  env: EnrichEnv,
  userId: string,
): Promise<Response> {
  // Memory-DoS guard (audit #38/#84): reject oversized bodies on Content-Length
  // before buffering via req.json().
  if (exceedsContentLength(req, MAX_ENRICH_BODY_BYTES)) {
    return payloadTooLarge('body_too_large');
  }
  let body: EnrichDumpRequest;
  try {
    body = (await req.json()) as EnrichDumpRequest;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  // user_hash is no longer trusted from the client — it is derived server-side
  // from the verified Clerk userId below, so it is NOT required in the payload.
  if (
    !body ||
    typeof body.device_id !== 'string' ||
    typeof body.raw_text !== 'string' ||
    typeof body.event_ts !== 'string' ||
    typeof body.locale !== 'string' ||
    typeof body.country !== 'string' ||
    typeof body.app_version !== 'string'
  ) {
    return json({ error: 'invalid_payload' }, 400);
  }

  if (body.modality !== 'voice' && body.modality !== 'text' && body.modality !== 'paste') {
    return json({ error: 'invalid_modality' }, 400);
  }

  // Bound raw_text before scrubbing + queuing (audit #84). Content-Length can
  // be omitted/understated, so cap the parsed field too.
  if (body.raw_text.length > MAX_RAW_TEXT_CHARS) {
    return payloadTooLarge('raw_text_too_large');
  }

  // US + cycle restriction — never queue cycle dumps from US users.
  const routingModule = typeof body.routing_module === 'string' ? body.routing_module : null;
  if (body.country === 'US' && routingModule === 'cycle') {
    return json({ id: null, queued: false, reason: 'us_cycle_restricted' });
  }

  // PII scrub (layer 1). FULL categories — this raw_text is queued INTO the
  // opt-in research corpus, so health/mental-health/sexual terms + locale-aware
  // (TR/ES/EN) names must be redacted before it is persisted (S9).
  const { scrubbed } = scrubPII(body.raw_text, asLocale(body.locale));

  // IDOR fix: ownership comes from the verified JWT, never the client field.
  const serverUserHash = await deriveUserHash(userId, env.USER_HASH_SALT);

  const id = crypto.randomUUID();
  const queuedAt = new Date().toISOString();
  const entry: QueuedDump = {
    id,
    payload: {
      user_hash: serverUserHash,
      device_id: body.device_id,
      event_ts: body.event_ts,
      locale: body.locale,
      country: body.country,
      modality: body.modality,
      scrubbed_text: scrubbed,
      char_count: scrubbed.length,
      routing_module: routingModule,
      app_version: body.app_version,
    },
    queued_at: queuedAt,
  };

  // Cloudflare Queues path (item #4) — preferred when the producer binding
  // is present. The Queue gives us native retry/backoff + a real DLQ,
  // replacing the hand-rolled KV-prefix queue + retry-counter.
  if (env.ENRICH_QUEUE) {
    await env.ENRICH_QUEUE.send(entry);
    return json({ id, queued: true });
  }

  // Legacy fallback — KV-prefix queue. Key `q:enrich:<unix-ts-ms>:<uuid>`
  // so the drain can do a prefix list and timestamp ordering falls out.
  const tsMs = Date.now();
  const key = `q:enrich:${tsMs}:${id}`;
  await env.CACHE_KV.put(key, JSON.stringify(entry), { expirationTtl: QUEUE_TTL_SEC });

  return json({ id, queued: true });
}

// ─── /ingest-event ─────────────────────────────────────────────────────────────

export interface IngestEventRequest {
  table: string;
  row: Record<string, unknown>;
}

export async function handleIngestEvent(
  req: Request,
  env: IngestEnv,
  userId: string,
): Promise<Response> {
  let body: IngestEventRequest;
  try {
    body = (await req.json()) as IngestEventRequest;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (!body || typeof body.table !== 'string') {
    return json({ error: 'missing_table' }, 400);
  }
  if (!ALLOWED_TABLES.has(body.table)) {
    return json({ error: 'invalid_table' }, 400);
  }
  if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
    return json({ error: 'invalid_row' }, 400);
  }
  // Size/shape bounds (audit #31). A telemetry row is small + flat; reject an
  // oversized object before it reaches Supabase. 64 keys / 16 KiB is generous.
  const rowKeys = Object.keys(body.row);
  if (rowKeys.length > 64 || JSON.stringify(body.row).length > 16 * 1024) {
    return json({ error: 'row_too_large' }, 413);
  }

  // IDOR fix: force the row's identity to the verified user. These five
  // telemetry tables are anonymized + keyed by user_hash, so we overwrite any
  // client-supplied identity field (`user_hash` / `user_id`) with the
  // server-derived hash — a caller can never write a row "as" another user.
  const serverUserHash = await deriveUserHash(userId, env.USER_HASH_SALT);
  if ('user_hash' in body.row) body.row.user_hash = serverUserHash;
  if ('user_id' in body.row) body.row.user_id = serverUserHash;

  // US + cycle restriction for module_events only.
  if (
    body.table === 'module_events' &&
    body.row.country === 'US' &&
    body.row.module === 'cycle'
  ) {
    return json({ ok: true, dropped: 'us_cycle' });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  // audit #155 — column whitelist. Drop any key the target table does not own
  // so a caller can never write to (or probe for) columns outside the
  // anonymized telemetry shape; we no longer rely on the DB to reject them.
  const allowedColumns = ALLOWED_COLUMNS[body.table];
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.row)) {
    if (allowedColumns.has(key)) row[key] = value;
  }

  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${body.table}`;
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

  if (resp.ok) {
    return json({ ok: true, table: body.table, inserted: 1 });
  }

  // SECURITY (S8): generic code to the client; PostgREST detail (which
  // discloses the target table's column/constraint names) logged
  // server-side only behind a request id.
  const errText = await resp.text();
  return upstreamError('ingest_failed', 502, errText, {
    endpoint: 'ingest-event',
    table: body.table,
    upstream_status: resp.status,
  });
}

// ─── helpers ───────────────────────────────────────────────────────────────────
// `json()` is the shared helper from @ollie/worker-http (imported above).
