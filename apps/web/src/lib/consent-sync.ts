/**
 * apps/web · consent durable-sync sink (Sprint B'' Item 4 · 2026-05-14)
 *
 * Fire-and-forget POST of a consent state change to the ai-proxy worker's
 * `/ingest-event` endpoint, writing a `consent_audit` row to Supabase. Wired
 * into `@ollie/consent` via `configureConsent({ sync })` in App.tsx.
 *
 * Why a separate sink (not just emit `consent:set` and let a subscriber
 * handle it): the in-app code that toggles a setting can't be sure that
 * the research-stream subscriber is mounted yet (auth races, lazy boot),
 * and the consent_audit row is load-bearing for the legal trail. The
 * package-level sync hook fires unconditionally on every write — even
 * from contexts (CLI, tests) that never spin up a research stream.
 *
 * Privacy:
 *   - We send the consent state itself (the user already agreed to that).
 *   - We send user_hash (already sent on every research row) + minimal
 *     environment fields. No raw text. No email. No IP (worker drops it).
 *   - We send unconditionally — even when research_optin is false — because
 *     the audit row is the legal record of opting OUT, not a research row.
 *     Auditing the opt-out IS the legitimate-interest basis.
 *
 * Failure mode: silent. Local store is the source of truth; this is the
 * durable backup. The consent package wraps the call in `.catch(() => {})`
 * already (see packages/consent/src/index.ts ~L186).
 */

import type { ConsentState, ConsentSync } from '@ollie/consent';
import { readUserHash } from './user-hash';
import { getAppVersion } from './device';

interface ViteEnv {
  VITE_AI_WORKER_URL?: string;
}

const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

export interface ConsentSyncDeps {
  fetchImpl?: typeof fetch;
  workerUrl?: string | undefined;
  /** Read the canonical user hash. Injectable for tests. */
  readUserHashImpl?: () => string | null;
  /** Read the app version string. Injectable for tests. */
  readAppVersionImpl?: () => string;
  /** Read navigator.userAgent. Injectable for tests + node. */
  readUserAgentImpl?: () => string;
}

/**
 * Build a `ConsentSync` function with injectable deps. The result can be
 * passed straight into `configureConsent({ sync })`.
 *
 * The returned function is async to satisfy the ConsentSync contract but
 * resolves synchronously after firing the request — actual network work
 * runs in the background.
 */
export function createConsentSync(deps: ConsentSyncDeps = {}): ConsentSync {
  return async function sync(state: ConsentState, _userId: string): Promise<void> {
    const workerUrl = deps.workerUrl ?? env.VITE_AI_WORKER_URL;
    if (!workerUrl) {
      // TODO Sprint B''+1: surface a dev warning if VITE_AI_WORKER_URL is
      // unset in production builds. For local dev this is the expected path.
      return;
    }

    const userHash = (deps.readUserHashImpl ?? readUserHash)();
    if (!userHash) {
      // Pre-auth consent writes (the very first ConsentStep mount) have no
      // user_hash yet — deriveUserHash() runs on sign-in. Skip durable
      // sync; the next consent write (settings toggle) will catch up.
      return;
    }

    const appVersion = (deps.readAppVersionImpl ?? getAppVersion)();
    const userAgent =
      (deps.readUserAgentImpl ?? (() => (typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 200)
        : '')))();

    const row = {
      user_hash: userHash,
      consent_necessary: state.necessary,
      consent_marketing: state.marketing,
      // research_optin can be true/false/null — Supabase column is nullable
      // for the legacy-prompt sentinel. Send as-is.
      consent_research_optin: state.research_optin,
      consented_at: new Date(state.set_at || Date.now()).toISOString(),
      event_source: 'consent_sync',
      user_agent: userAgent,
      app_version: appVersion,
    };

    const f = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!f) return;

    const url = `${workerUrl.replace(/\/$/, '')}/ingest-event`;
    try {
      void f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table: 'consent_audit', row }),
      }).catch(() => { /* best-effort */ });
    } catch {
      /* best-effort */
    }
  };
}
