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
 *     invitee_user_hash are derived server-side from that verified user id
 *     (`deriveUserHash` + `USER_HASH_SALT`) — the same identity source the
 *     telemetry pipeline uses. Any hash in the request body is IGNORED so a
 *     caller can never attribute an invite to another user (audit #85 IDOR).
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
import { deriveUserHash } from './telemetry';

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
  /** Server-side salt for deriving user_hash from the verified userId. */
  USER_HASH_SALT?: string;
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
  /**
   * IGNORED — kept only for back-compat with existing clients. The inviter
   * hash is derived server-side from the verified JWT (audit #85 IDOR fix).
   */
  inviter_user_hash?: string;
  /** Optional acquisition-channel tag — normalised server-side. */
  channel?: string;
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
  if (!body || typeof body !== 'object') {
    return json({ error: 'invalid_payload' }, 400);
  }

  // Inviter identity is derived server-side from the verified JWT — any
  // client-supplied `inviter_user_hash` is ignored (audit #85 IDOR fix).
  const inviterUserHash = await deriveUserHash(userId, env.USER_HASH_SALT);

  // Per-user 24h rate limit — keyed on JWT user id, not the hash, so a
  // user that re-hashes (e.g. email change) cannot reset their bucket.
  const allowed = await checkInviteRate(env.RATE_KV, userId);
  if (!allowed) {
    return json({ error: 'rate_limited', limit: RATE_MAX_PER_DAY, window_hours: 24 }, 429);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  // Optional acquisition-channel tag for the activation funnel. Normalised
  // here so the column stays tidy; null when absent → reads as a referral.
  const channel = normalizeChannel(body.channel);

  // Generate a fresh code. Retry up to 3 times if we hit a UNIQUE collision
  // on the `code` column (vanishingly unlikely with 30^8 keyspace, but
  // worth handling — service_role inserts surface 409 on conflict via
  // Prefer: return=minimal so we re-roll deterministically).
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeCode();
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
        inviter_user_hash: inviterUserHash,
        expires_at: expiresAt,
        ...(channel ? { channel } : {}),
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
      // SECURITY (S8): generic code to the client; PostgREST detail logged
      // server-side only behind a request id.
      return upstreamError('supabase_error', 502, errText, {
        endpoint: 'generate-invite',
        upstream_status: resp.status,
      });
    }
  }
  // All retries collided — log the last upstream body server-side only.
  return upstreamError('code_collision', 503, lastErr, { endpoint: 'generate-invite' });
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
  /**
   * IGNORED — kept only for back-compat with existing clients. The invitee
   * hash is derived server-side from the verified JWT (audit #85 IDOR fix).
   */
  invitee_user_hash?: string;
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
  if (!body || typeof body.code !== 'string' || !body.code) {
    return json({ error: 'invalid_payload' }, 400);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  // Invitee identity is derived server-side from the verified JWT — any
  // client-supplied `invitee_user_hash` is ignored (audit #85 IDOR fix).
  const inviteeUserHash = await deriveUserHash(userId, env.USER_HASH_SALT);

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
      invitee_user_hash: inviteeUserHash,
    }),
  });
  if (!resp.ok) {
    // SECURITY (S8): generic code to the client; PostgREST detail logged
    // server-side only behind a request id.
    const errText = await resp.text();
    return upstreamError('supabase_error', 502, errText, {
      endpoint: 'claim-invite',
      upstream_status: resp.status,
    });
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

/**
 * Normalise an optional channel tag: lowercase, trim, collapse whitespace
 * to hyphens, strip to [a-z0-9-], cap at 40 chars. Returns null when the
 * input is missing or empty after normalising — a null channel reads as
 * an in-app referral in the activation funnel.
 */
export function normalizeChannel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || null;
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
 *   1. If `env.CLERK_ISSUER` is set, try Clerk JWKS verify first. Clerk's
 *      issued tokens carry `iss === CLERK_ISSUER`, so this path matches
 *      every new sign-in.
 *   2. Fall back to Supabase `GET /auth/v1/user` for any token Clerk
 *      rejects. This keeps any still-live Supabase sessions working
 *      through the migration window. Once no Supabase sessions remain,
 *      this branch can be deleted.
 *
 * Returns null on any failure (signature, expired, wrong issuer, missing
 * env). Never throws. Exported so the telemetry endpoints
 * (/ingest-event, /label, /enrich-dump) gate on the same check.
 *
 * The user id returned is:
 *   - Clerk: the `sub` claim (`user_<…>`).
 *   - Supabase: the `id` field from /auth/v1/user (a uuid).
 * Callers MUST treat the value opaquely — it is a "verified user id",
 * not a Supabase uuid.
 */
export async function verifyJwt(
  jwt: string,
  env: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    CLERK_ISSUER?: string;
  },
): Promise<string | null> {
  // Clerk path — try first when configured. A successful Clerk verify is
  // local (no upstream hop after the JWKS cache warms), so it is both
  // faster and the canonical post-migration path.
  if (env.CLERK_ISSUER) {
    const clerkUserId = await verifyClerkJwt(jwt, env);
    if (clerkUserId) return clerkUserId;
    // Fall through to Supabase — a Clerk failure does not prove the token
    // is bad, it might be a legacy Supabase JWT issued before the cutover.
  }

  // Supabase fallback (legacy). Removed once the Supabase session window
  // has fully aged out.
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

// `json()` is the shared helper from @ollie/worker-http (imported above).
