/**
 * POST /feed-me/:user — adaptive recipe suggestion (user mode + pet mode).
 *
 * Flow:
 *   1. Path UUID + JWT auth (ownership: sub === pathUserId when JWT enforced).
 *   2. Body validate (pantry non-empty, diet enum, feedTarget enum, count 1-5).
 *   3. PII-scrub pantry items + petName via @ollie/pii-scrub (MEDICAL,
 *      MEDICATION, SEXUAL, MENTAL_HEALTH categories must never reach Gemini).
 *      Brand allowlist already keeps Migros / Coca-Cola / pet names through.
 *   4. Voyage embed the cache-key text (pantry|diet|target|pet|locale|count).
 *   5. pgvector lookup in routing_cache (module='feed_me' or 'pet_feed').
 *      HIT  → POST-PROCESS cached suggestions through cook signals (if user
 *             has ≥5 cooks) + excludeDishes suppression. Return source='cache_hit'.
 *      MISS → Fetch cook signals RPC, build per-request system prompt,
 *             call Gemini 2.5 Flash with function calling, write cache,
 *             return source='gemini'.
 *   6. Failure (Voyage/Gemini 5xx/timeout) → return
 *      `{ suggestions: [], source: 'static_fallback', latencyMs }` (200) so
 *      the frontend can fall back to @ollie/logic/grocery inferRecipe
 *      without the UI flickering an error toast at the user.
 *
 * Auth: T0_JWT_ENFORCED-gated (mirrors /replenishment/:user and /route/:module).
 *
 * Spec: docs/handoffs/feed-me/00-SPEC.md
 */

import { json, upstreamError, exceedsContentLength, payloadTooLarge } from '@ollie/worker-http';
import { scrubPII, type Locale } from '@ollie/pii-scrub';
import { verifyClerkJwt } from '../clerk-verify';
import { deriveUserHash } from '../telemetry';
import { groqChat, type GroqMessage } from '../groq';
import { cloudflareJson, type CfAiBinding } from '../cloudflare-ai';
import { openRouterJson } from '../openrouter';
import {
  feedMeConfig,
  buildFeedMeSystemPrompt,
  type RecipeBatch,
  type RecipeSuggestion,
  type CookSignals,
  type DietFilter,
  type FeedLocale,
  type FeedMePromptContext,
} from '../modules/feed-me.config';
import {
  petFeedConfig,
  buildPetFeedSystemPrompt,
  type PetFeedPromptContext,
} from '../modules/pet-feed.config';

// ─── env ─────────────────────────────────────────────────────────────────────

export interface FeedMeEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  VOYAGE_API_KEY: string;
  GEMINI_API_KEY: string;
  GROQ_API_KEY: string;
  /** OpenRouter free-tier key — final cascade tier. */
  OPENROUTER_API_KEY?: string;
  /** Cloudflare Workers AI binding — same-platform fallback, separate quota. */
  AI?: CfAiBinding;
  T0_JWT_ENFORCED?: string;
  /** 'production' on prod — refuses the x-user-id dev bypass there (audit #25). */
  ENVIRONMENT?: string;
  CLERK_ISSUER?: string;
  /** Server-side salt for the per-user routing_cache namespace (S2). Same
   *  derivation as the telemetry tables — routing_cache rows are keyed by
   *  salted SHA-256 user_hash, never the raw user id. Optional (unsalted but
   *  still server-derived when absent). */
  USER_HASH_SALT?: string;
}

// ─── types ───────────────────────────────────────────────────────────────────

export type FeedTarget = 'user' | 'pet';
export type FeedSource =
  | 'gemini'
  | 'groq'
  | 'cloudflare'
  | 'openrouter'
  | 'cache_hit'
  | 'static_fallback';

export interface FeedMeRequestBody {
  pantry: string[];
  diet?: DietFilter;
  feedTarget?: FeedTarget;
  petName?: string;
  count?: number;
  locale: FeedLocale;
  excludeDishes?: string[];
}

export interface FeedMeResponse {
  suggestions: RecipeSuggestion[];
  source: FeedSource;
  latencyMs: number;
}

// Re-export the contract the frontend imports verbatim.
export type {
  RecipeSuggestion,
  RecipeIngredient,
  RecipeBatch,
  DietFilter,
  FeedLocale,
} from '../modules/feed-me.config';

// ─── constants ───────────────────────────────────────────────────────────────

/** Accepts UUIDs (legacy) AND Clerk user IDs (user_xxx). The Clerk JWT
 *  ownership check downstream (verified === pathUserId) is the real auth
 *  boundary — this regex only blocks injection-shaped garbage. */
const UUID_RE = /^[A-Za-z0-9_-]{8,128}$/;

const COSINE_THRESHOLD = 0.85;
const VOYAGE_MODEL = 'voyage-multilingual-2';
const VOYAGE_EMBED_DIM = 1024;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const ALLOWED_DIETS: ReadonlySet<DietFilter> = new Set([
  'all', 'vegetarian', 'vegan', 'mediterranean', 'turkish',
]);
const ALLOWED_TARGETS: ReadonlySet<FeedTarget> = new Set(['user', 'pet']);
const ALLOWED_LOCALES: ReadonlySet<FeedLocale> = new Set(['en', 'es', 'tr']);

const DEFAULT_COUNT = 3;
const MAX_COUNT = 5;
const PANTRY_MAX_ITEMS = 80;
const PANTRY_MAX_ITEM_LEN = 100;
const PET_NAME_MAX_LEN = 80;
/** Memory-DoS bound (audit #38). Field-level caps below already bound the
 *  parsed shape (≤80 items × ≤100 chars + small enums); 64KB is generous
 *  headroom over a real body while blocking an arbitrary-volume payload from
 *  being buffered via req.json(). */
const MAX_BODY_BYTES = 64 * 1024;
const COOK_SIGNAL_MIN_SAMPLE = 5;

// ─── handler ─────────────────────────────────────────────────────────────────

export async function handleFeedMe(
  req: Request,
  env: FeedMeEnv,
  pathUserId: string,
): Promise<Response> {
  const t0 = Date.now();

  if (!UUID_RE.test(pathUserId)) {
    return json({ error: 'invalid_user_id' }, 400);
  }

  // ── Auth + ownership ── fail CLOSED unless dev (T0_JWT_ENFORCED==='0') AND not
  //    production (audit #25: prod refuses the spoofable x-user-id bypass).
  if (env.T0_JWT_ENFORCED !== '0' || env.ENVIRONMENT === 'production') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const verified = await verifyClerkJwt(auth.slice('Bearer '.length), env);
    if (!verified) {
      return json({ error: 'invalid_jwt' }, 401);
    }
    if (verified !== pathUserId) {
      return json({ error: 'forbidden' }, 403);
    }
  } else {
    const headerUser = req.headers.get('x-user-id');
    if (!headerUser) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (headerUser !== pathUserId) {
      return json({ error: 'forbidden' }, 403);
    }
  }

  // Per-user routing_cache namespace (S2). pathUserId is the verified user
  // (JWT sub === path param above); derive the same salted user_hash the
  // telemetry tables use and thread it through every cache lookup + write so
  // one user's recipe-cache rows can never be returned to another user.
  const userHash = await deriveUserHash(pathUserId, env.USER_HASH_SALT);

  // ── Parse + validate body ────────────────────────────────────────────────
  // Memory-DoS guard (audit #38): reject oversized bodies on Content-Length
  // before buffering via req.json().
  if (exceedsContentLength(req, MAX_BODY_BYTES)) {
    return payloadTooLarge('body_too_large');
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const parsed = validateBody(raw);
  if ('error' in parsed) {
    return json({ error: parsed.error }, 400);
  }
  const body = parsed.body;

  // ── PII scrub pantry + petName ───────────────────────────────────────────
  // Brand allowlist already keeps Migros / Coca-Cola through. Pet names slip
  // past as well because they read as proper nouns with no name-trigger
  // context. We additionally drop any item whose scrubbed form contains a
  // sensitive-category placeholder (e.g. "ritalin" → "[MEDICATION]") so
  // never reaches Gemini.
  const sanitizedPantry = body.pantry
    .map((item) => sanitizeFreeText(item, body.locale))
    .filter((s): s is string => s !== null);
  if (sanitizedPantry.length === 0) {
    return json({ error: 'empty_pantry_after_scrub' }, 400);
  }
  const sanitizedPetName = body.petName
    ? sanitizeFreeText(body.petName, body.locale) ?? ''
    : '';

  // ── Build cache-key text ─────────────────────────────────────────────────
  // Sorted pantry → identical queries land on the same key, slight pantry
  // diffs (1-2 items) drift into the 0.85 cosine neighbourhood.
  const cacheKeyText = buildCacheKeyText({
    pantry: sanitizedPantry,
    diet: body.diet,
    feedTarget: body.feedTarget,
    petName: sanitizedPetName,
    locale: body.locale,
    count: body.count,
  });

  // module label drives the cache table partition.
  const moduleLabel = body.feedTarget === 'pet' ? 'pet_feed' : 'feed_me';

  // ── Voyage embed (graceful static_fallback on failure) ───────────────────
  let embedding: number[];
  try {
    embedding = await voyageEmbed(cacheKeyText, env.VOYAGE_API_KEY);
  } catch (err) {
    console.error('[feed-me] voyage embed failed, returning static_fallback', err);
    const fallback: FeedMeResponse = {
      suggestions: [],
      source: 'static_fallback',
      latencyMs: Date.now() - t0,
    };
    return json(fallback);
  }

  // ── Cache lookup ─────────────────────────────────────────────────────────
  let cacheRow: CacheRow | null;
  try {
    cacheRow = await cacheLookup(embedding, moduleLabel, userHash, env);
  } catch (err) {
    console.error('[feed-me] cache lookup failed, falling through to gemini', err);
    cacheRow = null;
  }

  // ── Fetch cook signals (used by both hit + miss paths) ───────────────────
  // Hit: fold into the post-processing scorer when sampleSize ≥ 5.
  // Miss: bake into the Gemini system prompt regardless of sampleSize.
  let signals: CookSignals = { recent: [], loved: [], rejected: [], sampleSize: 0 };
  try {
    signals = await fetchCookSignals(pathUserId, body.feedTarget, sanitizedPetName, env);
  } catch (err) {
    console.error('[feed-me] cook signals RPC failed, continuing without', err);
  }

  // ── HIT path ─────────────────────────────────────────────────────────────
  if (cacheRow) {
    void cacheHitUpdate(cacheRow.id, env).catch((e) =>
      console.error('[feed-me] cache hit update failed', e),
    );

    const cachedBatch = parseRecipeBatch(cacheRow.classification);
    const scored = scoreSuggestions(
      cachedBatch.suggestions,
      signals,
      body.excludeDishes,
      body.count,
    );
    const hitResp: FeedMeResponse = {
      suggestions: scored,
      source: 'cache_hit',
      latencyMs: Date.now() - t0,
    };
    return json(hitResp);
  }

  // ── MISS path — free-tier cascade ─────────────────────────────────────────
  // Gemini → Groq → Cloudflare Workers AI → OpenRouter. Every free tier has its
  // own DAILY ceiling (Gemini: request count, Groq: tokens-per-day, CF: neurons,
  // OpenRouter: request count) and they exhaust at different times, so stacking
  // them makes a recipe almost always come back. On ANY provider error we
  // advance to the next. Only if EVERY available tier fails do we return the
  // empty static_fallback ("couldn't dream anything up").
  const jsonMaxTokens = jsonMaxTokensFor(body.count);
  const { systemPrompt: jsonSystem, userTurn } = buildBasePrompt(
    body,
    sanitizedPantry,
    sanitizedPetName,
    signals,
  );
  const jsonUserMessage = `${userTurn}${jsonShapeInstruction(body.count)}`;

  const chain: Array<{ source: FeedSource; run: () => Promise<RecipeBatch> }> = [
    {
      source: 'gemini',
      run: () =>
        geminiSuggest(body, sanitizedPantry, sanitizedPetName, signals, env.GEMINI_API_KEY),
    },
    {
      source: 'groq',
      run: () =>
        groqSuggest(body, sanitizedPantry, sanitizedPetName, signals, env.GROQ_API_KEY),
    },
  ];
  if (env.AI) {
    const ai = env.AI;
    chain.push({
      source: 'cloudflare',
      run: async () =>
        parseJsonBatch(
          await cloudflareJson(
            ai,
            { system: jsonSystem, user: jsonUserMessage, maxTokens: jsonMaxTokens },
            'feed-me',
          ),
          'cloudflare',
        ),
    });
  }
  if (env.OPENROUTER_API_KEY) {
    const key = env.OPENROUTER_API_KEY;
    chain.push({
      source: 'openrouter',
      run: async () =>
        parseJsonBatch(
          await openRouterJson(
            { apiKey: key, system: jsonSystem, user: jsonUserMessage, maxTokens: jsonMaxTokens },
            'feed-me',
          ),
          'openrouter',
        ),
    });
  }

  let batch: RecipeBatch | null = null;
  let aiSource: FeedSource = 'gemini';
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    try {
      batch = await provider.run();
      aiSource = provider.source;
      break;
    } catch (err) {
      const isLast = i === chain.length - 1;
      console.error(
        `[feed-me] ${provider.source} failed${isLast ? ', returning static_fallback' : ', falling through'}`,
        err,
      );
    }
  }
  if (!batch) {
    const fallback: FeedMeResponse = {
      suggestions: [],
      source: 'static_fallback',
      latencyMs: Date.now() - t0,
    };
    return json(fallback);
  }

  // Defensive trim: Gemini occasionally returns count+1 even with maxItems
  // baked into the schema.
  const trimmed = batch.suggestions.slice(0, body.count);

  // ── Cache write (fire-and-forget) ────────────────────────────────────────
  void cacheWrite(
    moduleLabel,
    cacheKeyText,
    embedding,
    { suggestions: trimmed, language: batch.language },
    batch.language,
    userHash,
    env,
  ).catch((e) => console.error('[feed-me] cache write failed', e));

  const finalResp: FeedMeResponse = {
    suggestions: trimmed,
    source: aiSource,
    latencyMs: Date.now() - t0,
  };
  return json(finalResp);
}

// ─── body validation ─────────────────────────────────────────────────────────

interface ValidatedBody {
  pantry: string[];
  diet: DietFilter;
  feedTarget: FeedTarget;
  petName?: string;
  count: number;
  locale: FeedLocale;
  excludeDishes: string[];
}

function validateBody(
  raw: unknown,
): { body: ValidatedBody } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'bad_body' };
  }
  const b = raw as Record<string, unknown>;

  // pantry: non-empty array of non-empty strings ≤ 80 items
  if (!Array.isArray(b.pantry) || b.pantry.length === 0) {
    return { error: 'missing_pantry' };
  }
  if (b.pantry.length > PANTRY_MAX_ITEMS) {
    return { error: 'pantry_too_large' };
  }
  const pantry: string[] = [];
  for (const item of b.pantry) {
    if (typeof item !== 'string') return { error: 'pantry_item_not_string' };
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > PANTRY_MAX_ITEM_LEN) {
      return { error: 'pantry_item_too_long' };
    }
    pantry.push(trimmed);
  }
  if (pantry.length === 0) {
    return { error: 'missing_pantry' };
  }

  // locale (required)
  if (typeof b.locale !== 'string' || !ALLOWED_LOCALES.has(b.locale as FeedLocale)) {
    return { error: 'invalid_locale' };
  }
  const locale = b.locale as FeedLocale;

  // diet (optional, default 'all')
  let diet: DietFilter = 'all';
  if (b.diet !== undefined) {
    if (typeof b.diet !== 'string' || !ALLOWED_DIETS.has(b.diet as DietFilter)) {
      return { error: 'invalid_diet' };
    }
    diet = b.diet as DietFilter;
  }

  // feedTarget (optional, default 'user')
  let feedTarget: FeedTarget = 'user';
  if (b.feedTarget !== undefined) {
    if (typeof b.feedTarget !== 'string' || !ALLOWED_TARGETS.has(b.feedTarget as FeedTarget)) {
      return { error: 'invalid_feed_target' };
    }
    feedTarget = b.feedTarget as FeedTarget;
  }

  // petName: required only when feedTarget === 'pet'
  let petName: string | undefined;
  if (b.petName !== undefined) {
    if (typeof b.petName !== 'string') return { error: 'invalid_pet_name' };
    const trimmed = b.petName.trim();
    if (trimmed.length > PET_NAME_MAX_LEN) {
      return { error: 'pet_name_too_long' };
    }
    if (trimmed.length > 0) petName = trimmed;
  }
  if (feedTarget === 'pet' && !petName) {
    return { error: 'missing_pet_name' };
  }

  // count (optional, default 3, max 5)
  let count = DEFAULT_COUNT;
  if (b.count !== undefined) {
    if (typeof b.count !== 'number' || !Number.isInteger(b.count)) {
      return { error: 'invalid_count' };
    }
    if (b.count < 1 || b.count > MAX_COUNT) {
      return { error: 'invalid_count' };
    }
    count = b.count;
  }

  // excludeDishes (optional)
  const excludeDishes: string[] = [];
  if (b.excludeDishes !== undefined) {
    if (!Array.isArray(b.excludeDishes)) return { error: 'invalid_exclude_dishes' };
    for (const d of b.excludeDishes) {
      if (typeof d !== 'string') return { error: 'invalid_exclude_dishes' };
      const t = d.trim();
      if (t.length > 0 && t.length <= PANTRY_MAX_ITEM_LEN) excludeDishes.push(t);
    }
  }

  return {
    body: { pantry, diet, feedTarget, petName, count, locale, excludeDishes },
  };
}

// ─── PII helper ──────────────────────────────────────────────────────────────

/**
 * Scrub a single free-text fragment (pantry item / petName) with the locale-
 * aware scrubber. Returns null when the scrubbed result contains a sensitive
 * placeholder (MEDICATION / MEDICAL / SEXUAL / MENTAL_HEALTH) — those items
 * are dropped entirely rather than passed as `[MEDICATION]` to Gemini.
 *
 * Locale narrowing: pii-scrub uses 'en' | 'es' | 'tr' | 'other'; our public
 * FeedLocale is 'en' | 'es' | 'tr', so a direct widening cast is sound.
 */
function sanitizeFreeText(input: string, locale: FeedLocale): string | null {
  const { scrubbed, redactions } = scrubPII(input, locale as Locale);
  const blocked = redactions.some(
    (r) =>
      r.type === 'MEDICAL' ||
      r.type === 'MEDICATION' ||
      r.type === 'SEXUAL' ||
      r.type === 'MENTAL_HEALTH',
  );
  if (blocked) return null;
  const cleaned = scrubbed.trim();
  return cleaned.length > 0 ? cleaned : null;
}

// ─── cache key text ──────────────────────────────────────────────────────────

interface CacheKeyParts {
  pantry: string[];
  diet: DietFilter;
  feedTarget: FeedTarget;
  petName: string;
  locale: FeedLocale;
  count: number;
}

function buildCacheKeyText(parts: CacheKeyParts): string {
  const sorted = [...parts.pantry].map((s) => s.toLowerCase()).sort();
  return [
    sorted.join('|'),
    `diet:${parts.diet}`,
    `target:${parts.feedTarget}`,
    `pet:${parts.petName.toLowerCase()}`,
    `locale:${parts.locale}`,
    `n:${parts.count}`,
  ].join('|');
}

// ─── cook signals RPC ────────────────────────────────────────────────────────

interface CookSignalsRpcRow {
  recent?: unknown;
  loved?: unknown;
  rejected?: unknown;
  sample_size?: number;
}

async function fetchCookSignals(
  userId: string,
  feedTarget: FeedTarget,
  petName: string,
  env: FeedMeEnv,
): Promise<CookSignals> {
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/feed_me_cook_signals`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({
      p_user: userId,
      p_feed_target: feedTarget,
      p_pet_name: petName || null,
    }),
  });

  if (!res.ok) {
    // 404 = RPC not yet deployed (backend-junior-1 migration pending) →
    // continue with empty signals so the endpoint stays live.
    if (res.status === 404) {
      return { recent: [], loved: [], rejected: [], sampleSize: 0 };
    }
    const detail = await res.text().catch(() => '');
    throw new Error(`cook_signals ${res.status}: ${detail.slice(0, 200)}`);
  }

  // RPC returns either a single object or an array of one — handle both.
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { recent: [], loved: [], rejected: [], sampleSize: 0 };
  }
  const row: CookSignalsRpcRow | undefined = Array.isArray(payload)
    ? (payload[0] as CookSignalsRpcRow | undefined)
    : (payload as CookSignalsRpcRow);
  if (!row) return { recent: [], loved: [], rejected: [], sampleSize: 0 };

  return {
    recent: coerceSignalList(row.recent),
    loved: coerceSignalList(row.loved),
    rejected: coerceSignalList(row.rejected),
    sampleSize: typeof row.sample_size === 'number' ? row.sample_size : 0,
  };
}

function coerceSignalList(v: unknown): CookSignals['recent'] {
  if (!Array.isArray(v)) return [];
  const out: CookSignals['recent'] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.dish !== 'string' || o.dish.trim().length === 0) continue;
    out.push({
      dish: o.dish,
      cuisine: typeof o.cuisine === 'string' ? o.cuisine : undefined,
      diet: Array.isArray(o.diet) ? o.diet.filter((d): d is string => typeof d === 'string') : undefined,
      count: typeof o.count === 'number' ? o.count : undefined,
      last_cooked_at: typeof o.last_cooked_at === 'string' ? o.last_cooked_at : undefined,
    });
  }
  return out;
}

// ─── scoring (cache-hit post-processing) ─────────────────────────────────────

/**
 * Apply cook signals + excludeDishes to a cached suggestion list so the user
 * never sees a stale "we already cooked this" / "we hated this" recipe just
 * because the embedding hit the same neighbour. Order:
 *   1. Filter OUT excludeDishes + rejected (hard suppress).
 *   2. Stable-sort with three weights:
 *        loved          → -100 (top)
 *        recent         → +50  (push down — already cooked recently)
 *        no signal      →  0
 *   3. Clamp to `count`.
 */
function scoreSuggestions(
  suggestions: RecipeSuggestion[],
  signals: CookSignals,
  excludeDishes: string[],
  count: number,
): RecipeSuggestion[] {
  const exclude = new Set(excludeDishes.map((d) => d.toLowerCase()));
  const rejected = new Set(signals.rejected.map((r) => r.dish.toLowerCase()));
  const loved = new Set(signals.loved.map((l) => l.dish.toLowerCase()));
  const recent = new Set(signals.recent.map((r) => r.dish.toLowerCase()));

  const filtered = suggestions.filter((s) => {
    const lc = s.dish.toLowerCase();
    if (exclude.has(lc)) return false;
    if (rejected.has(lc)) return false;
    return true;
  });

  // Stable scoring sort.
  const scored = filtered
    .map((s, idx) => {
      const lc = s.dish.toLowerCase();
      let weight = 0;
      if (loved.has(lc)) weight -= 100;
      if (recent.has(lc) && signals.sampleSize >= COOK_SIGNAL_MIN_SAMPLE) weight += 50;
      return { s, idx, weight };
    })
    .sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return a.idx - b.idx;
    })
    .map((x) => x.s);

  return scored.slice(0, count);
}

// ─── recipe batch parsing (defensive) ────────────────────────────────────────

function parseRecipeBatch(raw: unknown): RecipeBatch {
  if (!raw || typeof raw !== 'object') return { suggestions: [], language: 'en' };
  const o = raw as Record<string, unknown>;
  const language: RecipeBatch['language'] =
    o.language === 'en' || o.language === 'es' || o.language === 'tr' || o.language === 'other'
      ? o.language
      : 'en';
  if (!Array.isArray(o.suggestions)) return { suggestions: [], language };
  const suggestions: RecipeSuggestion[] = [];
  for (const s of o.suggestions) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.dish !== 'string' || typeof r.cuisine !== 'string') continue;
    suggestions.push({
      dish: r.dish,
      cuisine: r.cuisine,
      diet: Array.isArray(r.diet) ? r.diet.filter((x): x is string => typeof x === 'string') : [],
      ingredients: Array.isArray(r.ingredients) ? coerceIngredients(r.ingredients) : [],
      steps: Array.isArray(r.steps) ? r.steps.filter((x): x is string => typeof x === 'string') : [],
      stepsDetailed: coerceStepsDetailed(r.stepsDetailed),
      prep: coercePrep(r.prep),
      prepMinutes: typeof r.prepMinutes === 'number' ? r.prepMinutes : 0,
      cookMinutes: typeof r.cookMinutes === 'number' ? r.cookMinutes : 0,
      servings: typeof r.servings === 'number' ? r.servings : 1,
      reasonSuggested: typeof r.reasonSuggested === 'string' ? r.reasonSuggested : undefined,
    });
  }
  return { suggestions, language };
}

/** Coerce the instructive steps array; returns undefined when absent/empty so
 *  the field simply doesn't serialise (client falls back to plain `steps`). */
function coerceStepsDetailed(raw: unknown): RecipeSuggestion['stepsDetailed'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<RecipeSuggestion['stepsDetailed']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    if (typeof s.do !== 'string') continue;
    out.push({
      do: s.do,
      cue: typeof s.cue === 'string' ? s.cue : undefined,
      tip: typeof s.tip === 'string' ? s.tip : undefined,
      minutes: typeof s.minutes === 'number' ? s.minutes : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Coerce the optional prep strip; undefined when nothing usable. */
function coercePrep(raw: unknown): RecipeSuggestion['prep'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const prep: NonNullable<RecipeSuggestion['prep']> = {};
  if (typeof p.pan === 'string') prep.pan = p.pan;
  if (typeof p.heat === 'string') prep.heat = p.heat;
  if (typeof p.handsOnMinutes === 'number') prep.handsOnMinutes = p.handsOnMinutes;
  return prep.pan || prep.heat || typeof prep.handsOnMinutes === 'number' ? prep : undefined;
}

function coerceIngredients(raw: unknown[]): RecipeSuggestion['ingredients'] {
  const out: RecipeSuggestion['ingredients'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    if (typeof i.name !== 'string') continue;
    out.push({
      name: i.name,
      canonical: typeof i.canonical === 'string' ? i.canonical : null,
      have: i.have === true,
      qty: typeof i.qty === 'number' ? i.qty : undefined,
      unit: typeof i.unit === 'string' ? i.unit : undefined,
    });
  }
  return out;
}

// ─── Voyage embed ────────────────────────────────────────────────────────────

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

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== VOYAGE_EMBED_DIM) {
    throw new Error('voyage returned unexpected shape');
  }
  return embedding;
}

// ─── pgvector cache lookup / write ───────────────────────────────────────────

interface CacheRow {
  id: string;
  classification: unknown;
  language: string;
}

async function cacheLookup(
  embedding: number[],
  module: string,
  userHash: string,
  env: FeedMeEnv,
): Promise<CacheRow | null> {
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
      // Per-user namespace (S2): the RPC filters on this so the lookup can only
      // match this user's own rows.
      p_user_hash: userHash,
    }),
  });
  if (!res.ok) {
    // 404 = per-user lookup overload not yet deployed → no hit, never cross-user.
    if (res.status === 404) return null;
    const detail = await res.text().catch(() => '');
    throw new Error(`routing_cache_lookup ${res.status}: ${detail.slice(0, 200)}`);
  }
  const rows = (await res.json()) as CacheRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function cacheHitUpdate(id: string, env: FeedMeEnv): Promise<void> {
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
  env: FeedMeEnv,
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
      // Per-user namespace (S2) — see route.ts cacheWrite.
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

// ─── shared prompt + parse helpers ───────────────────────────────────────────

/** Build the system prompt + user turn shared by every provider in the
 *  cascade. Gemini drives output via a function schema; the JSON-mode providers
 *  (groq/cloudflare/openrouter) append `jsonShapeInstruction` to the user turn. */
function buildBasePrompt(
  body: ValidatedBody,
  sanitizedPantry: string[],
  sanitizedPetName: string,
  signals: CookSignals,
): { systemPrompt: string; userTurn: string; config: typeof feedMeConfig | typeof petFeedConfig } {
  const isPet = body.feedTarget === 'pet';
  const config = isPet ? petFeedConfig : feedMeConfig;
  let systemPrompt: string;
  if (isPet) {
    const ctx: PetFeedPromptContext = {
      pantry: sanitizedPantry,
      locale: body.locale,
      count: body.count,
      petName: sanitizedPetName,
      signals,
      excludeDishes: body.excludeDishes,
    };
    systemPrompt = buildPetFeedSystemPrompt(ctx);
  } else {
    const ctx: FeedMePromptContext = {
      pantry: sanitizedPantry,
      diet: body.diet,
      locale: body.locale,
      count: body.count,
      signals,
      excludeDishes: body.excludeDishes,
    };
    systemPrompt = buildFeedMeSystemPrompt(ctx);
  }
  const userTurn = isPet
    ? `Plan ${body.count} safe meal(s) for ${sanitizedPetName} from PANTRY: ${sanitizedPantry.join(', ')}. Respond in ${body.locale}.`
    : `Suggest ${body.count} dishes I can cook from PANTRY: ${sanitizedPantry.join(', ')}. Diet: ${body.diet}. Respond in ${body.locale}.`;
  return { systemPrompt, userTurn, config };
}

/** JSON-shape contract appended to the user turn for the non-Gemini providers,
 *  which have no function-calling parity. Mirrors parseRecipeBatch's shape. */
function jsonShapeInstruction(count: number): string {
  return (
    `\n\nRespond with a JSON object EXACTLY of the form: ` +
    `{"language":"en"|"es"|"tr"|"other","suggestions":[{"dish":string,"cuisine":string,` +
    `"diet":string[],"ingredients":[{"name":string,"canonical":string|null,"have":boolean,` +
    `"qty"?:number,"unit"?:string}],"steps":string[],"prepMinutes":number,"cookMinutes":number,` +
    `"servings":number,"reasonSuggested":string}]}. ` +
    `The "suggestions" array MUST contain exactly ${count} item(s).`
  );
}

/** Token budget for the JSON-mode providers. A single recipe (ingredients +
 *  steps + metadata) runs ~400-600 JSON tokens, so a too-tight cap truncates
 *  the array mid-object → invalid JSON. Budget generously; these models stop at
 *  the closing brace well before the cap. */
function jsonMaxTokensFor(count: number): number {
  return 768 * count + 512;
}

/** Parse a raw string from a JSON-mode provider into a RecipeBatch. Some models
 *  (esp. Cloudflare's llama) wrap the object in prose or markdown despite the
 *  instruction, so on a failed direct parse we extract the outermost { … } span
 *  and retry before giving up. Throws (so the cascade advances) on hard failure
 *  or empty output. */
function parseJsonBatch(raw: string, provider: string): RecipeBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch {
        throw new Error(`feed-me ${provider} returned non-JSON content`);
      }
    } else {
      throw new Error(`feed-me ${provider} returned non-JSON content`);
    }
  }
  const batch = parseRecipeBatch(parsed);
  if (batch.suggestions.length === 0) {
    throw new Error(`feed-me ${provider} returned zero suggestions`);
  }
  return batch;
}

// ─── Gemini call ─────────────────────────────────────────────────────────────

async function geminiSuggest(
  body: ValidatedBody,
  sanitizedPantry: string[],
  sanitizedPetName: string,
  signals: CookSignals,
  apiKey: string,
): Promise<RecipeBatch> {
  const { systemPrompt, config } = buildBasePrompt(
    body,
    sanitizedPantry,
    sanitizedPetName,
    signals,
  );
  const isPet = body.feedTarget === 'pet';
  const fnSchema = config.buildFunctionSchema();

  // Few-shot examples.
  const contents: unknown[] = [];
  for (const ex of config.examples) {
    contents.push({ role: 'user', parts: [{ text: ex.input }] });
    contents.push({
      role: 'model',
      parts: [{ functionCall: { name: fnSchema.name, args: ex.output } }],
    });
  }
  // Actual query — short paraphrase of context so the model has something
  // to "respond to" beyond the system prompt.
  const userTurn = isPet
    ? `Plan ${body.count} safe meal(s) for ${sanitizedPetName} from PANTRY: ${sanitizedPantry.join(', ')}. Respond in ${body.locale}.`
    : `Suggest ${body.count} dishes I can cook from PANTRY: ${sanitizedPantry.join(', ')}. Diet: ${body.diet}. Respond in ${body.locale}.`;
  contents.push({ role: 'user', parts: [{ text: userTurn }] });

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: [fnSchema] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gemini ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ functionCall?: { name: string; args: unknown } }> };
    }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.functionCall?.name === fnSchema.name && part.functionCall?.args) {
      const batch = parseRecipeBatch(part.functionCall.args);
      if (batch.suggestions.length === 0) {
        throw new Error('gemini returned zero suggestions');
      }
      return batch;
    }
  }
  throw new Error('gemini returned no function call');
}

/** Groq fallback for the MISS path. Groq's OpenAI-style chat API has no
 *  function-calling parity with the Gemini schema here, so we ask for a JSON
 *  object matching parseRecipeBatch's shape directly (jsonMode) and reuse the
 *  same system prompt + few-shot examples. config.examples[].output is already
 *  the `{ language, suggestions }` shape Gemini's functionCall args use, so the
 *  examples serialize verbatim. */
async function groqSuggest(
  body: ValidatedBody,
  sanitizedPantry: string[],
  sanitizedPetName: string,
  signals: CookSignals,
  apiKey: string,
): Promise<RecipeBatch> {
  const { systemPrompt, userTurn, config } = buildBasePrompt(
    body,
    sanitizedPantry,
    sanitizedPetName,
    signals,
  );

  const messages: GroqMessage[] = [
    { role: 'system', content: systemPrompt + jsonShapeInstruction(body.count) },
  ];
  for (const ex of config.examples) {
    messages.push({ role: 'user', content: ex.input });
    messages.push({ role: 'assistant', content: JSON.stringify(ex.output) });
  }
  messages.push({ role: 'user', content: userTurn });

  const choice = await groqChat(
    { apiKey, messages, jsonMode: true, maxTokens: jsonMaxTokensFor(body.count) },
    'feed-me',
  );
  const content = choice.message.content ?? '';
  if (!content) {
    throw new Error(`feed-me groq empty content (finish=${choice.finish_reason})`);
  }
  return parseJsonBatch(content, 'groq');
}

// Re-export the upstreamError helper for tests + parity with sibling modules.
export { upstreamError };
