/**
 * useFeedMe — Feed Me v2 suggestion stream.
 *
 * The frontend half of the Feed Me v2 spec
 * (`docs/handoffs/feed-me/00-SPEC.md`). The hook POSTs the user's pantry +
 * diet + feedTarget to `POST /feed-me/:user` on the ai-proxy worker and
 * returns up to N recipe suggestions, source flag, loading + error state,
 * and an explicit `refresh()`.
 *
 * State machine:
 *   idle   ─(userId set)──▶ loading ─(2xx) ──▶ ready(source=gemini|cache_hit)
 *                                   ─(5xx) ──▶ ready(source=static_fallback, empty list)
 *                                   ─(net err)▶ ready(source=static_fallback)
 *   ready  ─(query change OR refresh)─▶ loading ─...
 *
 * Cache:
 *   60s in-memory keyed by `JSON.stringify(query)` (after canonical sort).
 *   An identical query within the window short-circuits to the cached
 *   result. `refresh()` forces a re-fetch by bumping a tick counter that
 *   bypasses the cache.
 *
 * Static fallback:
 *   When the worker is unreachable / errors / returns malformed JSON, the
 *   hook reports `source: 'static_fallback'` and an empty `suggestions`
 *   array. `FeedMeView` is expected to fall through to the existing
 *   `inferRecipe` static path so the user still sees one recipe — never
 *   leaves them hanging.
 *
 * Auth:
 *   Forwards the Clerk JWT via `getAuthJwt()`. Returns the static-fallback
 *   shape when the token isn't ready yet (same degrade contract as
 *   useReplenishment).
 *
 * Telemetry:
 *   Emits `feedme:requested` on fetch start and `feedme:suggested` on every
 *   resolve (including the static-fallback path). Cook + reject events are
 *   emitted from the view layer where the user-intent originates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { emit } from '@ollie/events';
import { getAuthJwt } from '../lib/account-boot';

// ─── Public types ─────────────────────────────────────────────────────────────

export type FeedMeDiet =
  | 'all'
  | 'vegetarian'
  | 'vegan'
  | 'mediterranean'
  | 'turkish';

export type FeedMeTarget = 'user' | 'pet';

export type FeedMeLocale = 'en' | 'es' | 'tr';

export type FeedMeSource =
  | 'gemini'
  | 'cache_hit'
  | 'static_fallback'
  | 'loading';

export interface RecipeIngredient {
  name: string;
  canonical: string | null;
  have: boolean;
  qty?: number;
  unit?: string;
}

export interface RecipeSuggestion {
  dish: string;
  cuisine: string;
  diet: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  reasonSuggested?: string;
}

export interface FeedMeQuery {
  pantry: string[];
  diet?: FeedMeDiet;
  feedTarget?: FeedMeTarget;
  petName?: string | null;
  count?: number;
  locale?: FeedMeLocale;
  excludeDishes?: string[];
}

export interface UseFeedMeResult {
  suggestions: RecipeSuggestion[];
  source: FeedMeSource;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ─── Env access (mirrors useReplenishment) ───────────────────────────────────

interface ImportMetaEnv {
  VITE_AI_WORKER_URL?: string;
  VITE_AI_PROXY_URL?: string;
}

let workerUrlOverride: string | null | undefined = undefined;

function readWorkerUrl(): string | undefined {
  if (workerUrlOverride !== undefined) {
    return workerUrlOverride ?? undefined;
  }
  const env =
    (import.meta as unknown as { env?: ImportMetaEnv }).env ?? {};
  const url = env.VITE_AI_WORKER_URL ?? env.VITE_AI_PROXY_URL;
  return url && url.length > 0 ? url : undefined;
}

export function _setFeedMeWorkerUrlForTests(
  url: string | null | undefined,
): void {
  workerUrlOverride = url;
}

// ─── In-memory cache (module scope) ───────────────────────────────────────────

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  ts: number;
  suggestions: RecipeSuggestion[];
  source: FeedMeSource;
}

const cache = new Map<string, CacheEntry>();

export function _resetFeedMeCache(): void {
  cache.clear();
}

/**
 * devtool-only — seed the module-scope cache so a fixture loads
 * synchronously on the next mount. Used by `feedMeMock` ?mock=… install.
 */
export function _seedFeedMeCacheForMock(
  key: string,
  entry: { suggestions: RecipeSuggestion[]; source: FeedMeSource },
): void {
  cache.set(key, {
    ts: Date.now(),
    suggestions: entry.suggestions,
    source: entry.source,
  });
}

/**
 * The canonical cache key for a query. Sort the pantry + excludeDishes
 * arrays so two queries with the same content but different array order
 * collapse to one entry.
 */
export function feedMeCacheKey(
  userId: string,
  query: FeedMeQuery,
): string {
  const pantry = [...(query.pantry ?? [])]
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length > 0)
    .sort();
  const exclude = [...(query.excludeDishes ?? [])]
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length > 0)
    .sort();
  const compact = {
    u: userId,
    d: query.diet ?? 'all',
    t: query.feedTarget ?? 'user',
    p: query.petName ?? null,
    n: query.count ?? 3,
    l: query.locale ?? 'en',
    pantry,
    exclude,
  };
  return JSON.stringify(compact);
}

// ─── Wire-format parsing ──────────────────────────────────────────────────────

interface WireResponse {
  suggestions: RecipeSuggestion[];
  source: 'gemini' | 'cache_hit' | 'static_fallback';
  latencyMs: number;
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === 'string');
}

function isRecipeIngredient(x: unknown): x is RecipeIngredient {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    (o.canonical === null || typeof o.canonical === 'string') &&
    typeof o.have === 'boolean'
  );
}

function isRecipeSuggestion(x: unknown): x is RecipeSuggestion {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.dish === 'string' &&
    typeof o.cuisine === 'string' &&
    isStringArray(o.diet) &&
    Array.isArray(o.ingredients) &&
    o.ingredients.every(isRecipeIngredient) &&
    isStringArray(o.steps) &&
    typeof o.prepMinutes === 'number' &&
    typeof o.cookMinutes === 'number' &&
    typeof o.servings === 'number'
  );
}

function parseWire(raw: unknown): WireResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  // Required shape: `suggestions` must be an array. A response missing the
  // field (or with a non-array under it) is malformed → static fallback.
  if (!Array.isArray(o.suggestions)) return null;
  const suggestions = o.suggestions.filter(isRecipeSuggestion);
  const sourceRaw = typeof o.source === 'string' ? o.source : 'gemini';
  const source: WireResponse['source'] =
    sourceRaw === 'cache_hit' || sourceRaw === 'static_fallback'
      ? sourceRaw
      : 'gemini';
  const latencyMs = typeof o.latencyMs === 'number' ? o.latencyMs : 0;
  return { suggestions, source, latencyMs };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const STATIC_FALLBACK: Pick<UseFeedMeResult, 'suggestions' | 'source'> = {
  suggestions: [],
  source: 'static_fallback',
};

export function useFeedMe(
  userId: string | null,
  query: FeedMeQuery,
): UseFeedMeResult {
  const [suggestions, setSuggestions] = useState<RecipeSuggestion[]>([]);
  const [source, setSource] = useState<FeedMeSource>('loading');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  // Snapshot the query into a stable cache key so the effect dep is a
  // primitive — saves a deep-compare on every render.
  const cacheKey = userId ? feedMeCacheKey(userId, query) : '';

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!userId) {
      setSuggestions(STATIC_FALLBACK.suggestions);
      setSource(STATIC_FALLBACK.source);
      setLoading(false);
      setError(null);
      return;
    }

    const baseUrl = readWorkerUrl();
    if (!baseUrl) {
      // no worker configured — degrade silently to static fallback
      setSuggestions(STATIC_FALLBACK.suggestions);
      setSource(STATIC_FALLBACK.source);
      setLoading(false);
      setError(null);
      return;
    }

    // honour 60s cache unless this is an explicit refresh tick
    const cached = cache.get(cacheKey);
    const fresh = cached && Date.now() - cached.ts < CACHE_TTL_MS;
    if (fresh && tick === 0) {
      setSuggestions(cached.suggestions);
      setSource(cached.source);
      setLoading(false);
      setError(null);
      return;
    }

    // Fire telemetry on every real fetch (not on cache hits).
    emit('feedme:requested', {
      pantryCount: query.pantry?.length ?? 0,
      diet: query.diet ?? 'all',
      feedTarget: query.feedTarget ?? 'user',
      ts: Date.now(),
    });

    const token = getAuthJwt();
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setSource('loading');

    const requestStarted = Date.now();
    const body: FeedMeQuery = {
      pantry: query.pantry ?? [],
      diet: query.diet ?? 'all',
      feedTarget: query.feedTarget ?? 'user',
      petName: query.petName ?? null,
      count: query.count ?? 3,
      locale: query.locale ?? 'en',
      excludeDishes: query.excludeDishes ?? [],
    };

    fetch(`${baseUrl}/feed-me/${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          // 4xx / 5xx → static fallback; caller renders inferRecipe
          return { kind: 'fallback' as const, errMsg: `http_${res.status}` };
        }
        const json: unknown = await res.json().catch(() => null);
        const parsed = parseWire(json);
        if (!parsed) {
          return { kind: 'fallback' as const, errMsg: 'malformed_response' };
        }
        return { kind: 'ok' as const, parsed };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        const latencyMs = Date.now() - requestStarted;
        if (result.kind === 'fallback') {
          setSuggestions(STATIC_FALLBACK.suggestions);
          setSource(STATIC_FALLBACK.source);
          setError(result.errMsg);
          setLoading(false);
          emit('feedme:suggested', {
            source: 'static_fallback',
            count: 0,
            latencyMs,
            ts: Date.now(),
          });
          return;
        }
        const { parsed } = result;
        const finalSource: FeedMeSource =
          parsed.source === 'cache_hit' ? 'cache_hit' : parsed.source;
        cache.set(cacheKey, {
          ts: Date.now(),
          suggestions: parsed.suggestions,
          source: finalSource,
        });
        setSuggestions(parsed.suggestions);
        setSource(finalSource);
        setError(null);
        setLoading(false);
        emit('feedme:suggested', {
          source: finalSource,
          count: parsed.suggestions.length,
          latencyMs: parsed.latencyMs || latencyMs,
          ts: Date.now(),
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        // Network failure → static fallback with the error captured.
        const message = err instanceof Error ? err.message : 'network_error';
        setSuggestions(STATIC_FALLBACK.suggestions);
        setSource(STATIC_FALLBACK.source);
        setError(message);
        setLoading(false);
        emit('feedme:suggested', {
          source: 'static_fallback',
          count: 0,
          latencyMs: Date.now() - requestStarted,
          ts: Date.now(),
        });
      });

    return () => {
      controller.abort();
    };
    // We intentionally key only on `userId`, the serialized `cacheKey`,
    // and the `tick`. `query` itself is a fresh object on every render so
    // listing it would re-fire on every parent re-render — the cacheKey
    // covers content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, cacheKey, tick]);

  return { suggestions, source, loading, error, refresh };
}

// ─── "I cooked this" write helper ─────────────────────────────────────────────

export interface CookHistoryWrite {
  dish: string;
  cuisine?: string;
  diet?: string[];
  rating: -1 | 0 | 1;
  feedTarget: FeedMeTarget;
  petName?: string | null;
  ingredientsUsed?: Array<{ name: string; canonical: string | null }>;
}

/**
 * POST a cook-history row to `${AI_PROXY_URL}/cook-history`. Fire-and-forget
 * from the UI; resolves to `true` on success, `false` on error. Backend
 * endpoint contract (open to senior, see report):
 *
 *   POST /cook-history
 *   { dish, cuisine?, diet?, rating, feedTarget, petName?, ingredientsUsed? }
 *   → 201 { id: string } | 4xx { error: string }
 *
 * Telemetry: `feedme:cooked` always emits (even when the write fails) so
 * the research stream sees the user-intent. The write itself is the side
 * effect; the event is the signal.
 */
export async function postCookHistory(
  userId: string,
  payload: CookHistoryWrite,
): Promise<boolean> {
  // Always emit the telemetry first so a network error doesn't drop the
  // signal. The research stream is the source of truth for "what got
  // cooked"; the DB row is the source of truth for "score the next call".
  emit('feedme:cooked', {
    dish: payload.dish,
    rating: payload.rating,
    ts: Date.now(),
  });

  const baseUrl = readWorkerUrl();
  if (!baseUrl) return false;
  const token = getAuthJwt();
  try {
    const res = await fetch(`${baseUrl}/cook-history`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ userId, ...payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
