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

import { json, upstreamError } from '@ollie/worker-http';
import { scrubPII, type Locale } from '@ollie/pii-scrub';
import { verifyClerkJwt } from '../clerk-verify';
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
  T0_JWT_ENFORCED?: string;
  CLERK_ISSUER?: string;
}

// ─── types ───────────────────────────────────────────────────────────────────

export type FeedTarget = 'user' | 'pet';
export type FeedSource = 'gemini' | 'cache_hit' | 'static_fallback';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // ── Auth + ownership ─────────────────────────────────────────────────────
  if (env.T0_JWT_ENFORCED === '1') {
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

  // ── Parse + validate body ────────────────────────────────────────────────
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
    cacheRow = await cacheLookup(embedding, moduleLabel, env);
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

  // ── MISS path — Gemini ───────────────────────────────────────────────────
  let batch: RecipeBatch;
  try {
    batch = await geminiSuggest(
      body,
      sanitizedPantry,
      sanitizedPetName,
      signals,
      env.GEMINI_API_KEY,
    );
  } catch (err) {
    console.error('[feed-me] gemini failed, returning static_fallback', err);
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
    env,
  ).catch((e) => console.error('[feed-me] cache write failed', e));

  const finalResp: FeedMeResponse = {
    suggestions: trimmed,
    source: 'gemini',
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
      prepMinutes: typeof r.prepMinutes === 'number' ? r.prepMinutes : 0,
      cookMinutes: typeof r.cookMinutes === 'number' ? r.cookMinutes : 0,
      servings: typeof r.servings === 'number' ? r.servings : 1,
      reasonSuggested: typeof r.reasonSuggested === 'string' ? r.reasonSuggested : undefined,
    });
  }
  return { suggestions, language };
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
    }),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    const detail = await res.text().catch(() => '');
    throw new Error(`routing_cache_lookup ${res.status}: ${detail.slice(0, 200)}`);
  }
  const rows = (await res.json()) as CacheRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function cacheHitUpdate(id: string, env: FeedMeEnv): Promise<void> {
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
      text_sample: text.slice(0, 500),
      embedding,
      classification,
      language,
      hit_count: 0,
      last_hit_at: new Date().toISOString(),
    }),
  });
}

// ─── Gemini call ─────────────────────────────────────────────────────────────

async function geminiSuggest(
  body: ValidatedBody,
  sanitizedPantry: string[],
  sanitizedPetName: string,
  signals: CookSignals,
  apiKey: string,
): Promise<RecipeBatch> {
  const isPet = body.feedTarget === 'pet';
  const config = isPet ? petFeedConfig : feedMeConfig;
  const fnSchema = config.buildFunctionSchema();

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

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

// Re-export the upstreamError helper for tests + parity with sibling modules.
export { upstreamError };
