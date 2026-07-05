/**
 * deleteAccount — calls the apps/api account-delete worker (report §F).
 *
 * Contract (apps/api · account-delete.ts): POST to VITE_ACCOUNT_DELETE_URL with
 *   - Authorization: Bearer <Clerk session JWT>   (proves identity)
 *   - body { confirm: "DELETE" }                  (guards accidental/CSRF fire)
 * On 2xx the worker has erased every user-scoped row + the Clerk user.
 *
 * Honesty: the worker is not deployed in every build. When the URL is unset we
 * return `unconfigured` so the UI can say so plainly rather than pretend to
 * delete — mirrors the VITE_PUSH_REGISTER_URL no-op pattern.
 */

import { track } from '../api/analytics';

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'unauthorized' | 'error'; message: string };

export async function deleteAccount(
  getJwt: () => Promise<string | null>,
): Promise<DeleteResult> {
  const url = import.meta.env.VITE_ACCOUNT_DELETE_URL as string | undefined;
  if (!url) {
    return {
      ok: false,
      reason: 'unconfigured',
      message: 'account deletion is not available in this build yet.',
    };
  }

  const jwt = await getJwt().catch(() => null);
  if (!jwt) {
    return { ok: false, reason: 'unauthorized', message: 'please sign in again.' };
  }

  // Funnel telemetry BEFORE the delete request — after a 2xx the user (and
  // their JWT) are gone, so this is the last moment the row can be written.
  track('account_deleted');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'unauthorized', message: 'please sign in again.' };
    }
    return {
      ok: false,
      reason: 'error',
      message: `could not delete right now (server ${res.status}).`,
    };
  } catch {
    return { ok: false, reason: 'error', message: 'no connection. try again.' };
  }
}
