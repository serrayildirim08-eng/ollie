/**
 * Shared per-user rate-limit machinery.
 *
 * Extracted from index.ts so request handlers (e.g. the A6b server-apply
 * routes) can enforce the same limit AFTER they have resolved the
 * authenticated user id, without a circular import back into index.ts.
 *
 * Prefers the native Cloudflare Rate Limiting binding (atomic at the edge —
 * fixes the read-then-write race the KV counter had). Falls back to the legacy
 * KV fixed-window counter when the binding is not present, so a deploy that has
 * not yet picked up the [[ratelimits]] config still enforces a limit.
 */

/**
 * Cloudflare native Rate Limiting binding. `limit()` is atomic edge-side,
 * which fixes the read-then-write race the KV counter had.
 */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export const RATE_MAX = 10; // req/min — default
export const RATE_WINDOW_SEC = 60;

/**
 * Rate-limit check. Prefers the native Cloudflare Rate Limiting binding.
 * Falls back to the legacy KV fixed-window counter when the binding is
 * absent. `maxOverride` only affects the KV fallback branch — when the
 * binding is live the per-binding wrangler.toml limit wins.
 */
export async function checkRate(
  limiter: RateLimiter | undefined,
  kv: KVNamespace,
  key: string,
  maxOverride?: number,
): Promise<boolean> {
  if (limiter) {
    const { success } = await limiter.limit({ key });
    return success;
  }
  // Legacy fallback — racy fixed-window KV counter.
  const max = maxOverride ?? RATE_MAX;
  const now = Math.floor(Date.now() / 1000);
  const slot = `${key}:${Math.floor(now / RATE_WINDOW_SEC)}`;
  const raw = await kv.get(slot);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= max) return false;
  await kv.put(slot, String(count + 1), { expirationTtl: RATE_WINDOW_SEC * 2 + 1 });
  return true;
}
