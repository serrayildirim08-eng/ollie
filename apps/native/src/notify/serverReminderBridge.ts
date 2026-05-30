/**
 * apps/native · server-reminder bridge installer
 *
 * Wires the injectable `scheduleServerReminder` capability (see
 * ./serverReminder) to the real durable path: `scheduleServerJob` →
 * Supabase `scheduled_jobs` row → cron drain → APNs. This is the
 * composition root that hands the pure reminder handlers everything
 * `ServerScheduleDeps` needs — `{ api, authJwt, userId, budget }` — WITHOUT
 * leaking auth / api into the handlers themselves.
 *
 * Auth/api/userId seam (confirmed during the wire):
 *   - authJwt → Clerk session JWT via `useAuth().getToken()` (the same
 *     bearer every worker + Supabase REST call in this app already uses;
 *     see DumpScreen.getBearer / FeedMeView).
 *   - userId  → Clerk `useAuth().userId`.
 *   - api     → an OllieAPI built from the native Vite env (same Supabase
 *     URL + anon key the supabase-js client uses). The native app talks to
 *     Supabase REST through @ollie/api elsewhere via this exact shape.
 *   - budget  → read from the encrypted client store via readBudget().
 *
 * `useServerReminderBridge()` is a hook mounted under <SignedIn> (in the
 * Router). It installs a resolver that reads the LATEST token/userId at
 * fire-time, so a reminder scheduled mid-session always carries fresh auth.
 *
 * Degrades gracefully: if env is unconfigured, token resolution fails, or
 * the user is signed out, the resolver bails before touching the network —
 * `scheduleServerJob` itself also returns {ok:false} in those cases. The
 * primary task-row write is never blocked.
 */

import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { createOllieAPI, type OllieAPI } from '@ollie/api';
import {
  scheduleServerJob,
  readBudget,
  type NotificationSpec,
} from '@ollie/notifications';
import { store } from '../store';
import { setServerReminder, clearServerReminder } from './serverReminder';

/**
 * Lazily build a single OllieAPI from the native Vite env. Returns null
 * when Supabase config is absent (e.g. test env, misconfigured build) so
 * the bridge degrades to a no-op instead of throwing.
 */
let _apiCache: OllieAPI | null | undefined;
function getApi(): OllieAPI | null {
  if (_apiCache !== undefined) return _apiCache;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !supabaseAnonKey) {
    _apiCache = null;
    return null;
  }
  _apiCache = createOllieAPI({ supabaseUrl, supabaseAnonKey });
  return _apiCache;
}

/**
 * Install the durable server-reminder path. Mounted once under <SignedIn>.
 * Re-installs whenever the Clerk auth identity changes so the resolver
 * always closes over the current getToken / userId.
 */
export function useServerReminderBridge(): void {
  const { getToken, userId } = useAuth();

  useEffect(() => {
    setServerReminder((spec: NotificationSpec, fireAt: number) => {
      // Fire-and-forget async resolution — the handler does not await us.
      void (async () => {
        const api = getApi();
        if (!api || !userId) return; // not configured / signed out → no-op
        let authJwt: string | null = null;
        try {
          authJwt = await getToken();
        } catch {
          return; // token fetch failed → leave the client timer as the only path
        }
        if (!authJwt) return;
        // Stamp the user's encrypted budget so the cron can enforce
        // cap + per-category mute server-side (it can't decrypt it itself).
        const budget = readBudget(store);
        await scheduleServerJob({ api, authJwt, userId, budget }, spec, fireAt);
      })();
    });

    return () => {
      // On sign-out / identity change, fall back to the no-op so a stale
      // closure can't POST with the previous user's identity.
      clearServerReminder();
    };
  }, [getToken, userId]);
}
