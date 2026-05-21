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

export interface Env extends EnrichEnv, IngestEnv, LabelEnv, InvitesEnv {
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    if (req.method !== 'POST') {
      return withCors(json({ error: 'method_not_allowed' }, 405));
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
  },
};

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
