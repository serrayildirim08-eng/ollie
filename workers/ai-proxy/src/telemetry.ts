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

import { scrubPII } from './pii';
import { json, upstreamError } from '@ollie/worker-http';

export interface EnrichEnv {
  CACHE_KV: KVNamespace;
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
}

const ALLOWED_TABLES = new Set([
  'retention_events',
  'session_events',
  'module_events',
  'crisis_events',
  'consent_audit',
]);

// 3 days — long enough that a wedged cron can still catch up after a weekend.
const QUEUE_TTL_SEC = 60 * 60 * 24 * 3;

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

export async function handleEnrichDump(req: Request, env: EnrichEnv): Promise<Response> {
  let body: EnrichDumpRequest;
  try {
    body = (await req.json()) as EnrichDumpRequest;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (
    !body ||
    typeof body.user_hash !== 'string' ||
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

  // US + cycle restriction — never queue cycle dumps from US users.
  const routingModule = typeof body.routing_module === 'string' ? body.routing_module : null;
  if (body.country === 'US' && routingModule === 'cycle') {
    return json({ id: null, queued: false, reason: 'us_cycle_restricted' });
  }

  // PII scrub (layer 1).
  const { scrubbed } = scrubPII(body.raw_text);

  const id = crypto.randomUUID();
  const queuedAt = new Date().toISOString();
  const entry: QueuedDump = {
    id,
    payload: {
      user_hash: body.user_hash,
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

export async function handleIngestEvent(req: Request, env: IngestEnv): Promise<Response> {
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

  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${body.table}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      prefer: 'return=minimal',
    },
    body: JSON.stringify(body.row),
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
