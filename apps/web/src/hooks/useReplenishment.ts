/**
 * useReplenishment — per-user, observed-cadence replenishment estimates.
 *
 * The frontend half of the adaptive-replenishment spec
 * (`docs/handoffs/grocery-routing/05-ADAPTIVE-REPLENISHMENT.md`). The hook
 * pulls a Map of `canonical → ReplenishmentEstimate` from the worker's
 * `GET /replenishment/:user` endpoint and exposes a `refresh()` so a
 * downstream write (the shop checkbox handler firing
 * `recordGroceryPurchase`) can re-pull a fresh estimate without remounting.
 *
 * State machine:
 *   idle  ─(userId set)──▶ loading ─(fetch ok)──▶ ready
 *                                  ─(fetch err)─▶ ready (empty Map)
 *   ready ─(refresh)─────▶ loading ─...
 *
 * Cache:
 *   60s stale-while-revalidate against the worker's `Cache-Control:
 *   max-age=60`. A second call inside the window short-circuits to the
 *   in-memory Map; the hook only re-fetches when the window has elapsed
 *   OR `refresh()` is called explicitly.
 *
 * Fallback:
 *   The static SHELF_LIFE_MAP (synced from
 *   `workers/ai-proxy/src/modules/grocery.config.ts`) is the cold-start
 *   fallback. `staticEstimate(canonical)` returns a `confidence: 'static'`
 *   record the UI can render when the worker has no observed history yet.
 *   Exported so callers (badge sites) can paper over an empty Map without
 *   the hook itself ever pretending to have data it doesn't.
 *
 * Auth:
 *   Forwards the Clerk JWT via `getAuthJwt()`. Returns an empty Map (i.e.
 *   the consumer falls through to static estimates everywhere) when the
 *   token isn't ready yet — the documented degrade path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthJwt } from '../lib/account-boot';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ReplenishmentConfidence = 'static' | 'low-data' | 'observed';

export interface ReplenishmentEstimate {
  /** the canonical key (matches CANONICAL_ITEMS in grocery.config) */
  canonical: string;
  /** days until the user is projected to need this item again */
  daysLeft: number;
  /** how the estimate was sourced — drives the badge confidence treatment */
  confidence: ReplenishmentConfidence;
  /** number of past purchases that informed this estimate (0 for static) */
  sampleSize: number;
  /** the user's median interval (or the static fallback) in days */
  medianIntervalDays: number;
  /** Unix epoch ms of the most recent observed purchase, 0 when none */
  lastPurchaseTs: number;
}

export interface UseReplenishmentResult {
  /** Map keyed by canonical → estimate. Empty when nothing is loaded yet. */
  estimates: Map<string, ReplenishmentEstimate>;
  /** Re-pull fresh estimates from the worker (bypasses the 60s cache). */
  refresh: () => void;
  /** true while a fetch is in flight (initial or refresh). */
  loading: boolean;
}

// ─── Static fallback — synced with grocery.config SHELF_LIFE_MAP ──────────────
//
// Keep in lock-step with `workers/ai-proxy/src/modules/grocery.config.ts`
// `SHELF_LIFE_MAP`. Listed here so the badge can render a sensible number
// before the user has any observed history. The worker still does the
// observed math when data exists; this is the cold-start floor only.

export const STATIC_SHELF_LIFE: Record<string, number> = {
  // dairy + eggs
  milk: 7, yogurt: 21, cheese: 30, feta: 30, butter: 60, cream: 10, egg: 28,
  mozzarella: 14, parmesan: 90,
  // protein
  chicken: 2, 'ground beef': 2, beef: 4, lamb: 4, pork: 4, fish: 2, shrimp: 2,
  sausage: 14, bacon: 14, ham: 7, salami: 21,
  // produce
  tomato: 7, onion: 30, garlic: 90, potato: 30, 'sweet potato': 21,
  carrot: 21, celery: 14, cucumber: 7, zucchini: 7, eggplant: 7,
  'bell pepper': 10, spinach: 5, lettuce: 7,
  apple: 30, banana: 7, lemon: 30, lime: 30, orange: 30,
  // pantry staples
  bread: 7, pasta: 730, rice: 1825, flour: 365, oats: 365,
};

const DEFAULT_SHELF_DAYS = 14;
const CACHE_TTL_MS = 60_000;

// ─── Env access (Vite import.meta) ────────────────────────────────────────────

interface ImportMetaEnv {
  VITE_AI_WORKER_URL?: string;
  VITE_AI_PROXY_URL?: string;
}

/**
 * Optional override for the worker URL. Set by tests via
 * `_setReplenishmentWorkerUrlForTests()`; in production `null` means the
 * code falls back to `import.meta.env.VITE_AI_WORKER_URL`.
 */
let workerUrlOverride: string | null | undefined = undefined;

function readWorkerUrl(): string | undefined {
  if (workerUrlOverride !== undefined) {
    return workerUrlOverride ?? undefined;
  }
  const env = (import.meta as unknown as { env?: ImportMetaEnv }).env ?? {};
  const url = env.VITE_AI_WORKER_URL ?? env.VITE_AI_PROXY_URL;
  return url && url.length > 0 ? url : undefined;
}

/**
 * test-only — pin the worker base URL. Pass `null` to simulate the
 * "no worker configured" branch; pass `undefined` to restore the default
 * `import.meta.env` lookup.
 */
export function _setReplenishmentWorkerUrlForTests(url: string | null | undefined): void {
  workerUrlOverride = url;
}

// ─── In-memory cache (module scope so refresh across components is shared) ────

interface CacheEntry {
  ts: number;
  map: Map<string, ReplenishmentEstimate>;
}
const cache = new Map<string, CacheEntry>();

/** test-only — reset module-scope cache between vitest runs */
export function _resetReplenishmentCache(): void {
  cache.clear();
}

/**
 * devtool-only — seed the module-scope cache so the hook resolves
 * instantly to a fixture map on next mount/refresh. Used by
 * `installReplenishmentMockFromURL()` and storybook decorators.
 */
export function _seedReplenishmentCacheForMock(
  userId: string,
  map: Map<string, ReplenishmentEstimate>,
): void {
  cache.set(userId, { ts: Date.now(), map });
}

// ─── Wire-format the worker returns ──────────────────────────────────────────

interface WireEstimate {
  canonical: string;
  daysLeft: number;
  confidence: ReplenishmentConfidence;
  sampleSize: number;
  medianIntervalDays: number;
  lastPurchaseTs: number;
}

interface WireResponse {
  estimates: WireEstimate[];
}

function isWireEstimate(x: unknown): x is WireEstimate {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.canonical === 'string' &&
    typeof o.daysLeft === 'number' &&
    (o.confidence === 'static' || o.confidence === 'low-data' || o.confidence === 'observed') &&
    typeof o.sampleSize === 'number' &&
    typeof o.medianIntervalDays === 'number' &&
    typeof o.lastPurchaseTs === 'number'
  );
}

function parseWire(raw: unknown): Map<string, ReplenishmentEstimate> {
  const out = new Map<string, ReplenishmentEstimate>();
  if (!raw || typeof raw !== 'object') return out;
  const arr = (raw as WireResponse).estimates;
  if (!Array.isArray(arr)) return out;
  for (const e of arr) {
    if (isWireEstimate(e)) out.set(e.canonical, { ...e });
  }
  return out;
}

// ─── Public hook ──────────────────────────────────────────────────────────────

/**
 * Subscribe to the user's adaptive replenishment estimates.
 *
 * Returns an empty Map (and `loading: false`) when `userId` is null — the
 * consumer should fall through to `staticEstimate(canonical)` per item.
 */
export function useReplenishment(userId: string | null): UseReplenishmentResult {
  const [estimates, setEstimates] = useState<Map<string, ReplenishmentEstimate>>(
    () => {
      if (!userId) return new Map();
      const entry = cache.get(userId);
      return entry ? entry.map : new Map();
    },
  );
  const [loading, setLoading] = useState<boolean>(false);

  // a counter that, when bumped, forces a re-fetch — refresh() bumps it
  const [tick, setTick] = useState(0);
  // abort latest fetch on unmount or new tick
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!userId) {
      setEstimates(new Map());
      setLoading(false);
      return;
    }

    // honour 60s cache unless this is an explicit refresh tick
    const cached = cache.get(userId);
    const fresh = cached && Date.now() - cached.ts < CACHE_TTL_MS;
    if (fresh && tick === 0) {
      setEstimates(cached.map);
      setLoading(false);
      return;
    }

    const baseUrl = readWorkerUrl();
    if (!baseUrl) {
      // no worker configured — degrade silently to empty Map
      setEstimates(new Map());
      setLoading(false);
      return;
    }

    const token = getAuthJwt();
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);

    fetch(`${baseUrl}/replenishment/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          // 404 / 5xx — fall back to empty Map (consumer uses staticEstimate)
          return new Map<string, ReplenishmentEstimate>();
        }
        const json: unknown = await res.json().catch(() => null);
        return parseWire(json);
      })
      .then((map) => {
        if (controller.signal.aborted) return;
        cache.set(userId, { ts: Date.now(), map });
        setEstimates(map);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // network error — leave whatever we had, stop the spinner
        if (err instanceof Error && err.name === 'AbortError') return;
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [userId, tick]);

  return { estimates, refresh, loading };
}

// ─── Static fallback exported for badge sites ─────────────────────────────────

/**
 * Cold-start estimate from the static shelf-life map. Used when the worker
 * has no observed history for an item yet. Confidence is always 'static'.
 *
 * The badge layer renders this in italic + faded so the reader sees the
 * estimate is a guess, not their pattern.
 */
export function staticEstimate(canonical: string): ReplenishmentEstimate {
  const key = canonical.toLowerCase().trim();
  const days = STATIC_SHELF_LIFE[key] ?? DEFAULT_SHELF_DAYS;
  return {
    canonical: key,
    daysLeft: days,
    confidence: 'static',
    sampleSize: 0,
    medianIntervalDays: days,
    lastPurchaseTs: 0,
  };
}

/**
 * Pluck the estimate for one canonical with the static fallback already
 * applied. Convenience for the row-render call-sites so they don't repeat
 * `estimates.get(k) ?? staticEstimate(k)` everywhere.
 */
export function resolveEstimate(
  estimates: Map<string, ReplenishmentEstimate>,
  canonical: string,
): ReplenishmentEstimate {
  const key = canonical.toLowerCase().trim();
  return estimates.get(key) ?? staticEstimate(key);
}
