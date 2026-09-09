// Sentry tunnel — forwards SDK envelope payloads to Sentry's ingest
// endpoint from Cloudflare's edge. Two reasons we need this:
//
// 1. Turkish ISP DPI blocks TLS to *.sentry.io. The worker.dev domain
//    is unblocked, and the worker itself runs from Cloudflare edge
//    which has unfiltered routing to Sentry.
// 2. It hides Sentry hostnames from network observers / corp proxies
//    that filter on hostname, so beta users behind restrictive
//    networks still get error reporting.
//
// The Sentry SDK sends one POST per envelope, body is line-delimited
// JSON whose first line declares the DSN. We parse that DSN, allow-
// list it against the project we own, and proxy the raw body to the
// matching ingest endpoint. No body rewriting — Sentry's signature
// + checksum stays intact.
//
// Privacy note: client-side beforeSend (event.extra.encrypted strip)
// runs BEFORE the SDK builds the envelope, so this tunnel never sees
// the stripped fields. The tunnel only forwards — no logging of body
// contents.
//
// SECURITY (audit #56): the tunnel is publicly reachable (CORS *, no
// auth — by design, since the SDK can't carry our Clerk JWT). To stop
// it being abused as an open relay / amplifier we enforce:
//   - a hard body-size cap (413) before reading the full body,
//   - a per-IP fixed-window rate limit (429),
//   - DSN host + project-id allow-list (only our own project),
// and (audit #165) the upstream fetch is wrapped in try/catch with a
// ~10s AbortController so a slow/dead Sentry can't hang the worker or
// surface an uncaught 500.

const SENTRY_HOST = 'o4511388392292352.ingest.us.sentry.io';
const ALLOWED_PROJECT_IDS = new Set(['4511388465889281']);

/** Hard cap on the envelope body. Sentry's own per-event limit is ~1MB
 *  compressed / a few MB uncompressed; 2MB is generous for a real error
 *  envelope (incl. attachments) while bounding worker memory and blocking
 *  an attacker from streaming arbitrary volume through the relay. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Per-IP rate limit: requests allowed per fixed window. A busy beta client
 *  bursts a handful of envelopes; 60/min/IP is far above that yet caps relay
 *  abuse from any single source. */
const RATE_MAX = 60;
const RATE_WINDOW_MS = 60_000;

/** Timeout for the upstream Sentry ingest call (audit #165). */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Optional native Cloudflare Rate Limiting binding (atomic edge-side). When
 *  absent we fall back to the in-memory per-isolate limiter below. */
interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
interface Env {
  TUNNEL_RATE_LIMITER?: RateLimiter;
}

// In-memory per-isolate fixed-window counter — best-effort fallback when no
// native binding is configured. Not shared across isolates, but still bounds
// the per-isolate blast radius of an open-relay abuser without new infra.
const ipWindows = new Map<string, { count: number; resetAt: number }>();

function localRateOk(ip: string, now: number): boolean {
  const w = ipWindows.get(ip);
  if (!w || now >= w.resetAt) {
    ipWindows.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Opportunistic cleanup so the map can't grow unbounded across windows.
    if (ipWindows.size > 10_000) {
      for (const [k, v] of ipWindows) if (now >= v.resetAt) ipWindows.delete(k);
    }
    return true;
  }
  if (w.count >= RATE_MAX) return false;
  w.count += 1;
  return true;
}

async function rateOk(env: Env, ip: string): Promise<boolean> {
  if (env?.TUNNEL_RATE_LIMITER) {
    try {
      const { success } = await env.TUNNEL_RATE_LIMITER.limit({ key: ip });
      return success;
    } catch {
      // Binding misbehaved — fall back to the in-memory limiter rather than
      // fail-open with no limit at all.
    }
  }
  return localRateOk(ip, Date.now());
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (request.method !== 'POST') {
      return new Response('method not allowed', {
        status: 405,
        headers: corsHeaders(),
      });
    }

    // Per-IP rate limit (audit #56). CF-Connecting-IP is set by the edge and
    // not spoofable by the client; fall back to a constant bucket if absent.
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await rateOk(env, ip))) {
      return new Response('rate limited', { status: 429, headers: corsHeaders() });
    }

    // Body-size cap (audit #56). Reject on the declared Content-Length BEFORE
    // reading the body so an oversized payload never lands in worker memory.
    const declaredLen = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
      return new Response('payload too large', { status: 413, headers: corsHeaders() });
    }

    let envelope: string;
    try {
      envelope = await request.text();
    } catch {
      return new Response('cannot read body', { status: 400, headers: corsHeaders() });
    }

    // Defense in depth: clients can omit/lie about Content-Length, so re-check
    // the actual byte length after reading.
    if (byteLength(envelope) > MAX_BODY_BYTES) {
      return new Response('payload too large', { status: 413, headers: corsHeaders() });
    }

    const firstNewline = envelope.indexOf('\n');
    if (firstNewline === -1) {
      return new Response('malformed envelope', { status: 400, headers: corsHeaders() });
    }

    let header: { dsn?: string };
    try {
      header = JSON.parse(envelope.slice(0, firstNewline));
    } catch {
      return new Response('bad envelope header', { status: 400, headers: corsHeaders() });
    }

    if (!header.dsn) {
      return new Response('missing dsn', { status: 400, headers: corsHeaders() });
    }

    let dsnUrl: URL;
    try {
      dsnUrl = new URL(header.dsn);
    } catch {
      return new Response('invalid dsn', { status: 400, headers: corsHeaders() });
    }

    if (dsnUrl.hostname !== SENTRY_HOST) {
      return new Response('unknown sentry host', { status: 403, headers: corsHeaders() });
    }

    const projectId = dsnUrl.pathname.replace(/^\//, '');
    if (!ALLOWED_PROJECT_IDS.has(projectId)) {
      return new Response('unknown project', { status: 403, headers: corsHeaders() });
    }

    const upstream = `https://${SENTRY_HOST}/api/${projectId}/envelope/`;

    // Upstream fetch with timeout + error handling (audit #165). Without this,
    // a slow or down Sentry could hang the worker or surface an uncaught 500.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstream, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
        },
        body: envelope,
        signal: ac.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return new Response(aborted ? 'upstream timeout' : 'upstream unavailable', {
        status: 502,
        headers: corsHeaders(),
      });
    } finally {
      clearTimeout(timer);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': upstreamResponse.headers.get('Content-Type') ?? 'application/json',
      },
    });
  },
};

/** Byte length of a UTF-8 string (TextEncoder is available in Workers). */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sentry-Auth',
    'Access-Control-Max-Age': '86400',
  };
}
