/**
 * Shared bearer-token accessor (audit #181).
 *
 * Four screens (PartnerBox, PartnerCard, TodayNoticings, FeedMeView) each
 * hand-rolled a `getBearer` callback over `useAuth().getToken()`, and they
 * had drifted on the no-token fallback (some returned `''`, one returned
 * `null`, only one caught the throw). This is the single contract:
 *
 *   - returns the Clerk session JWT when signed in,
 *   - returns `null` when there is no usable token (signed out, refresh
 *     failure, or `getToken()` threw),
 *   - never throws.
 *
 * Consumers treat a falsy bearer as "not signed in" (`if (!bearer)`), so a
 * `null` and an empty string are equivalent at every call site; `null` is
 * the truthful value and avoids the "empty string looks like a token"
 * footgun.
 *
 * Returns a stable, memoised callback so it's safe in effect/callback deps.
 */
import { useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';

export type BearerFn = () => Promise<string | null>;

export function useBearer(): BearerFn {
  const { getToken } = useAuth();
  return useCallback(async () => {
    try {
      return (await getToken()) ?? null;
    } catch {
      return null;
    }
  }, [getToken]);
}
