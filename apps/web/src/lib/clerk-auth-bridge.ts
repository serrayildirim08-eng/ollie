/**
 * apps/web · Clerk auth bridge
 *
 * The problem this solves:
 *   `getAuthJwt()` (account-boot.ts) is a SYNC function called by clients
 *   that themselves are sync (aiRoute, label-client, enrich-bridge, the
 *   /generate-invite caller). Clerk's `session.getToken()` is async.
 *   Awaiting it at every callsite would ripple through ~5 modules and
 *   their tests.
 *
 * The fix:
 *   A tiny module-scope ref. A React component up the tree (ClerkAuthBridge)
 *   subscribes to `useAuth().getToken` + `useAuth().sessionId` and writes
 *   the latest token (and userId) into this ref whenever Clerk refreshes.
 *   Clerk session tokens are short-lived (~60s) and the SDK refreshes them
 *   automatically; the ref stays fresh in practice. `getAuthJwt()` reads
 *   the ref synchronously.
 *
 *   Trade-off: in the ~milliseconds after a sign-in, before the bridge
 *   first writes, getAuthJwt() returns null. Callers already treat null
 *   as "skip the request" (documented best-effort degrade), so this is
 *   the existing degrade path, not a new one.
 *
 * NOT for: encrypted-vault keys, passphrases, anything PII. The ref holds
 * a short-lived JWT and a Clerk user id (opaque `user_…` string). It is
 * cleared on sign-out by the bridge.
 */

let currentJwt: string | null = null;
let currentUserId: string | null = null;

/** Called by ClerkAuthBridge whenever Clerk refreshes the session token. */
export function setClerkAuth(jwt: string | null, userId: string | null): void {
  currentJwt = jwt;
  currentUserId = userId;
}

/** Sync read of the latest Clerk session JWT. Returns null when unsigned-in. */
export function readClerkJwt(): string | null {
  return currentJwt;
}

/** Sync read of the latest Clerk user id (`user_…`). Null when unsigned-in. */
export function readClerkUserId(): string | null {
  return currentUserId;
}

/**
 * Test seam — drop the cached values so tests start clean.
 * NOT for production use.
 */
export function _resetClerkAuthBridge(): void {
  currentJwt = null;
  currentUserId = null;
}
