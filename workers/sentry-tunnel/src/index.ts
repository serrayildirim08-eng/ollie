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

const SENTRY_HOST = 'o4511388392292352.ingest.us.sentry.io';
const ALLOWED_PROJECT_IDS = new Set(['4511388465889281']);

export default {
  async fetch(request: Request): Promise<Response> {
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

    let envelope: string;
    try {
      envelope = await request.text();
    } catch {
      return new Response('cannot read body', { status: 400, headers: corsHeaders() });
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

    const upstreamResponse = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
      },
      body: envelope,
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': upstreamResponse.headers.get('Content-Type') ?? 'application/json',
      },
    });
  },
};

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sentry-Auth',
    'Access-Control-Max-Age': '86400',
  };
}
