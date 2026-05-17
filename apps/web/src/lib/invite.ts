/**
 * apps/web · invite client (Task 21 + Task 22)
 *
 * Thin wrapper over the three worker endpoints:
 *   POST /generate-invite  → { code, share_url, expires_at, remaining? }
 *   POST /validate-invite  → { valid, reason? }
 *   POST /claim-invite     → { success, reason? }
 *
 * Worker base URL: VITE_AI_WORKER_URL (also used by ai-proxy).
 * JWT pulled from the boot'd auth client when present.
 *
 * Beta gate: every fetch is best-effort; non-2xx responses surface
 * `{ ok: false, code, message }` so the UI can render dry copy without
 * a try/catch in every caller.
 */

import { getAccount } from './account-boot';

interface ViteEnv {
  VITE_AI_WORKER_URL?: string;
}
const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

const BETA_INVITE_REQUIRED = false;

export function isBetaInviteRequired(): boolean {
  return BETA_INVITE_REQUIRED;
}

export interface InviteRecord {
  code: string;
  share_url: string;
  expires_at: number;
  remaining?: number;
}

export interface InviteError {
  ok: false;
  code:
    | 'no-endpoint'
    | 'no-session'
    | 'network'
    | 'rate-limited'
    | 'invalid'
    | 'http';
  message: string;
}

export type GenerateResult = ({ ok: true } & InviteRecord) | InviteError;
export type ValidateResult =
  | { ok: true; valid: true }
  | { ok: true; valid: false; reason: string }
  | InviteError;
export type ClaimResult =
  | { ok: true; success: true }
  | { ok: true; success: false; reason: string }
  | InviteError;

function workerUrl(path: string): string | null {
  const base = (env.VITE_AI_WORKER_URL ?? '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}${path}`;
}

function getJwt(): string | null {
  try {
    const account = getAccount();
    return account?.auth.state().session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  opts: { needsJwt: boolean } = { needsJwt: true },
): Promise<{ ok: true; data: T } | InviteError> {
  const url = workerUrl(path);
  if (!url) {
    return { ok: false, code: 'no-endpoint', message: 'invite service not configured' };
  }
  const jwt = getJwt();
  if (opts.needsJwt && !jwt) {
    return { ok: false, code: 'no-session', message: 'sign in to continue' };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['x-user-jwt'] = jwt;

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    return {
      ok: false,
      code: 'network',
      message: 'network error: ' + (err as Error).message,
    };
  }
  if (res.status === 429) {
    return { ok: false, code: 'rate-limited', message: 'rate-limited — try later' };
  }
  if (!res.ok) {
    return { ok: false, code: 'http', message: `request failed (${res.status})` };
  }
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    return { ok: false, code: 'invalid', message: 'invalid response' };
  }
  return { ok: true, data };
}

export async function generateInvite(): Promise<GenerateResult> {
  const r = await post<{
    code: string;
    share_url: string;
    expires_at: number;
    remaining?: number;
  }>('/generate-invite', {});
  if (!r.ok) return r;
  const d = r.data;
  if (!d?.code || !d?.share_url) {
    return { ok: false, code: 'invalid', message: 'malformed invite response' };
  }
  return {
    ok: true,
    code: d.code,
    share_url: d.share_url,
    expires_at: typeof d.expires_at === 'number' ? d.expires_at : 0,
    remaining: typeof d.remaining === 'number' ? d.remaining : undefined,
  };
}

export async function validateInvite(code: string): Promise<ValidateResult> {
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) {
    return { ok: true, valid: false, reason: 'empty code' };
  }
  const r = await post<{ valid: boolean; reason?: string }>(
    '/validate-invite',
    { code: trimmed },
    { needsJwt: false },
  );
  if (!r.ok) return r;
  if (r.data.valid === true) return { ok: true, valid: true };
  return { ok: true, valid: false, reason: r.data.reason ?? 'unknown' };
}

export async function claimInvite(
  code: string,
  inviteeUserHash: string,
): Promise<ClaimResult> {
  const r = await post<{ success: boolean; reason?: string }>('/claim-invite', {
    code: code.trim().toLowerCase(),
    invitee_user_hash: inviteeUserHash,
  });
  if (!r.ok) return r;
  if (r.data.success === true) return { ok: true, success: true };
  return { ok: true, success: false, reason: r.data.reason ?? 'unknown' };
}

// ─── deep-link parser (Task 22) ──────────────────────────────────────────────

const SESSION_KEY = 'ollie.pending_invite_code';

/**
 * Read invite code from query string `?invite=…`, hash `#invite=…`, or
 * Capacitor deep-link `ollie://invite/xxx`. Stores in sessionStorage so
 * the onboarding gate can pre-fill, then strips the param from the URL.
 *
 * Idempotent — safe to call on every boot. No-op when no code is present.
 */
export function captureInviteFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  let code: string | null = null;

  try {
    const qs = new URLSearchParams(window.location.search);
    const fromQuery = qs.get('invite');
    if (fromQuery) code = fromQuery;
  } catch { /* noop */ }

  if (!code) {
    try {
      const hash = window.location.hash || '';
      // `#invite=abc` or `#/invite/abc` — accept either
      const m = hash.match(/(?:^|[#&/])invite[=/]([\w-]+)/i);
      if (m && m[1]) code = m[1];
    } catch { /* noop */ }
  }

  if (!code) return null;

  const normalized = code.trim().toLowerCase();
  try {
    sessionStorage.setItem(SESSION_KEY, normalized);
  } catch { /* noop */ }

  // Strip invite param from URL so reloads don't re-fire and the user
  // doesn't accidentally share their landing URL with the code baked in.
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    let cleanHash = url.hash;
    cleanHash = cleanHash.replace(/(?:^|[#&])invite[=/][\w-]+/i, '').replace(/^[#&]+/, '');
    url.hash = cleanHash ? `#${cleanHash}` : '';
    window.history.replaceState({}, '', url.toString());
  } catch { /* noop */ }

  return normalized;
}

/** Capacitor deep link from `ollie://invite/xxx`. Called by capacitor-deeplink.ts. */
export function captureInviteFromDeeplink(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith('ollie://invite')) return null;
  const path = url.slice('ollie://'.length); // "invite/xxx" or "invite?code=xxx"
  let code: string | null = null;
  const m = path.match(/^invite\/([\w-]+)/i);
  if (m && m[1]) code = m[1];
  if (!code) {
    try {
      const qs = new URLSearchParams(path.split('?')[1] ?? '');
      code = qs.get('code');
    } catch { /* noop */ }
  }
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  try {
    sessionStorage.setItem(SESSION_KEY, normalized);
  } catch { /* noop */ }
  return normalized;
}

export function readPendingInviteCode(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInviteCode(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* noop */ }
}
