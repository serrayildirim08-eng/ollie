/**
 * @ollie/worker-http — shared HTTP helpers for the Cloudflare Workers.
 *
 * Background: six workers each hand-rolled URL routing and shipped a
 * copy-pasted `json()` Response helper. This module centralises that
 * helper and re-exports `itty-router` so any worker that wants a tiny
 * declarative router has one consistent dependency.
 *
 * The helpers are behaviour-identical to the copies they replace — a
 * `Response` carrying a JSON body and `content-type: application/json`.
 */

export { Router, type IRequest, type RouterType } from 'itty-router';

/**
 * Build a JSON `Response`. Drop-in for the per-worker `json()` helpers.
 * Extra headers (e.g. `x-ollie-cache`) can be merged in.
 */
export function json(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * SECURITY (S8): build an error `Response` for a failed UPSTREAM call
 * (PostgREST / Supabase / Anthropic) WITHOUT leaking the upstream body
 * to the caller.
 *
 * PostgREST error bodies disclose table, column, and constraint names —
 * an information-disclosure vector. This helper:
 *   - mints a short `request_id`;
 *   - logs the full upstream detail SERVER-SIDE only (`console.error`),
 *     tagged with that `request_id`;
 *   - returns a GENERIC body to the caller: `{ error, request_id }` —
 *     no `detail`, no upstream text. Support can correlate a user's
 *     `request_id` to the server log without exposing schema internals.
 *
 * @param code        stable generic error code the client branches on
 * @param status      HTTP status for the Response (default 502)
 * @param detail      full upstream text — logged, never returned
 * @param logContext  optional extra fields for the server-side log line
 */
export function upstreamError(
  code: string,
  status = 502,
  detail?: unknown,
  logContext?: Record<string, unknown>,
): Response {
  const requestId = newRequestId();
  // Server-side only — this line stays in Cloudflare's worker logs.
  console.error(
    `[upstream-error] code=${code} request_id=${requestId}`,
    logContext ? { ...logContext } : '',
    detail === undefined ? '' : `detail=${stringifyDetail(detail)}`,
  );
  return json({ error: code, request_id: requestId }, status);
}

/** Short, collision-resistant request id for log correlation. */
export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Coerce an upstream detail of unknown shape to a bounded string for logs. */
function stringifyDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail.slice(0, 2000);
  try {
    return JSON.stringify(detail).slice(0, 2000);
  } catch {
    return String(detail).slice(0, 2000);
  }
}

/**
 * SECURITY (audit #38): cheap memory-DoS guard. Returns `true` when the
 * request's declared `Content-Length` exceeds `maxBytes`, so a handler can
 * reject an oversized payload with a 413 BEFORE calling `req.json()` /
 * `req.text()` (which would otherwise buffer the whole body into worker
 * memory).
 *
 * A client can omit or understate Content-Length, so this is a fast first
 * line of defense only — handlers must still cap the parsed field length
 * (e.g. `body.text.length`) after parsing. Returns `false` when the header
 * is absent or unparseable (caller then relies on the post-parse cap).
 */
export function exceedsContentLength(req: Request, maxBytes: number): boolean {
  const declared = Number(req.headers.get('content-length'));
  return Number.isFinite(declared) && declared > maxBytes;
}

/** 413 JSON Response — `{ "error": "payload_too_large" }`. */
export function payloadTooLarge(code = 'payload_too_large'): Response {
  return json({ error: code }, 413);
}

/** 404 JSON Response — `{ "error": "not_found" }`. */
export function notFound(): Response {
  return json({ error: 'not_found' }, 404);
}

/** 405 JSON Response — `{ "error": "method_not_allowed" }`. */
export function methodNotAllowed(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}
