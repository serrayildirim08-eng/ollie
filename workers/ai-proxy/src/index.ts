/**
 * ollie · ai-proxy Cloudflare Worker
 *
 * Hides ANTHROPIC_API_KEY (lives only in Worker env, never the client) and
 * forwards brain-dump requests to api.anthropic.com.
 *
 * Privacy posture:
 *   ollie is opt-in re. cloud AI. The client must have user consent before
 *   sending brain-dump text here. This Worker logs nothing about content;
 *   only error counts surface upstream. Bodies are never persisted.
 *
 * Endpoints:
 *   POST /brain-dump       — proxy to https://api.anthropic.com/v1/messages
 *   POST /v1/messages      — legacy alias (existing packages/api/anthropic.ts
 *                            still uses /v1/messages so we accept it too).
 *   POST /enrich-dump      — receive brain-dump, PII-scrub, queue in KV for
 *                            batch enrichment by the cron worker. NO upstream
 *                            Anthropic call here; UX gets zero added latency.
 *                            AUTHED: requires a valid Supabase user JWT.
 *   POST /ingest-event     — receive retention/session/module/crisis/consent
 *                            rows and INSERT directly into Supabase via REST.
 *                            AUTHED: requires a valid Supabase user JWT.
 *   POST /label            — Anthropic-backed research labeling.
 *                            AUTHED: requires a valid Supabase user JWT.
 *
 * Auth:
 *   /enrich-dump, /ingest-event and /label use the service-role key, so
 *   they require an `Authorization: Bearer <supabase-user-jwt>` header.
 *   The JWT is verified against Supabase Auth (GET /auth/v1/user) — a
 *   self-decoded claim is never trusted. They also share the per-user
 *   rate limit (keyed on the verified user id).
 *
 * Features:
 *   - 5-minute KV cache keyed by sha256(canonicalised body).
 *   - 10 req/min rate limit per user (proxy: header `x-user-id` or
 *     X-Forwarded-For; telemetry: verified Supabase user id).
 *   - anthropic-beta: prompt-caching-2024-07-31 is forwarded.
 */

import { json } from '@ollie/worker-http';
import { scrubPII } from './pii';
import {
  handleEnrichDump,
  handleIngestEvent,
  type EnrichEnv,
  type IngestEnv,
} from './telemetry';
import { handleLabel, type LabelEnv } from './label';
import {
  handleGenerateInvite,
  handleValidateInvite,
  handleClaimInvite,
  verifyJwt,
  type InvitesEnv,
} from './invites';
import { handleRoute, type RouteEnv } from './router/route';
import { handlePurchase, type PurchaseEnv } from './router/purchase';
import { handleCookHistory, type CookHistoryEnv } from './router/cook-history';
import { handleReplenishment, type ReplenishmentEnv } from './router/replenishment';
import { handleFeedMe, type FeedMeEnv } from './router/feed-me';
import { verifyClerkJwt } from './clerk-verify';

/**
 * Cloudflare native Rate Limiting binding. `limit()` is atomic edge-side,
 * which fixes the read-then-write race the KV counter had.
 */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env
  extends EnrichEnv,
    IngestEnv,
    LabelEnv,
    InvitesEnv,
    RouteEnv,
    PurchaseEnv,
    ReplenishmentEnv,
    FeedMeEnv,
    CookHistoryEnv {
  ANTHROPIC_API_KEY: string;
  CACHE_KV: KVNamespace;
  RATE_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  SUPABASE_ANON_KEY: string;
  INVITE_BASE_URL?: string;
  // Native rate-limit bindings (item #5). Optional so a deploy that hasn't
  // picked up the wrangler.toml [[ratelimits]] blocks still type-checks and
  // falls back to the legacy KV counter.
  AI_RATE_LIMITER?: RateLimiter;
  TELEM_RATE_LIMITER?: RateLimiter;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CACHE_TTL_SEC = 300;          // 5 min
const RATE_MAX = 10;                // req/min — default
const PURCHASE_RATE_MAX = 100;      // req/min — purchase ingestion can burst at checkout
const RATE_WINDOW_SEC = 60;

// ─── handler ───────────────────────────────────────────────────────────────────

/**
 * CORS — every endpoint here is called from the browser (Electron dev,
 * Capacitor iOS, web app). POST + application/json + Authorization Bearer
 * all trigger a preflight, so we MUST answer OPTIONS with the right
 * headers AND echo them on every real response. Pattern mirrors
 * workers/sentry-tunnel.
 */
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
    'Access-Control-Max-Age': '86400',
  };
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight — every endpoint requires Authorization or x-user-id,
    // so browser will always preflight. Answer 204 + headers, no body.
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ── /grocery/purchase — adaptive replenishment event ingestion (T2.5) ───
    // POST only. Per-user rate-limited (100/min budget for checkout bursts).
    if (url.pathname === '/grocery/purchase' && req.method === 'POST') {
      const purchaseUserId = await resolveUserIdForRateLimit(req, env);
      if (purchaseUserId) {
        const allowed = await checkRate(
          env.TELEM_RATE_LIMITER,
          env.RATE_KV,
          `rl:purchase:${purchaseUserId}`,
          PURCHASE_RATE_MAX,
        );
        if (!allowed) {
          return withCors(json({ error: 'rate_limited' }, 429));
        }
      }
      return withCors(await handlePurchase(req, env));
    }

    // ── /cook-history — Feed Me v2 cook event ingestion (rating + dish) ─────
    // POST only. Shares the purchase rate-limit shape (cooks are not a burst).
    if (url.pathname === '/cook-history' && req.method === 'POST') {
      const cookUserId = await resolveUserIdForRateLimit(req, env);
      if (cookUserId) {
        const allowed = await checkRate(
          env.TELEM_RATE_LIMITER,
          env.RATE_KV,
          `rl:cookhistory:${cookUserId}`,
          PURCHASE_RATE_MAX,
        );
        if (!allowed) {
          return withCors(json({ error: 'rate_limited' }, 429));
        }
      }
      return withCors(await handleCookHistory(req, env));
    }

    // ── /feed-me/:user — AI recipe suggestion (user mode + pet mode) ────────
    // POST only (pantry lives in the body). Auth + ownership enforced inside
    // the handler; rate-limited per-user via the telemetry bucket so a single
    // account cannot burn Voyage + Gemini budget by spamming the endpoint.
    const feedMeMatch = url.pathname.match(/^\/feed-me\/([0-9a-f-]+)$/i);
    if (feedMeMatch && req.method === 'POST') {
      const fmUser = await resolveUserIdForRateLimit(req, env);
      if (fmUser) {
        const allowed = await checkRate(
          env.TELEM_RATE_LIMITER,
          env.RATE_KV,
          `rl:feedme:${fmUser}`,
        );
        if (!allowed) {
          return withCors(json({ error: 'rate_limited' }, 429));
        }
      }
      return withCors(await handleFeedMe(req, env, feedMeMatch[1]));
    }

    // ── /replenishment/:user — adaptive cadence estimates (T2.5) ─────────────
    // GET only. The path UUID becomes the user_id we look up; auth enforces
    // ownership (JWT sub === path param). Read-only, no rate limit needed
    // beyond Cloudflare's edge defaults — frontend re-fetches at most once
    // per purchase + on grocery module mount.
    const replenishMatch = url.pathname.match(
      /^\/replenishment\/([0-9a-f-]+)$/i,
    );
    if (replenishMatch && req.method === 'GET') {
      return withCors(await handleReplenishment(req, env, replenishMatch[1]));
    }

    if (req.method !== 'POST') {
      return withCors(json({ error: 'method_not_allowed' }, 405));
    }

    // Telemetry endpoints — separate code path. They use the service-role
    // key, so they MUST be authenticated: every caller has to present a
    // valid Supabase user JWT (`Authorization: Bearer <token>`), verified
    // against Supabase Auth. They also share the per-user rate limit so a
    // single account cannot poison telemetry tables or burn the Anthropic
    // budget on /label.
    if (
      url.pathname === '/enrich-dump' ||
      url.pathname === '/ingest-event' ||
      url.pathname === '/label'
    ) {
      const authHeader = req.headers.get('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'unauthorized' }, 401);
      }
      const userId = await verifyJwt(authHeader.slice('Bearer '.length), env);
      if (!userId) {
        return json({ error: 'invalid_jwt' }, 401);
      }
      const allowed = await checkRate(
        env.TELEM_RATE_LIMITER,
        env.RATE_KV,
        `rl:telemetry:${userId}`,
      );
      if (!allowed) {
        return json({ error: 'rate_limited' }, 429);
      }
      if (url.pathname === '/enrich-dump') {
        return handleEnrichDump(req, env);
      }
      if (url.pathname === '/ingest-event') {
        return handleIngestEvent(req, env);
      }
      return handleLabel(req, env);
    }
    if (url.pathname === '/generate-invite') {
      return handleGenerateInvite(req, env);
    }
    if (url.pathname === '/validate-invite') {
      return handleValidateInvite(req, env);
    }
    if (url.pathname === '/claim-invite') {
      return handleClaimInvite(req, env);
    }

    // ── /route/:module — module-agnostic AI semantic routing (T2) ────────────
    // e.g. POST /route/grocery
    // Auth: JWT enforcement gated by T0_JWT_ENFORCED env var (T0 dependency).
    const routeMatch = url.pathname.match(/^\/route\/([a-z_-]+)$/);
    if (routeMatch) {
      const module = routeMatch[1];
      return withCors(await handleRoute(req, env, module));
    }

    if (url.pathname !== '/brain-dump' && url.pathname !== '/v1/messages') {
      return json({ error: 'not_found' }, 404);
    }

    // Per-user rate-limit. Prefer authenticated user id from caller; fall
    // back to client IP. Bots that omit both will share a single bucket.
    const userKey =
      req.headers.get('x-user-id') ||
      req.headers.get('cf-connecting-ip') ||
      'anon';

    const allowed = await checkRate(env.AI_RATE_LIMITER, env.RATE_KV, `rl:ai:${userKey}`);
    if (!allowed) {
      return json({ error: 'rate_limited' }, 429);
    }

    // Read body once for hashing + forwarding.
    const bodyText = await req.text();
    if (!bodyText) return json({ error: 'empty_body' }, 400);

    const cacheKey = `cache:ai:${await sha256Hex(bodyText)}`;
    const cached = await env.CACHE_KV.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-ollie-cache': 'hit',
        },
      });
    }

    // Pull through the caller's anthropic-beta header if present so prompt
    // caching keeps working end-to-end.
    const fwdHeaders: HeadersInit = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };
    const beta = req.headers.get('anthropic-beta');
    if (beta) (fwdHeaders as Record<string, string>)['anthropic-beta'] = beta;

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: fwdHeaders,
      body: bodyText,
    });

    const respText = await upstream.text();

    // Only cache successful responses; never cache 4xx/5xx.
    if (upstream.ok) {
      await env.CACHE_KV.put(cacheKey, respText, { expirationTtl: CACHE_TTL_SEC });
    }

    return new Response(respText, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'x-ollie-cache': 'miss',
      },
    });
  },
};

// ─── helpers ───────────────────────────────────────────────────────────────────

/**
 * Rate-limit check. Prefers the native Cloudflare Rate Limiting binding
 * (atomic at the edge — fixes the read-then-write race the KV counter had).
 * Falls back to the legacy KV fixed-window counter when the binding is not
 * present, so a deploy that has not yet picked up the [[ratelimits]] config
 * still enforces a limit.
 */
async function checkRate(
  limiter: RateLimiter | undefined,
  kv: KVNamespace,
  key: string,
  maxOverride?: number,
): Promise<boolean> {
  if (limiter) {
    // NB: the native binding's limit is configured per-binding in
    // wrangler.toml. `maxOverride` only affects the KV fallback branch
    // below — when the binding is live the configured limit wins, which
    // for the purchase endpoint means we share the telemetry bucket (10/min)
    // until/unless a dedicated PURCHASE_RATE_LIMITER ships. Acceptable for
    // ingestion — bursts come from a single user, not many.
    const { success } = await limiter.limit({ key });
    return success;
  }
  // Legacy fallback — racy fixed-window KV counter.
  const max = maxOverride ?? RATE_MAX;
  const now = Math.floor(Date.now() / 1000);
  const slot = `${key}:${Math.floor(now / RATE_WINDOW_SEC)}`;
  const raw = await kv.get(slot);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= max) return false;
  await kv.put(slot, String(count + 1), { expirationTtl: RATE_WINDOW_SEC * 2 + 1 });
  return true;
}

/**
 * Determine the rate-limit key for /grocery/purchase. Prefers the Clerk
 * `sub` from a verified JWT (when T0_JWT_ENFORCED), then x-user-id, then
 * the connecting IP. Returns null if even IP is missing — the caller
 * skips rate-limit rather than collapsing every anon caller into one
 * shared bucket that would DoS itself.
 */
async function resolveUserIdForRateLimit(
  req: Request,
  env: Env,
): Promise<string | null> {
  if (env.T0_JWT_ENFORCED === '1') {
    const auth = req.headers.get('authorization');
    if (auth && auth.startsWith('Bearer ')) {
      const sub = await verifyClerkJwt(auth.slice('Bearer '.length), env);
      if (sub) return sub;
    }
  }
  return (
    req.headers.get('x-user-id') ||
    req.headers.get('cf-connecting-ip') ||
    null
  );
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// `json()` is the shared helper from @ollie/worker-http (imported above).

// Re-export so tests can import the pure scrubber.
export { scrubPII };
