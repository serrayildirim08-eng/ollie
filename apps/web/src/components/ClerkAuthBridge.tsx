/**
 * apps/web · ClerkAuthBridge
 *
 * Sole responsibility: pump the active Clerk session token + user id into
 * the sync `clerk-auth-bridge` ref so non-React modules (account-boot,
 * aiRoute, invite client, label client, enrich bridge, research-stream)
 * can read it without going async.
 *
 * Why this exists: Clerk's `useAuth().getToken()` is async + only reachable
 * from React. The callers downstream of `getAuthJwt()` are sync and many
 * (~5 modules). Awaiting at each callsite would mean churning 5 modules
 * + their tests for no functional difference — Clerk tokens are short
 * lived (≈60s) and refresh automatically, so a small cache stays fresh.
 *
 * Refresh strategy: drain the token on every render where Clerk reports
 * a new `sessionId`. We also poll once a minute as a backstop in case the
 * session id stays stable but the underlying JWT was rotated (rare; the
 * sessionId typically rotates with the token, but the docs do not
 * guarantee it).
 *
 * Renders nothing.
 */

import { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { setClerkAuth } from '../lib/clerk-auth-bridge';

const REFRESH_INTERVAL_MS = 60_000; // 1 min — Clerk JWT TTL is ~60s

export function ClerkAuthBridge(): null {
  const { isLoaded, isSignedIn, userId, sessionId, getToken } = useAuth();

  // Push the latest token whenever Clerk's session changes. We also bind
  // an interval as a backstop — Clerk auto-refreshes the underlying JWT
  // but the React hooks do not always re-render on a rotation, so we
  // re-pull on a cadence.
  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !userId) {
      // Signed out — clear the ref so a stale token cannot be replayed.
      setClerkAuth(null, null);
      return;
    }

    let cancelled = false;

    async function pump(): Promise<void> {
      try {
        const jwt = await getToken();
        if (cancelled) return;
        setClerkAuth(jwt ?? null, userId ?? null);
      } catch {
        // Best effort — a network blip leaves the previous (still-valid)
        // token in place rather than nuking it.
      }
    }

    void pump();
    const handle = setInterval(() => {
      void pump();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // sessionId is included so a session swap (sign-out + sign-in as
    // another user) immediately re-pumps with the new identity.
  }, [isLoaded, isSignedIn, userId, sessionId, getToken]);

  return null;
}
