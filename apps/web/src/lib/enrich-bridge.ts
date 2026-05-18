/**
 * apps/web · enrich-dump bridge
 *
 * Fire-and-forget POST of a brain-dump payload to the ai-proxy worker's
 * `/enrich-dump` endpoint. Never blocks the UI. Never throws.
 *
 * Consent gate is the caller's responsibility — typically the
 * useApplyBrainDump hook checks `research.hasConsent()` before invoking.
 *
 * Auth: the worker's `/enrich-dump` endpoint requires a verified Supabase
 * user JWT. We attach `Authorization: Bearer <jwt>` from the booted auth
 * client. If no session JWT is available, we skip the request entirely —
 * an unauthenticated POST would just 401, and this is a best-effort path.
 */

import { getAccount } from './account-boot';

interface ViteEnv {
  VITE_AI_WORKER_URL?: string;
}

const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

/**
 * Default JWT source — the Supabase access token off the booted auth
 * client. Same access path as lib/invite.ts · getJwt(). Returns null
 * pre-sign-in or before bootAccount() has run.
 */
function defaultGetJwt(): string | null {
  try {
    return getAccount()?.auth.state().session?.access_token ?? null;
  } catch {
    return null;
  }
}

export interface EnrichDumpInput {
  user_hash: string;
  device_id: string;
  app_version: string;
  raw_text: string;
  modality: 'voice' | 'text' | 'paste';
  routing_module: string | null;
  country: string;
  locale: string;
}

export interface EnrichDumpDeps {
  fetchImpl?: typeof fetch;
  workerUrl?: string | undefined;
  now?: () => number;
  /** Injectable JWT source — defaults to the booted auth client's session. */
  getJwt?: () => string | null;
}

export function postEnrichDump(input: EnrichDumpInput, deps: EnrichDumpDeps = {}): void {
  const workerUrl = deps.workerUrl ?? env.VITE_AI_WORKER_URL;
  if (!workerUrl) return; // dev / unconfigured
  if (!input.user_hash) return; // pre-sign-in dumps stay local
  if (!input.raw_text) return;

  // The worker requires a verified Supabase JWT. No session → skip; an
  // unauthenticated POST would only 401, and this path is best-effort.
  const jwt = (deps.getJwt ?? defaultGetJwt)();
  if (!jwt) return;

  const f = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!f) return;

  const now = deps.now ?? (() => Date.now());
  const payload = {
    user_hash: input.user_hash,
    device_id: input.device_id,
    event_ts: new Date(now()).toISOString(),
    locale: input.locale || 'en',
    country: input.country || 'INTL',
    modality: input.modality,
    raw_text: input.raw_text,
    routing_module: input.routing_module,
    app_version: input.app_version || 'dev',
  };

  const url = `${workerUrl.replace(/\/$/, '')}/enrich-dump`;
  try {
    void f(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => { /* best-effort */ });
  } catch {
    /* best-effort */
  }
}
