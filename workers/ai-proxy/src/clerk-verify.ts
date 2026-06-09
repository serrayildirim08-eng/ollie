/**
 * Clerk JWT verification (Phase 3 of the Clerk migration · T0).
 *
 * Verifies a Clerk session JWT against the project's JWKS (rotated keys
 * published by Clerk). Returns the Clerk user id (the `sub` claim) on
 * success, null on any failure — never throws, callers gate on null/non-null.
 *
 * Why JWKS instead of `clerk.dev/v1/me` round-trip:
 *   - Latency: JWKS is fetched once and cached, verify is local (Web Crypto).
 *   - Correctness: JWT signature verify is the canonical Clerk-recommended
 *     server-side check (see clerk.com/docs/backend-requests/handling/manual-jwt).
 *   - No upstream rate-limit risk.
 *
 * Caching:
 *   The JWKS is cached for the lifetime of the worker isolate (typically
 *   minutes). On a kid miss we refetch once (handles key rotation without a
 *   redeploy). JOSE's `createRemoteJWKSet` already implements this pattern.
 *
 * Required env (set as wrangler secret):
 *   CLERK_ISSUER — e.g. https://faithful-stag-15.clerk.accounts.dev
 *                  (the publishable key encodes this domain; the issuer is
 *                  exactly the JWKS host without the path).
 *
 * The JWKS URL is derived: `${CLERK_ISSUER}/.well-known/jwks.json`.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

export interface ClerkVerifyEnv {
  CLERK_ISSUER?: string;
}

/**
 * Per-isolate JWKS cache. `createRemoteJWKSet` already handles in-memory
 * caching + rotation refetch; we just keep one set per issuer so a single
 * worker that ever talks to multiple Clerk instances stays correct.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(issuer);
  if (cached) return cached;
  const url = new URL(`${issuer.replace(/\/$/, '')}/.well-known/jwks.json`);
  const set = createRemoteJWKSet(url);
  jwksCache.set(issuer, set);
  return set;
}

/**
 * Verify a Clerk session JWT and return the Clerk user id (`sub` claim).
 *
 * Returns null on:
 *   - missing CLERK_ISSUER env (the worker is not configured for Clerk yet)
 *   - signature failure / expired / wrong issuer / malformed
 *   - any unexpected throw inside `jwtVerify`
 */
export async function verifyClerkJwt(
  jwt: string,
  env: ClerkVerifyEnv,
): Promise<string | null> {
  if (!env.CLERK_ISSUER) return null;
  if (!jwt || typeof jwt !== 'string') return null;
  try {
    const jwks = getJwks(env.CLERK_ISSUER);
    const { payload }: { payload: JWTPayload } = await jwtVerify(jwt, jwks, {
      issuer: env.CLERK_ISSUER,
    });
    const sub = payload.sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Test seam — drop the per-isolate JWKS cache so tests can stub the network
 * fetch and not see a stale set from a previous run. NOT for production use.
 */
export function _resetClerkJwksCache(): void {
  jwksCache.clear();
}
