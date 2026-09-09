/**
 * Cloudflare Vectorize wrapper · per-user-namespaced routing cache for /route/dump.
 *
 * Provisioning (one-time, per environment):
 *   wrangler vectorize create ollie-routing-cache \
 *     --dimensions=1024 \
 *     --metric=cosine
 *   (binding name in wrangler.toml: VECTORIZE_INDEX)
 *
 * Cache shape:
 *   id        = sha256(userId + ':' + textNormalized)
 *   values    = voyage-multilingual-2 embedding (1024-dim)
 *   metadata  = {
 *     userId,                        // Clerk sub
 *     module: Module,                // final routed module
 *     payload: ActionPayload,        // discriminated union (JSON-encoded)
 *     confidence: number,
 *     language: FragmentLanguage,
 *     hitCount: number,              // popularity (Decision 3)
 *     lastHitAt: number,             // ms since epoch (eviction signal)
 *     createdAt: number,
 *   }
 *
 * NEVER stored: raw fragment text. Only the embedding + metadata.
 * (Decision-7 invariant — routing_cache holds embedding + label only.)
 *
 * Eviction policy (Decision 3): popularity-weighted with 30-day decay,
 * 10,000 entries per user cap. Enforced lazily on writes — when a new
 * upsert for a user pushes the count over cap, the oldest-low-popularity
 * entries are deleted.
 */

import type { Module } from './dump-schema';

const SIMILARITY_THRESHOLD = 0.85;
const CAP_PER_USER = 10_000;
const DECAY_DAYS = 30;
const DECAY_MS = DECAY_DAYS * 24 * 60 * 60 * 1000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface VectorizeIndex {
  query(
    vector: number[],
    options?: { topK?: number; filter?: Record<string, unknown>; returnMetadata?: boolean | 'all' },
  ): Promise<VectorizeMatchSet>;
  upsert(vectors: VectorizeVector[]): Promise<VectorizeMutationResult>;
  deleteByIds(ids: string[]): Promise<VectorizeMutationResult>;
}

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
  namespace?: string;
}

export interface VectorizeMatchSet {
  matches: Array<{
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  count: number;
}

export interface VectorizeMutationResult {
  mutationId: string;
}

export interface CacheRow {
  id: string;
  module: Module;
  payload: Record<string, unknown>;
  confidence: number;
  language: string;
  similarity: number;
  hitCount: number;
  /** Original creation time (ms). Carried through so cacheHitBump can write it
   *  back unchanged — otherwise the TTL clock would reset (or zero) on every
   *  bump and the entry would self-expire after a single hit (audit S2 · fix 1). */
  createdAt: number;
}

/**
 * Look up a cached classification by embedding similarity within a user's namespace.
 */
export async function cacheLookup(
  index: VectorizeIndex,
  userId: string,
  embedding: number[],
): Promise<CacheRow | null> {
  const result = await index.query(embedding, {
    topK: 1,
    filter: { userId },
    returnMetadata: 'all',
  });

  if (!result.matches || result.matches.length === 0) return null;
  const top = result.matches[0];
  if (top.score < SIMILARITY_THRESHOLD) return null;

  const meta = top.metadata ?? {};

  // TTL: drop entries older than 30 days (misclassified entries would poison cache forever).
  const createdAt = typeof meta.createdAt === 'number' ? meta.createdAt : 0;
  if (Date.now() - createdAt > TTL_MS) return null;

  // payload is stored as a JSON string — Vectorize metadata cannot hold
  // nested objects. Parse it back; tolerate legacy object-shaped rows.
  let payload: Record<string, unknown> = {};
  if (typeof meta.payload === 'string') {
    try { payload = JSON.parse(meta.payload) as Record<string, unknown>; } catch { payload = {}; }
  } else if (meta.payload && typeof meta.payload === 'object') {
    payload = meta.payload as Record<string, unknown>;
  }

  return {
    id: top.id,
    module: meta.module as Module,
    payload,
    confidence: typeof meta.confidence === 'number' ? meta.confidence : 0.8,
    language: typeof meta.language === 'string' ? meta.language : 'unknown',
    similarity: top.score,
    hitCount: typeof meta.hitCount === 'number' ? meta.hitCount : 0,
    createdAt,
  };
}

/**
 * Insert or update a cache entry. Hashes (userId, text) for stable id.
 * Fire-and-forget from the router — never blocks the response.
 */
export async function cacheUpsert(
  index: VectorizeIndex,
  params: {
    userId: string;
    text: string;
    embedding: number[];
    module: Module;
    payload: Record<string, unknown>;
    confidence: number;
    language: string;
  },
): Promise<void> {
  const id = await stableId(params.userId, params.text);
  const now = Date.now();
  await index.upsert([
    {
      id,
      values: params.embedding,
      metadata: {
        userId: params.userId,
        module: params.module,
        // Vectorize metadata is flat — nested objects are rejected. Store
        // the payload as a JSON string; cacheLookup parses it back.
        payload: JSON.stringify(params.payload),
        confidence: params.confidence,
        language: params.language,
        hitCount: 0,
        lastHitAt: now,
        createdAt: now,
      },
    },
  ]);
}

/**
 * On a cache hit, bump hitCount + lastHitAt. Fire-and-forget.
 */
export async function cacheHitBump(
  index: VectorizeIndex,
  row: CacheRow,
  userId: string,
  embedding: number[],
): Promise<void> {
  await index.upsert([
    {
      id: row.id,
      values: embedding,
      metadata: {
        userId,
        module: row.module,
        payload: JSON.stringify(row.payload),
        confidence: row.confidence,
        language: row.language,
        hitCount: row.hitCount + 1,
        lastHitAt: Date.now(),
        // PRESERVE the original createdAt. A re-upsert overwrites the whole
        // metadata blob, so omitting this dropped createdAt to undefined → the
        // next cacheLookup TTL check (Date.now() - 0 > TTL) treated the entry as
        // expired and returned null, killing the cache after one hit (audit S2 ·
        // fix 1). Fall back to now() only for a legacy row that never had one.
        createdAt: row.createdAt > 0 ? row.createdAt : Date.now(),
      },
    },
  ]);
}

/**
 * Decision 3: popularity-weighted score for eviction. Higher = keep.
 *   score = hitCount * exp(-Δt / 30d)
 *
 * Called from the eviction sweep job (separate cron worker — not invoked
 * synchronously from the request path).
 */
export function evictionScore(hitCount: number, lastHitAt: number, now = Date.now()): number {
  const ageMs = Math.max(0, now - lastHitAt);
  return hitCount * Math.exp(-ageMs / DECAY_MS);
}

/**
 * Delete all Vectorize entries for a given user namespace.
 * Use when a user reports systematic misclassification and needs a clean slate.
 *
 * Vectorize does not support filter-based delete; we query with a zero vector
 * to pull all entry ids for the user (topK capped at 10k = CAP_PER_USER),
 * then delete by id. Fire-and-forget safe — caller can void the result.
 */
export async function invalidateCacheForUser(
  userId: string,
  index: VectorizeIndex,
): Promise<{ deleted: number }> {
  const zero = new Array<number>(1024).fill(0);
  const result = await index.query(zero, {
    topK: CAP_PER_USER,
    filter: { userId },
    returnMetadata: false,
  });

  if (!result.matches || result.matches.length === 0) return { deleted: 0 };

  const ids = result.matches.map((m) => m.id);
  await index.deleteByIds(ids);
  return { deleted: ids.length };
}

export const VECTORIZE_DEFAULTS = {
  SIMILARITY_THRESHOLD,
  CAP_PER_USER,
  DECAY_DAYS,
  TTL_MS,
};

/**
 * Stable id derived from (userId, normalized text). Same user uttering
 * the same phrase reuses the same id, preserving hitCount + popularity.
 *
 * Normalization: lowercase + collapse whitespace. We intentionally do
 * NOT strip diacritics because TR/ES diacritics carry meaning.
 */
async function stableId(userId: string, text: string): Promise<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const data = new TextEncoder().encode(`${userId}:${normalized}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
