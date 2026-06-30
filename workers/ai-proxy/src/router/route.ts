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

import { json, upstreamError, exceedsContentLength, payloadTooLarge } from '@ollie/worker-http';
import { scrubPII } from '@ollie/pii-scrub';
import { groceryConfig, type ModuleConfig } from '../modules/grocery.config';
import {
  adminConfig,
  ADMIN_MODEL_FAST,
  ADMIN_MODEL_ACCURATE,
  ADMIN_ESCALATE_THRESHOLD,
} from '../modules/admin.config';
import {
  bodyConfig,
  BODY_MODEL_FAST,
  BODY_MODEL_ACCURATE,
  BODY_ESCALATE_THRESHOLD,
} from '../modules/body.config';
import {
  choresConfig,
  CHORES_MODEL_FAST,
  CHORES_MODEL_ACCURATE,
  CHORES_ESCALATE_THRESHOLD,
} from '../modules/chores.config';
import {
  cycleConfig,
  CYCLE_MODEL_FAST,
  CYCLE_MODEL_ACCURATE,
  CYCLE_ESCALATE_THRESHOLD,
} from '../modules/cycle.config';
import {
  moodConfig,
  MOOD_MODEL_FAST,
  MOOD_MODEL_ACCURATE,
  MOOD_ESCALATE_THRESHOLD,
} from '../modules/mood.config';
import {
  financeConfig,
  FINANCE_MODEL_FAST,
  FINANCE_MODEL_ACCURATE,
  FINANCE_ESCALATE_THRESHOLD,
} from '../modules/finance.config';
import {
  goalsConfig,
  GOALS_MODEL_FAST,
  GOALS_MODEL_ACCURATE,
  GOALS_ESCALATE_THRESHOLD,
} from '../modules/goals.config';
import {
  habitsConfig,
  HABITS_MODEL_FAST,
  HABITS_MODEL_ACCURATE,
  HABITS_ESCALATE_THRESHOLD,
} from '../modules/habits.config';
import {
  medicationConfig,
  MEDICATION_MODEL_FAST,
  MEDICATION_MODEL_ACCURATE,
  MEDICATION_ESCALATE_THRESHOLD,
} from '../modules/medication.config';
import {
  petsConfig,
  PETS_MODEL_FAST,
  PETS_MODEL_ACCURATE,
  PETS_ESCALATE_THRESHOLD,
} from '../modules/pets.config';
import {
  sleepConfig,
  SLEEP_MODEL_FAST,
  SLEEP_MODEL_ACCURATE,
  SLEEP_ESCALATE_THRESHOLD,
} from '../modules/sleep.config';
import {
  workConfig,
  WORK_MODEL_FAST,
  WORK_MODEL_ACCURATE,
  WORK_ESCALATE_THRESHOLD,
} from '../modules/work.config';
import { verifyClerkJwt } from '../clerk-verify';
import { deriveUserHash } from '../telemetry';
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
  /**
   * Server-side salt for deriving the per-user `user_hash` that namespaces the
   * routing_cache (S2 cross-user-leakage fix). Same secret + derivation as the
   * telemetry tables (telemetry.ts deriveUserHash) — every user-keyed Supabase
   * row in this project is keyed by salted SHA-256 user_hash, never the raw
   * Clerk id. Optional: when unset the hash is still server-derived (unsalted),
   * so isolation still holds — it just isn't salted (warned in deriveUserHash).
   */
  USER_HASH_SALT?: string;
}

// ─── module registry ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODULE_CONFIGS: Record<string, ModuleConfig<any, any>> = {
  admin: adminConfig,
  grocery: groceryConfig,
  body: bodyConfig,
  chores: choresConfig,
  cycle: cycleConfig,
  finance: financeConfig,
  goals: goalsConfig,
  habits: habitsConfig,
  medication: medicationConfig,
  mood: moodConfig,
  pets: petsConfig,
  sleep: sleepConfig,
  work: workConfig,
};

/**
 * Per-module tier ladder. Modules with an entry here opt in to
 * fast-model-first classification with confidence-based escalation:
 *   1. Call models[0] (cheap).
 *   2. Parse confidence from the returned classification.
 *   3. If confidence < threshold AND a next-tier model exists, call it.
 *   4. Return the highest-confidence response observed.
 *
 * Modules without an entry use the default GROQ_MODEL single-call path.
 * This keeps grocery (existing cache rows + golden tests) on its
 * current model exactly.
 */
interface TierConfig {
  models: string[];
  threshold: number;
}
const MODULE_TIERS: Record<string, TierConfig> = {
  admin: {
    models: [ADMIN_MODEL_FAST, ADMIN_MODEL_ACCURATE],
    threshold: ADMIN_ESCALATE_THRESHOLD,
  },
  body: {
    models: [BODY_MODEL_FAST, BODY_MODEL_ACCURATE],
    threshold: BODY_ESCALATE_THRESHOLD,
  },
  chores: {
    models: [CHORES_MODEL_FAST, CHORES_MODEL_ACCURATE],
    threshold: CHORES_ESCALATE_THRESHOLD,
  },
  cycle: {
    models: [CYCLE_MODEL_FAST, CYCLE_MODEL_ACCURATE],
    threshold: CYCLE_ESCALATE_THRESHOLD,
  },
  mood: {
    models: [MOOD_MODEL_FAST, MOOD_MODEL_ACCURATE],
    threshold: MOOD_ESCALATE_THRESHOLD,
  },
  finance: {
    models: [FINANCE_MODEL_FAST, FINANCE_MODEL_ACCURATE],
    threshold: FINANCE_ESCALATE_THRESHOLD,
  },
  goals: {
    models: [GOALS_MODEL_FAST, GOALS_MODEL_ACCURATE],
    threshold: GOALS_ESCALATE_THRESHOLD,
  },
  habits: {
    models: [HABITS_MODEL_FAST, HABITS_MODEL_ACCURATE],
    threshold: HABITS_ESCALATE_THRESHOLD,
  },
  medication: {
    models: [MEDICATION_MODEL_FAST, MEDICATION_MODEL_ACCURATE],
    threshold: MEDICATION_ESCALATE_THRESHOLD,
  },
  pets: {
    models: [PETS_MODEL_FAST, PETS_MODEL_ACCURATE],
    threshold: PETS_ESCALATE_THRESHOLD,
  },
  sleep: {
    models: [SLEEP_MODEL_FAST, SLEEP_MODEL_ACCURATE],
    threshold: SLEEP_ESCALATE_THRESHOLD,
  },
  work: {
    models: [WORK_MODEL_FAST, WORK_MODEL_ACCURATE],
    threshold: WORK_ESCALATE_THRESHOLD,
  },
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
/** Memory-DoS bounds for /route/:module (audit #38). The body carries a short
 *  command plus optional list-state `context`; 256KB is far above any real
 *  payload, and `text` itself is capped at 10k chars (same as a dump). */
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 10_000;
const VOYAGE_MODEL = 'voyage-multilingual-2';
const VOYAGE_EMBED_DIM = 1024;

// ─── main handler ─────────────────────────────────────────────────────────────

export async function handleRoute(
  req: Request,
  env: RouteEnv,
  module: string,
): Promise<Response> {
  const t0 = Date.now();

  // Auth gate — fail CLOSED by default. We validate the Bearer token
  // against the Clerk JWKS unless T0_JWT_ENFORCED is explicitly set to
  // '0' (local dev only). A missing/unset flag therefore enforces auth,
  // so a misdeploy can never leave this endpoint open.
  //
  // The verified user identity is no longer discarded: it namespaces the
  // routing_cache (S2 — without a user dimension two users with similar text
  // matched each other's cached classifications). We derive a salted
  // `user_hash` from it (same derivation as the telemetry tables) and thread
  // it through every cache lookup + write so a lookup can ONLY match the
  // caller's own prior entries.
  let userId: string;
  if (env.T0_JWT_ENFORCED !== '0') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const verified = await verifyClerkJwt(auth.slice('Bearer '.length), env);
    if (!verified) {
      return json({ error: 'invalid_jwt' }, 401);
    }
    userId = verified;
  } else {
    // Local dev only (T0_JWT_ENFORCED==='0', never set in prod). No JWT to
    // verify, so the user dimension comes from the x-user-id header the dev
    // client already sends for rate-limiting; fall back to a fixed sentinel so
    // the cache still partitions deterministically when the header is absent.
    userId = req.headers.get('x-user-id') || 'dev-anon';
  }
  const userHash = await deriveUserHash(userId, env.USER_HASH_SALT);

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
  // Memory-DoS guard (audit #38): reject oversized bodies on the declared
  // Content-Length before buffering via req.json().
  if (exceedsContentLength(req, MAX_BODY_BYTES)) {
    return payloadTooLarge('body_too_large');
  }

  let body: { text: string; dumpId?: string; context?: unknown };
  try {
    body = (await req.json()) as { text: string; dumpId?: string; context?: unknown };
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return json({ error: 'missing_text' }, 400);
  }
  // Cap the parsed text (audit #38): Content-Length can be omitted/understated,
  // so bound the field the segmenter/embedder/AI cascade actually consume.
  if (body.text.length > MAX_TEXT_CHARS) {
    return payloadTooLarge('text_too_large');
  }

  // 1. PII scrub — IDENTITY ONLY (sensitiveCategories: false).
  //
  // This is the functional Layer-2 module router. The classifier's whole job
  // is to extract the domain term — the symptom for /route/body ("asthma"),
  // the drug for /route/medication ("Zoloft"), the item for /route/grocery
  // ("melatonin"). Scrubbing those to [MEDICAL]/[MEDICATION] would destroy
  // the feature (and break body/medication route tests that pin this). So we
  // strip identity PII (names/email/phone/address/GPS/URL/numeric) — now
  // multilingual + locale-aware via @ollie/pii-scrub, closing the TR/ES-name
  // leak the worker-local scrubber had — while letting the domain term reach
  // the classifier. No `locale` field on this route; 'tr' is the app default
  // and the regex layer is locale-agnostic, so identity scrubbing is full
  // strength regardless (locale only tunes the name wordlist).
  const { scrubbed } = scrubPII(body.text, 'tr', { sensitiveCategories: false });
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
    cacheRow = await cacheLookup(embedding, module, userHash, env);
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
  // text-only embed is the cache key, scoped to THIS user's user_hash (S2).
  // The cache is per-user, so identical phrases from different users no longer
  // share rows — a lookup can only match the caller's own prior entries.
  // Trade-off: a mutation cache hit returns the model's interpretation against
  // an *empty* context, which means the downstream applier still has to
  // fuzzy-match against the live list. That's acceptable because the applier
  // already has a matchItem fallback for exactly this case.
  let classification: unknown;
  let language = 'en';
  try {
    const tier = MODULE_TIERS[module];
    const result = await groqClassify(
      cleanText,
      config,
      env.GROQ_API_KEY,
      body.context,
      tier,
    );
    classification = result.classification;
    language = result.language;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return upstreamError('groq_classify_failed', 502, detail, { module });
  }

  // 5. Cache write (fire-and-forget) — tagged with this user's user_hash so it
  //    can only ever be returned to the same user (S2 per-user isolation).
  void cacheWrite(module, cleanText, embedding, classification, language, userHash, env).catch(
    (e) => console.error('[route] cache write failed', e),
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
  userHash: string,
  env: RouteEnv,
): Promise<CacheRow | null> {
  // Supabase PostgREST RPC for pgvector cosine similarity lookup, scoped to
  // THIS user (S2 — the cache is per-user, so a lookup can only match the
  // caller's own prior rows). The migration creates the `routing_cache_lookup`
  // SQL function:
  //   SELECT id, classification, language
  //   FROM routing_cache
  //   WHERE module = $1 AND user_hash = $4
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
      p_user_hash: userHash,
    }),
  });

  if (!res.ok) {
    // 404 = function signature not deployed yet (per-user migration not yet
    // applied — the 4-arg overload doesn't exist) → treat as no hit. Cache
    // stays cold but NEVER returns a cross-user row. Same tolerance as before.
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
  // PostgREST does NOT support `{ increment: 1 }` in a PATCH body — it coerced
  // hit_count to a JSON object and the request silently failed, so the
  // popularity counter never moved (audit S2 · fix 2). Use an atomic SQL RPC
  // instead (single round-trip, race-free). 404 = RPC not yet applied in this
  // env → treat as a no-op (same tolerance as routing_cache_lookup).
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/routing_cache_increment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ p_id: id }),
  });
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new Error(`routing_cache_increment ${res.status}: ${detail.slice(0, 200)}`);
  }
}

async function cacheWrite(
  module: string,
  text: string,
  embedding: number[],
  classification: unknown,
  language: string,
  userHash: string,
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
      // Per-user namespace (S2). A row written by user A carries A's user_hash
      // and the lookup RPC filters on it, so it can never be returned to user B.
      user_hash: userHash,
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
  tier?: { models: string[]; threshold: number },
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

  // Tier ladder — try cheap model first, escalate when self-reported
  // confidence < threshold. When no tier config is given we make a
  // single call with the worker's default model (existing behavior,
  // unchanged for grocery + any future module without a tier entry).
  const modelLadder = tier?.models ?? [undefined];
  const threshold = tier?.threshold ?? 0;

  let best: { args: Record<string, unknown>; confidence: number } | null = null;

  for (const model of modelLadder) {
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
        model,
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

    const confidence = typeof args.confidence === 'number' ? args.confidence : 1;

    if (!best || confidence > best.confidence) {
      best = { args, confidence };
    }
    // Confident enough — stop the ladder.
    if (confidence >= threshold) break;
  }

  // Defensive: loop guarantees `best` is set unless modelLadder was empty
  // (impossible — default is [undefined]). Narrow for TS strict mode.
  if (!best) {
    throw new Error('groq tier ladder produced no result');
  }

  return {
    classification: best.args,
    language: typeof best.args.language === 'string' ? best.args.language : 'en',
  };
}
