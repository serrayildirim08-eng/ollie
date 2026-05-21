/**
 * Invite endpoints for the ai-proxy worker.
 *
 *   POST /generate-invite — authed user mints a single-use code.
 *   POST /validate-invite — landing page checks a code before signup.
 *   POST /claim-invite    — atomically marks a code used at signup.
 *
 * Auth model:
 *   - generate-invite + claim-invite require a Supabase user JWT in the
 *     `x-user-jwt` header. We verify by calling `/auth/v1/user` against the
 *     anon key and trust the returned user id. The inviter_user_hash and
 *     invitee_user_hash are SHA-256(email + VITE_USER_HASH_SALT) supplied
 *     by the client — same hash the rest of the telemetry pipeline uses.
 *   - validate-invite is unauthenticated (the landing page must read it
 *     pre-signup) and returns no PII — only validity + reason.
 *
 * Rate limit:
 *   5 generate-invite calls per user per 24h via RATE_KV. Validate and
 *   claim are not user-rate-limited but rely on the per-IP CF rate limit.
 *
 * Code shape:
 *   `olli-XXXX-YYYY` where X/Y are drawn from a 32-char alphabet with
 *   the visually ambiguous 0/o/1/l/I removed. Lower-cased.
 */

import { json, upstreamError } from '@ollie/worker-http';
import { verifyClerkJwt } from './clerk-verify';

export interface InvitesEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  SUPABASE_ANON_KEY: string;
  /**
   * Clerk issuer URL — e.g. https://faithful-stag-15.clerk.accounts.dev.
   * Set as a wrangler secret on deploy. When present, the JWT verify path
   * tries Clerk first; when absent, behaviour is identical to pre-Clerk
   * (Supabase-only). Migration-safe: a deploy with no CLERK_ISSUER keeps
   * existing Supabase-authed sessions working.
   */
  CLERK_ISSUER?: string;
  INVITE_BASE_URL?: string;
  RATE_KV: KVNamespace;
}

const SUPABASE_REST_TIMEOUT_MS = 8_000;
const RATE_MAX_PER_DAY = 5;
const RATE_WINDOW_SEC = 60 * 60 * 24; // 24h
const INVITE_TTL_DAYS = 30;

// Alphabet: lowercase letters + digits minus visually ambiguous chars.
// Excluded: 0 (zero), o, 1 (one), l (lowercase L), i.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// ─── /generate-invite ──────────────────────────────────────────────────────────

interface GenerateInviteRequest {
  inviter_user_hash: string;
}

export async function handleGenerateInvite(req: Request, env: InvitesEnv): Promise<Response> {
  const jwt = req.headers.get('x-user-jwt');
  if (!jwt) return json({ error: 'missing_auth' }, 401);

  const userId = await verifyJwt(jwt, env);
  if (!userId) return json({ error: 'invalid_auth' }, 401);

  let body: GenerateInviteRequest;
  try {
    body = (await req.json()) as GenerateInviteRequest;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body || typeof body.inviter_user_hash !== 'string' || !body.inviter_user_hash) {
    return json({ error: 'invalid_payload' }, 400);
  }

  // Per-user 24h rate limit — keyed on JWT user id, not the hash, so a
  // user that re-hashes (e.g. email change) cannot reset their bucket.
  const allowed = await checkInviteRate(env.RATE_KV, userId);
  if (!allowed) {
    return json({ error: 'rate_limited', limit: RATE_MAX_PER_DAY, window_hours: 24 }, 429);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  // Generate a fresh code. Retry up to 3 times if we hit a UNIQUE collision
  // on the `code` column (vanishingly unlikely with 30^8 keyspace, but
  // worth handling — service_role inserts surface 409 on conflict via
  // Prefer: return=minimal so we re-roll deterministically).
  let code = '';
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    code = makeCode();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
    const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/invites`;
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        code,
        inviter_user_hash: body.inviter_user_hash,
        expires_at: expiresAt,
      }),
    });
    if (resp.ok) {
      const baseUrl = env.INVITE_BASE_URL ?? 'https://ollie.app';
      return json({
        code,
        share_url: `${baseUrl.replace(/\/$/, '')}/join/${code}`,
        expires_at: expiresAt,
      });
    }
    const errText = await resp.text();
    lastErr = errText;
    // 409 → unique collision. Loop. Anything else → surface.
    if (resp.status !== 409 && !/duplicate key/i.test(errText)) {
      return json({ error: 'supabase_error', status: resp.status, detail: errText }, 502);
    }
  }
  return json({ error: 'code_collision', detail: lastErr }, 503);
}

// ─── /validate-invite ──────────────────────────────────────────────────────────

interface ValidateInviteRequest {
  code: string;
}

export async function handleValidateInvite(req: Request, env: InvitesEnv): Promise<Response> {
  let body: ValidateInviteRequest;
  try {
    body = (await req.json()) as ValidateInviteRequest;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body || typeof body.code !== 'string' || !body.code) {
    return json({ error: 'invalid_payload' }, 400);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  const code = body.code.trim().toLowerCase();
  const url =
    `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/invites` +
    `?code=eq.${encodeURIComponent(code)}` +
    `&select=code,used_at,expires_at`;
  const resp = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    },
  });
  if (!resp.ok) {
    return json({ error: 'supabase_error', status: resp.status }, 502);
  }
  const rows = (await resp.json()) as Array<{
    code: string;
    used_at: string | null;
    expires_at: string;
  }>;
  if (rows.length === 0) {
    return json({ valid: false, reason: 'not_found' });
  }
  const row = rows[0];
  if (row.used_at) {
    return json({ valid: false, reason: 'used' });
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return json({ valid: false, reason: 'expired' });
  }
  return json({ valid: true });
}

// ─── /claim-invite ─────────────────────────────────────────────────────────────

interface ClaimInviteRequest {
  code: string;
  invitee_user_hash: string;
}

export async function handleClaimInvite(req: Request, env: InvitesEnv): Promise<Response> {
  const jwt = req.headers.get('x-user-jwt');
  if (!jwt) return json({ error: 'missing_auth' }, 401);

  const userId = await verifyJwt(jwt, env);
  if (!userId) return json({ error: 'invalid_auth' }, 401);

  let body: ClaimInviteRequest;
  try {
    body = (await req.json()) as ClaimInviteRequest;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (
    !body ||
    typeof body.code !== 'string' ||
    !body.code ||
    typeof body.invitee_user_hash !== 'string' ||
    !body.invitee_user_hash
  ) {
    return json({ error: 'invalid_payload' }, 400);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  const code = body.code.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  // Atomic claim — single PATCH guarded by `used_at IS NULL AND expires_at > now()`.
  // PostgREST returns the updated row when prefer=representation; an empty
  // array means no row matched (already used / expired / not found).
  const url =
    `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/invites` +
    `?code=eq.${encodeURIComponent(code)}` +
    `&used_at=is.null` +
    `&expires_at=gt.${encodeURIComponent(nowIso)}`;
  const resp = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      prefer: 'return=representation',
    },
    body: JSON.stringify({
      used_at: nowIso,
      invitee_user_hash: body.invitee_user_hash,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    return json({ error: 'supabase_error', status: resp.status, detail: errText }, 502);
  }
  const rows = (await resp.json()) as Array<{ code: string }>;
  if (rows.length === 0) {
    // The code was either already used, expired, or didn't exist.
    // Disambiguate via a second read so the client gets an actionable reason.
    const lookup = await fetchWithTimeout(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/invites` +
        `?code=eq.${encodeURIComponent(code)}` +
        `&select=used_at,expires_at`,
      {
        method: 'GET',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        },
      },
    );
    if (lookup.ok) {
      const lookupRows = (await lookup.json()) as Array<{
        used_at: string | null;
        expires_at: string;
      }>;
      if (lookupRows.length === 0) {
        return json({ success: false, reason: 'not_found' });
      }
      if (lookupRows[0].used_at) {
        return json({ success: false, reason: 'used' });
      }
      if (new Date(lookupRows[0].expires_at).getTime() <= Date.now()) {
        return json({ success: false, reason: 'expired' });
      }
    }
    return json({ success: false, reason: 'unknown' });
  }
  return json({ success: true, code });
}

// ─── helpers ───────────────────────────────────────────────────────────────────

export async function checkInviteRate(kv: KVNamespace, userId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const slot = `rl:invite:${userId}:${Math.floor(now / RATE_WINDOW_SEC)}`;
  const raw = await kv.get(slot);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= RATE_MAX_PER_DAY) return false;
  await kv.put(slot, String(count + 1), { expirationTtl: RATE_WINDOW_SEC * 2 + 1 });
  return true;
}

export function makeCode(): string {
  return `olli-${randSegment(4)}-${randSegment(4)}`;
}

function randSegment(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Verify a user JWT and return the verified user id.
 *
 * Dual-mode (Clerk migration · Phase 3 / T0):
 *   1. If `env.CLERK_ISSUER` is set, try Clerk JWKS verify first.
 *   2. Fall back to Supabase `GET /auth/v1/user` for legacy tokens.
 *
 * Returns null on any failure. Never throws.
 */
export async function verifyJwt(
  jwt: string,
  env: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    CLERK_ISSUER?: string;
  },
): Promise<string | null> {
  if (env.CLERK_ISSUER) {
    const clerkUserId = await verifyClerkJwt(jwt, env);
    if (clerkUserId) return clerkUserId;
  }


  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`;
  try {
    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${jwt}`,
      },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { id?: string };
    return typeof data.id === 'string' && data.id ? data.id : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), SUPABASE_REST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
