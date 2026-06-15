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
 *   POST /route/dump       — brain-dump universal router (Decision-locked v2).
 *                            Clerk-JWT-authed; Vectorize-cached, Groq Llama
 *                            3.3 70B for segmentation + classification.
 *   POST /route/:module    — module-agnostic AI semantic routing (T2).
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
import { handleDumpRoute, type DumpRouteEnv } from './router/dump';
import { handleBrainCopy } from './router/brain-copy';
import { handleApplyInbox, handleSyncGroceryPantry } from './router/server-apply-routes';
import { handlePurchase, type PurchaseEnv } from './router/purchase';
import { handleCookHistory, type CookHistoryEnv } from './router/cook-history';
import { handleReplenishment, type ReplenishmentEnv } from './router/replenishment';
import { handleFeedMe, type FeedMeEnv } from './router/feed-me';
import { handleTranscribe, type TranscribeEnv } from './router/transcribe';
import { handlePartner, type PartnerEnv } from './router/partner';
import {
  handleShelfLifeAll,
  handleShelfLifeLookup,
  type ShelfLifeEnv,
} from './router/shelf-life';
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
    DumpRouteEnv,
    PurchaseEnv,
    ReplenishmentEnv,
    FeedMeEnv,
    ShelfLifeEnv,
    CookHistoryEnv,
    TranscribeEnv,
    PartnerEnv {
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
  // A6b server-apply pilot.
  ENVELOPE_KEK?: string;
  SERVER_APPLY_ENABLED?: string;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CACHE_TTL_SEC = 300;          // 5 min
const RATE_MAX = 10;                // req/min — default
/** Max request body for the /brain-dump + /v1/messages proxy (audit #46).
 *  1 MiB is well above any real prompt (incl. cached context) but blocks an
 *  oversized payload from being read into memory + forwarded upstream. */
const MAX_PROXY_BODY_BYTES = 1024 * 1024;
const PURCHASE_RATE_MAX = 100;      // req/min — purchase ingestion can burst at checkout
const RATE_WINDOW_SEC = 60;

// ─── CORS helpers ──────────────────────────────────────────────────────────────
//
// Every endpoint here is called from the browser (Electron dev, Capacitor
// iOS, web app). POST + application/json + Authorization Bearer all trigger
// a preflight, so we MUST answer OPTIONS with the right headers AND echo
// them on every real response. Pattern mirrors workers/sentry-tunnel.

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, anthropic-beta',
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

// ─── handler ───────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // ── /transcribe — brain-dump mic → text (Groq Whisper) ─────────────────
    // POST only; raw audio bytes in the body. Per-user rate-limited (a clip is
    // not a burst) so one account can't drain the Whisper budget.
    if (url.pathname === '/transcribe' && req.method === 'POST') {
      const txUser = await resolveUserIdForRateLimit(req, env);
      if (txUser) {
        const allowed = await checkRate(
          env.TELEM_RATE_LIMITER,
          env.RATE_KV,
          `rl:transcribe:${txUser}`,
          PURCHASE_RATE_MAX,
        );
        if (!allowed) {
          return withCors(json({ error: 'rate_limited' }, 429));
        }
      }
      return withCors(await handleTranscribe(req, env));
    }

    // ── /partner/* — bilateral "intimate window" sync ──────────────────────
    const partnerMatch = url.pathname.match(/^\/partner\/([a-z]+)$/i);
    if (partnerMatch) {
      const pUser = await resolveUserIdForRateLimit(req, env);
      if (pUser) {
        const allowed = await checkRate(
          env.TELEM_RATE_LIMITER,
          env.RATE_KV,
          `rl:partner:${pUser}`,
          PURCHASE_RATE_MAX,
        );
        if (!allowed) {
          return withCors(json({ error: 'rate_limited' }, 429));
        }
      }
      return withCors(await handlePartner(req, env, partnerMatch[1]));
    }

    // ── /feed-me/:user — AI recipe suggestion (user mode + pet mode) ────────
    // POST only (pantry lives in the body). Auth + ownership enforced inside
    // the handler; rate-limited per-user via the telemetry bucket so a single
    // account cannot burn Voyage + Groq budget by spamming the endpoint.
    const feedMeMatch = url.pathname.match(/^\/feed-me\/([A-Za-z0-9_-]+)$/i);
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
      /^\/replenishment\/([A-Za-z0-9_-]+)$/i,
    );
    if (replenishMatch && req.method === 'GET') {
      return withCors(await handleReplenishment(req, env, replenishMatch[1]));
    }

    // ── /shelf-life/all — full canonical table + alias map (public, 24h cache) ─
    // GET only. No auth — public reference data, no PII. 24h Cache-Control
    // + strong ETag mean re-hits are 304s; still apply a soft per-caller
    // rate-limit so a malicious actor cannot loop on cache-busting headers.
    if (url.pathname === '/shelf-life/all' && req.method === 'GET') {
      const slUser = await resolveUserIdForRateLimit(req, env);
      if (slUser) {
        const allowed = await checkRate(
          env.TELEM_RATE_LIMITER,
          env.RATE_KV,
          `rl:shelflife-all:${slUser}`,
          PURCHASE_RATE_MAX, // generous — full table re-fetch is rare
        );
        if (!allowed) {
          return withCors(json({ error: 'rate_limited' }, 429));
        }
      }
      return withCors(await handleShelfLifeAll(req, env));
    }

    // ── /shelf-life/lookup/:item — single-item resolution (public, 24h cache) ──
    // GET only. No auth. Rate-limited per caller because 720 items × N callers
    // could burn CPU without the cache helping (different keys = different
    // responses). Item segment is the rest of the path so encoded spaces,
    // hyphens, and TR/ES diacritics all pass through.
    const shelfLookupMatch = url.pathname.match(/^\/shelf-life\/lookup\/(.+)$/);
    if (shelfLookupMatch && req.method === 'GET') {
      const slUser = await resolveUserIdForRateLimit(req, env);
      if (slUser) {
        const allowed = await checkRate(
          env.TELEM_RATE_LIMITER,
          env.RATE_KV,
          `rl:shelflife-lookup:${slUser}`,
        );
        if (!allowed) {
          return withCors(json({ error: 'rate_limited' }, 429));
        }
      }
      return withCors(await handleShelfLifeLookup(req, env, shelfLookupMatch[1]));
    }

    // ── /shelf-life/lookup/ (empty item) — explicit 404 instead of falling
    //    through to method-not-allowed. Caller sent a malformed URL.
    if (url.pathname === '/shelf-life/lookup' || url.pathname === '/shelf-life/lookup/') {
      return withCors(json({ error: 'not_found' }, 404));
    }

    // ── A6b server-apply pilot — MUST be above the POST-only guard below,
    //    because /sync/grocery-pantry is a GET. ─────────────────────────────
    if (url.pathname === '/apply-inbox') {
      return withCors(await handleApplyInbox(req, env));
    }
    if (url.pathname === '/sync/grocery-pantry') {
      return withCors(await handleSyncGroceryPantry(req, env));
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
        return withCors(json({ error: 'unauthorized' }, 401));
      }
      const userId = await verifyJwt(authHeader.slice('Bearer '.length), env);
      if (!userId) {
        return withCors(json({ error: 'invalid_jwt' }, 401));
      }
      const allowed = await checkRate(
        env.TELEM_RATE_LIMITER,
        env.RATE_KV,
        `rl:telemetry:${userId}`,
      );
      if (!allowed) {
        return withCors(json({ error: 'rate_limited' }, 429));
      }
      if (url.pathname === '/enrich-dump') {
        return withCors(await handleEnrichDump(req, env, userId));
      }
      if (url.pathname === '/ingest-event') {
        return withCors(await handleIngestEvent(req, env, userId));
      }
      return withCors(await handleLabel(req, env));
    }
    if (url.pathname === '/generate-invite') {
      return withCors(await handleGenerateInvite(req, env));
    }
    if (url.pathname === '/validate-invite') {
      return withCors(await handleValidateInvite(req, env));
    }
    if (url.pathname === '/claim-invite') {
      return withCors(await handleClaimInvite(req, env));
    }

    // ── /brain-copy — Sprint 3 noticing sentence generation (A1) ─────────────
    // Client caches per noticing/day/lang and falls back to a trilingual
    // static sentence on any non-ok, so this route is never load-bearing.
    // Auth: Clerk JWT required (same policy as /route/dump).
    if (url.pathname === '/brain-copy' && req.method === 'POST') {
      return withCors(await handleBrainCopy(req, env));
    }

    // ── /route/dump — brain-dump universal router (Decision-locked v2) ───────
    // Pipeline: pass-1 + pass-2 segmentation, per-fragment Voyage embed,
    // Vectorize cache lookup, Groq Llama 3.3 70B classify (JSON mode),
    // parallel crisis check (all 3 lexicons), 3-tier confidence policy.
    // Auth: Clerk JWT REQUIRED (not gated). User namespaces the cache.
    if (url.pathname === '/route/dump') {
      return withCors(await handleDumpRoute(req, env, ctx));
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
      return withCors(json({ error: 'not_found' }, 404));
    }

    // Per-user rate-limit. Prefer authenticated user id from caller; fall
    // back to client IP. Bots that omit both will share a single bucket.
    const userKey =
      req.headers.get('x-user-id') ||
      req.headers.get('cf-connecting-ip') ||
      'anon';

    const allowed = await checkRate(env.AI_RATE_LIMITER, env.RATE_KV, `rl:ai:${userKey}`);
    if (!allowed) {
      return withCors(json({ error: 'rate_limited' }, 429));
    }

    // Body size guard (audit #46). Cheap Content-Length pre-check, then a hard
    // cap on the actual bytes read (Content-Length can lie / be absent).
    const declaredLen = Number(req.headers.get('content-length') ?? '0');
    if (declaredLen > MAX_PROXY_BODY_BYTES) {
      return withCors(json({ error: 'body_too_large' }, 413));
    }

    // Read body once for hashing + forwarding.
    const bodyText = await req.text();
    if (!bodyText) return withCors(json({ error: 'empty_body' }, 400));
    if (bodyText.length > MAX_PROXY_BODY_BYTES) {
      return withCors(json({ error: 'body_too_large' }, 413));
    }

    const cacheKey = `cache:ai:${await sha256Hex(bodyText)}`;
    const cached = await env.CACHE_KV.get(cacheKey);
    if (cached) {
      return withCors(new Response(cached, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-ollie-cache': 'hit',
        },
      }));
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

    return withCors(new Response(respText, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'x-ollie-cache': 'miss',
      },
    }));
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
  if (env.T0_JWT_ENFORCED !== '0') {
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
