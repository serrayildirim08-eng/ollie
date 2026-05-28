/**
 * /route/:module — module-agnostic AI semantic routing.
 *
 * Flow for a given module (e.g. "grocery"):
 *   1. PII scrub (worker-local pass).
 *   2. Voyage multilingual-2 embed (1024-dim).
 *   3. pgvector cosine lookup in `routing_cache` (threshold 0.85).
 *      HIT  → return cached classification, increment hit_count.
 *      MISS → Groq Llama 3.3 70B tool-calling with module-specific
 *             prompt/schema, write result to cache.
 *   4. Respond with { source, latencyMs, classification, language }.
 *
 * Auth: JWT verify is wired but gated by T0_JWT_ENFORCED env flag.
 *       When T0 (backend-senior Clerk JWT) ships, flip the flag in
 *       wrangler.toml and re-deploy. Until then, endpoint is open.
 *
 * Module configs live in src/modules/<module>.config.ts.
 * Only "grocery" is registered today; port other modules by:
 *   1. Build <module>.config.ts with { ModuleConfig } shape.
 *   2. Add entry to MODULE_CONFIGS below.
 *   3. Zero new infra.
 *
 * Spec: docs/MODULE_AGNOSTIC_AI.md
 * Dependency: T1 migration that creates `routing_cache` (pgvector) table.
 */

import { json, upstreamError } from '@ollie/worker-http';
import { scrubPII } from '../pii';
import { groceryConfig, type ModuleConfig } from '../modules/grocery.config';
import { verifyClerkJwt } from '../clerk-verify';
import { groqChat } from '../groq';

// ─── env ─────────────────────────────────────────────────────────────────────

export interface RouteEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  VOYAGE_API_KEY: string;
  GROQ_API_KEY: string;
  /**
   * JWT enforcement gate — set to "1" once Clerk is wired end-to-end (T0).
   * When "1" we require a valid Clerk session JWT in the Authorization
   * header. Unset / any other value keeps the endpoint open so the
   * frontend can wire the UI without waiting on the backend cutover.
   */
  T0_JWT_ENFORCED?: string;
  /**
   * Clerk issuer URL — e.g. https://faithful-stag-15.clerk.accounts.dev.
   * Required when T0_JWT_ENFORCED === '1'. Mirrors the shape used by
   * `invites.verifyJwt`.
   */
  CLERK_ISSUER?: string;
}

// ─── module registry ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODULE_CONFIGS: Record<string, ModuleConfig<any, any>> = {
  grocery: groceryConfig,
};

// ─── types ────────────────────────────────────────────────────────────────────

export type RoutingSource = 'cache_hit' | 'groq_miss';

export interface RouteResponse {
  source: RoutingSource;
  latencyMs: number;
  classification: unknown;
  language: string;
}

// ─── constants ────────────────────────────────────────────────────────────────

const COSINE_THRESHOLD = 0.85;
const VOYAGE_MODEL = 'voyage-multilingual-2';
const VOYAGE_EMBED_DIM = 1024;

// ─── main handler ─────────────────────────────────────────────────────────────

export async function handleRoute(
  req: Request,
  env: RouteEnv,
  module: string,
): Promise<Response> {
  const t0 = Date.now();

  // Auth gate — active after T0 (Clerk JWT) ships.
  // When T0_JWT_ENFORCED === '1' we validate the Bearer token against
  // the Clerk JWKS. Without the flag the endpoint stays open so frontend
  // wiring can iterate without waiting on the cutover.
  if (env.T0_JWT_ENFORCED === '1') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const userId = await verifyClerkJwt(auth.slice('Bearer '.length), env);
    if (!userId) {
      return json({ error: 'invalid_jwt' }, 401);
    }
  }

  // Module lookup
  const config = MODULE_CONFIGS[module];
  if (!config) {
    return json({ error: 'unknown_module', module }, 404);
  }

  // Parse body
  //
  // `context` (2026-05-22) is optional list-state passed by the caller so the
  // model can disambiguate mutation commands like "remove pasta" or
  // "got everything except eggs" against the user's actual lists. Shape is
  // intentionally module-agnostic at the route layer — each config decides
  // how to render it into the system prompt (groceryConfig appends a
  // CURRENT SHOPPING LIST / CURRENT PANTRY block).
  let body: { text: string; dumpId?: string; context?: unknown };
  try {
    body = (await req.json()) as { text: string; dumpId?: string; context?: unknown };
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return json({ error: 'missing_text' }, 400);
  }

  // 1. PII scrub
  const { scrubbed } = scrubPII(body.text);
  const cleanText = scrubbed.trim();

  // 2. Voyage embed
  let embedding: number[];
  try {
    embedding = await voyageEmbed(cleanText, env.VOYAGE_API_KEY);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return upstreamError('voyage_embed_failed', 502, detail, { module });
  }

  // 3. pgvector cache lookup
  let cacheRow: CacheRow | null;
  try {
    cacheRow = await cacheLookup(embedding, module, env);
  } catch (err) {
    // Cache read failure is non-fatal — fall through to Gemini
    console.error('[route] cache lookup failed, falling through to groq', err);
    cacheRow = null;
  }

  const latencyMs = Date.now() - t0;

  if (cacheRow) {
    // HIT: update stats async (fire-and-forget — don't block response)
    void cacheHitUpdate(cacheRow.id, env).catch((e) =>
      console.error('[route] cache hit update failed', e),
    );

    const resp: RouteResponse = {
      source: 'cache_hit',
      latencyMs,
      classification: cacheRow.classification,
      language: cacheRow.language,
    };
    return json(resp);
  }

  // 4. MISS — Groq tool-calling.
  // List context (when provided) is passed through to the config's prompt
  // builder so groceryConfig can append the CURRENT SHOPPING LIST / PANTRY
  // disambiguation block. Context is NOT factored into the cache key — the
  // text-only embed remains the cache key so identical phrases share cache
  // rows across users with different lists. Trade-off: a mutation cache hit
  // returns the model's interpretation against an *empty* context, which
  // means the downstream applier still has to fuzzy-match against the live
  // list. That's acceptable because the applier already has a matchItem
  // fallback for exactly this case.
  let classification: unknown;
  let language = 'en';
  try {
    const result = await groqClassify(cleanText, config, env.GROQ_API_KEY, body.context);
    classification = result.classification;
    language = result.language;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return upstreamError('groq_classify_failed', 502, detail, { module });
  }

  // 5. Cache write (fire-and-forget)
  void cacheWrite(module, cleanText, embedding, classification, language, env).catch((e) =>
    console.error('[route] cache write failed', e),
  );

  const totalLatencyMs = Date.now() - t0;

  const resp: RouteResponse = {
    source: 'groq_miss',
    latencyMs: totalLatencyMs,
    classification,
    language,
  };
  return json(resp);
}

// ─── Voyage embed ─────────────────────────────────────────────────────────────

async function voyageEmbed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: 'query',
      output_dimension: VOYAGE_EMBED_DIM,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`voyage ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== VOYAGE_EMBED_DIM) {
    throw new Error(`voyage returned unexpected shape: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return embedding;
}

// ─── pgvector cache lookup ────────────────────────────────────────────────────

interface CacheRow {
  id: string;
  classification: unknown;
  language: string;
}

async function cacheLookup(
  embedding: number[],
  module: string,
  env: RouteEnv,
): Promise<CacheRow | null> {
  // Supabase PostgREST RPC for pgvector cosine similarity lookup.
  // T1 migration creates the `routing_cache_lookup` SQL function:
  //   SELECT id, classification, language
  //   FROM routing_cache
  //   WHERE module = $1
  //     AND 1 - (embedding <=> $2::vector) > $3
  //   ORDER BY embedding <=> $2::vector
  //   LIMIT 1
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/routing_cache_lookup`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({
      p_module: module,
      p_embedding: embedding,
      p_threshold: COSINE_THRESHOLD,
    }),
  });

  if (!res.ok) {
    // 404 = table/function doesn't exist yet (T1 not yet deployed) — not an error
    if (res.status === 404) return null;
    const detail = await res.text().catch(() => '');
    throw new Error(`routing_cache_lookup ${res.status}: ${detail.slice(0, 200)}`);
  }

  // RPC returns an array; take first row
  const rows = (await res.json()) as CacheRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function cacheHitUpdate(id: string, env: RouteEnv): Promise<void> {
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/routing_cache?id=eq.${encodeURIComponent(id)}`;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      prefer: 'return=minimal',
    },
    body: JSON.stringify({
      hit_count: { increment: 1 },
      last_hit_at: new Date().toISOString(),
    }),
  });
}

async function cacheWrite(
  module: string,
  text: string,
  embedding: number[],
  classification: unknown,
  language: string,
  env: RouteEnv,
): Promise<void> {
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/routing_cache`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      prefer: 'return=minimal',
    },
    body: JSON.stringify({
      module,
      text_sample: text.slice(0, 500),
      embedding,
      classification,
      language,
      hit_count: 0,
      last_hit_at: new Date().toISOString(),
    }),
  });
}

// ─── Groq Llama 3.3 70B tool-calling ─────────────────────────────────────────

interface GroqClassifyResult {
  classification: unknown;
  language: string;
}

async function groqClassify(
  text: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: ModuleConfig<any, any>,
  apiKey: string,
  context?: unknown,
): Promise<GroqClassifyResult> {
  const baseSystemPrompt = config.buildSystemPrompt(context);
  const fnSchema = config.buildFunctionSchema() as {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };

  // Inline few-shot examples into the system prompt. Encoding them as
  // assistant tool_calls would require synthetic tool reply turns and
  // bloat the message list; the model takes them just as well as text.
  const examplesBlock = config.examples
    .map(
      (ex, i) =>
        `Example ${i + 1}:\nUser: ${ex.input}\nExpected ${fnSchema.name} args: ${JSON.stringify(ex.output)}`,
    )
    .join('\n\n');

  const systemPrompt = examplesBlock
    ? `${baseSystemPrompt}\n\n${examplesBlock}`
    : baseSystemPrompt;

  const choice = await groqChat(
    {
      apiKey,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      tools: [{ type: 'function', function: fnSchema }],
      toolChoice: { type: 'function', function: { name: fnSchema.name } },
      maxTokens: 1024,
    },
    'route',
  );

  const toolCalls = choice.message.tool_calls ?? [];
  const call =
    toolCalls.find((tc) => tc.function.name === fnSchema.name) ?? toolCalls[0];
  if (!call) {
    throw new Error(
      `groq returned no tool call (finish=${choice.finish_reason})`,
    );
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    throw new Error(
      `groq bad tool args json: ${call.function.arguments.slice(0, 300)}`,
    );
  }

  return {
    classification: args,
    language: typeof args.language === 'string' ? args.language : 'en',
  };
}
