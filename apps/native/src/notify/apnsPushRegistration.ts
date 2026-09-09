/**
 * apps/native · APNs push-token registration
 *
 * On native iOS, once the user is signed in, this hook asks for push
 * permission, fetches the APNs device token via `tauri-plugin-mobile-push`,
 * and POSTs it to the existing worker `/register-token` so it lands in
 * `push_tokens` (the cron drain JOINs on user_id).
 *
 * Auth seam (audit H9): the register call authenticates with the user's Clerk
 * JWT (sent as `x-user-jwt`); the worker verifies it and derives user_id from
 * the verified `sub`, so a client can only register a token for itself. We no
 * longer ship a shared secret in the build. Mirrors serverReminderBridge's
 * compose-at-the-edge style (read identity inside the effect, degrade to no-op).
 *
 * Guards:
 *   - Tauri-only: bails immediately in a plain browser (no __TAURI_INTERNALS__),
 *     so the web/desktop-dev surfaces never touch the native plugin.
 *   - The plugin is dynamically imported INSIDE the effect so a non-Tauri
 *     bundle never eagerly loads native bindings.
 *   - Missing VITE_PUSH_REGISTER_URL → log + no-op (unconfigured build).
 *   - Permission denied → no-op.
 *   - All network/plugin errors are swallowed; the hook never throws.
 *
 * Re-runs whenever the Clerk `userId` changes so a token registered mid-session
 * always carries the current identity.
 */

import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';

export function useApnsPushRegistration(): void {
  const { userId, getToken: getClerkToken } = useAuth();

  useEffect(() => {
    // Native-only: in a plain browser there is no APNs token to fetch.
    if (!('__TAURI_INTERNALS__' in window)) return;
    // Only register once the user is signed in (the row is keyed by user_id).
    if (!userId) return;

    let cancelled = false;

    void (async () => {
      try {
        const registerUrl = import.meta.env.VITE_PUSH_REGISTER_URL as
          | string
          | undefined;
        if (!registerUrl) {
          console.warn(
            '[apns] VITE_PUSH_REGISTER_URL unset — skipping push registration',
          );
          return;
        }
        // Auth: the worker derives user_id from this verified Clerk JWT
        // (audit H9) — we no longer ship a shared secret in the build.
        const jwt = await getClerkToken();
        if (cancelled || !jwt) return;

        // Dynamically import so non-Tauri bundles never load native bindings.
        const { requestPermission, getToken } = await import(
          'tauri-plugin-mobile-push-api'
        );

        const { granted } = await requestPermission();
        if (!granted) return;

        const token = await getToken();
        if (cancelled || !token) return;

        await fetch(registerUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-user-jwt': jwt,
          },
          body: JSON.stringify({
            token,
            platform: 'ios',
          }),
        });
      } catch (err) {
        // Never throw out of the effect — push registration is best-effort.
        console.warn('[apns] push registration failed', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);
}
