/**
 * apps/web · account boot (Credibility audit C2 fix)
 *
 * Wires the orphaned Sprint 2 packages into the running app:
 *   - @ollie/api      → centralised fetch client
 *   - @ollie/auth     → email/passphrase session + encryption key
 *   - @ollie/sync     → encrypted multi-device sync (when signed in)
 *   - @ollie/research-stream → opt-in anonymous capture
 *
 * Boot order:
 *   1. Create the OllieAPI singleton with Supabase URL + anon key
 *      from Vite env. If env is missing, the helpers gracefully no-op.
 *   2. Create the auth client. Hand-off if a session is already in
 *      store. Otherwise wait for the auth UI to call signIn/signUp.
 *   3. When auth becomes "unlocked", boot the sync client.
 *   4. Independently: hook the research-stream client up so its toggle
 *      surfaces (Garden consent screen + future settings) work.
 *
 * Everything here is best-effort. Failures degrade to local-only mode
 * (current behavior pre-fix) — they never throw or block first paint.
 */

import { createOllieAPI } from '@ollie/api';
import type { OllieAPI } from '@ollie/api';
import { createAuthClient } from '@ollie/auth';
import type { AuthClient } from '@ollie/auth';
import { createSyncClient, createFinanceSyncClient } from '@ollie/sync';
import type { SyncClient, FinanceSyncClient } from '@ollie/sync';
import { createResearchStream } from '@ollie/research-stream';
import type { ResearchClient } from '@ollie/research-stream';
import * as events from '@ollie/events';
import { store } from '../store';

interface ViteEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_ANTHROPIC_PROXY_URL?: string;
  VITE_RESEARCH_ENDPOINT?: string;
  VITE_AI_WORKER_URL?: string;
  VITE_USER_HASH_SALT?: string;
}

const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

interface AccountBootHandles {
  api: OllieAPI;
  auth: AuthClient;
  research: ResearchClient;
  sync: SyncClient | null;
  /** Per-record finance sync (Sprint 5). Lives alongside module-blob sync. */
  financeSync: FinanceSyncClient | null;
}

let handles: AccountBootHandles | null = null;

/** Singleton accessor — returns null until bootAccount() has run. */
export function getAccount(): AccountBootHandles | null {
  return handles;
}

/**
 * One-time boot. Idempotent. Call once at app start.
 */
export function bootAccount(): AccountBootHandles {
  if (handles) return handles;

  const api = createOllieAPI({
    anthropicProxy: env.VITE_ANTHROPIC_PROXY_URL,
    supabaseUrl: env.VITE_SUPABASE_URL,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
  });

  const auth = createAuthClient({ store, api });

  const research = createResearchStream({
    store,
    api,
    endpointUrl: env.VITE_RESEARCH_ENDPOINT,
    ingestUrl: env.VITE_AI_WORKER_URL,
  });
  // Start the research flush loop unconditionally; track() is a no-op
  // until consent is granted, so the loop is harmless when off.
  research.start();

  handles = { api, auth, research, sync: null, financeSync: null };

  // If a session is already in store from a previous run, the auth
  // client's `state()` reports it. But the in-memory encryption key
  // is gone after a reload — we can't decrypt anything until the
  // user signs in again on this device. That UX flow is owned by the
  // future sign-in screen; here we just expose the session so it can
  // be read.
  const sessionAlreadyPresent = !!auth.state().session;
  if (sessionAlreadyPresent && auth.state().unlocked) {
    // Cold boot won't typically reach this branch (key in memory only)
    // but kept for completeness — sync attaches automatically.
    void attachSync();
  }

  // On future sign-in / sign-up, the auth client emits auth:signed_in.
  events.on('auth:signed_in', () => { void attachSync(); });
  events.on('auth:signed_out', () => { detachSync(); });

  return handles;
}

async function attachSync(): Promise<void> {
  if (!handles) return;
  const session = handles.auth.state().session;
  const key = handles.auth.encryptionKey();
  if (!session || !key) return;

  if (!handles.sync) {
    const sync = createSyncClient({
      store,
      api: handles.api,
      userId: session.user_id,
      authJwt: session.access_token,
      encryptionKey: key,
    });
    await sync.start();
    handles.sync = sync;
  }

  if (!handles.financeSync) {
    const financeSync = createFinanceSyncClient({
      store,
      api: handles.api,
      userId: session.user_id,
      authJwt: session.access_token,
      encryptionKey: key,
    });
    await financeSync.start();
    handles.financeSync = financeSync;
  }
}

function detachSync(): void {
  if (!handles) return;
  if (handles.sync) {
    try { handles.sync.stop(); } catch { /* noop */ }
    handles.sync = null;
  }
  if (handles.financeSync) {
    try { handles.financeSync.stop(); } catch { /* noop */ }
    handles.financeSync = null;
  }
}
