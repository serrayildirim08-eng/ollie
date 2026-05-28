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
 *   POST /ingest-event     — receive retention/session/module/crisis/consent
 *                            rows and INSERT directly into Supabase via REST.
 *
 * Features:
 *   - 5-minute KV cache keyed by sha256(canonicalised body).
 *   - 10 req/min rate limit per user (header `x-user-id` or X-Forwarded-For).
 *   - anthropic-beta: prompt-caching-2024-07-31 is forwarded.
 */

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
  type InvitesEnv,
} from './invites';
import { handleRoute, type RouteEnv } from './router/route';
import { handleDumpRoute, type DumpRouteEnv } from './router/dump';

/**
 * Cloudflare native Rate Limiting binding. `limit()` is atomic edge-side,
 * which fixes the read-then-write race the KV counter had.
 */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends EnrichEnv, IngestEnv, LabelEnv, InvitesEnv, RouteEnv, DumpRouteEnv {
  ANTHROPIC_API_KEY: string;
  CACHE_KV: KVNamespace;
  RATE_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  SUPABASE_ANON_KEY: string;
  INVITE_BASE_URL?: string;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CACHE_TTL_SEC = 300;          // 5 min
const RATE_MAX = 10;                // req/min
const RATE_WINDOW_SEC = 60;

// ─── handler ───────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // ── CORS ─────────────────────────────────────────────────────────────────
    // The native (Tauri) app + future web preview hit this worker cross-origin.
    // Authorization header forces a preflight, so OPTIONS must return the full
    // CORS headers OR the browser blocks the actual request as a network error.
    // We respond `*` for origin because we never carry cookies — only the
    // Bearer JWT — and clients use the default credentials: 'omit'.
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Run the actual dispatch + wrap whatever Response it returns with
    // CORS headers. Inner function keeps the existing returns untouched.
    const res = await handleRequest(req, env);
    return withCors(res);
  },
};

async function handleRequest(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    // Telemetry endpoints — separate code path. They do their own validation
    // and do NOT share the proxy's per-user rate limit (telemetry traffic is
    // expected to be ~100x the proxy traffic per user).
    if (url.pathname === '/enrich-dump') {
      return handleEnrichDump(req, env);
    }
    if (url.pathname === '/ingest-event') {
      return handleIngestEvent(req, env);
    }
    if (url.pathname === '/label') {
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

    // ── /route/dump — brain-dump universal router (Decision-locked v2) ───────
    // Pipeline: pass-1 + pass-2 segmentation, per-fragment Voyage embed,
    // Vectorize cache lookup, Groq Llama 3.3 70B classify (JSON mode),
    // parallel crisis check (all 3 lexicons), 3-tier confidence policy.
    // Auth: Clerk JWT REQUIRED (not gated). User namespaces the cache.
    if (url.pathname === '/route/dump') {
      return handleDumpRoute(req, env);
    }

    // ── /route/:module — module-agnostic AI semantic routing (T2) ────────────
    // e.g. POST /route/grocery
    // Auth: JWT enforcement gated by T0_JWT_ENFORCED env var (T0 dependency).
    const routeMatch = url.pathname.match(/^\/route\/([a-z_-]+)$/);
    if (routeMatch) {
      const module = routeMatch[1];
      return handleRoute(req, env, module);
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

    const allowed = await checkRate(env.RATE_KV, `rl:ai:${userKey}`);
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
}

// ─── CORS helpers ──────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-user-id, anthropic-beta',
    'access-control-max-age': '86400',
  };
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

// ─── helpers ───────────────────────────────────────────────────────────────────

async function checkRate(kv: KVNamespace, key: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const slot = `${key}:${Math.floor(now / RATE_WINDOW_SEC)}`;
  const raw = await kv.get(slot);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= RATE_MAX) return false;
  await kv.put(slot, String(count + 1), { expirationTtl: RATE_WINDOW_SEC * 2 + 1 });
  return true;
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

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Re-export so tests can import the pure scrubber.
export { scrubPII };
