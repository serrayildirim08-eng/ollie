/**
 * Per-call fetch timeout for the dump-path AI upstreams (Voyage / Groq / Gemini).
 *
 * Background (audit S2 · fix 3): none of the dump-path upstream fetches had an
 * AbortSignal, so a stalled provider held the Cloudflare Worker open for the
 * full 30s invocation wall — turning one slow upstream into a 30s hang that
 * looks like a dead app. AbortSignal.timeout() bounds each call; on expiry the
 * fetch rejects and we surface a typed `UpstreamTimeoutError` so callers fall
 * back through their EXISTING upstream-error handling (cascade fall-through /
 * 502 / soft rate-limit) instead of hanging.
 */

/** Thrown when an upstream fetch exceeds its per-call timeout. Carries a 504
 *  `status` so callers that branch on HTTP status (e.g. the classify cascade's
 *  429/503 → soft "rate_limited" map) treat a timeout as a genuine upstream
 *  failure, never a recoverable rate-limit. */
export class UpstreamTimeoutError extends Error {
  readonly status = 504;
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'UpstreamTimeoutError';
  }
}

/**
 * `fetch` with a hard per-call timeout. On timeout the underlying fetch rejects
 * with an AbortError/TimeoutError DOMException; we normalize that into a typed
 * `UpstreamTimeoutError` (`.status = 504`). Any other rejection (network/DNS) is
 * re-thrown unchanged so existing error handling still sees it.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === 'TimeoutError' || err.name === 'AbortError')
    ) {
      throw new UpstreamTimeoutError(label, timeoutMs);
    }
    throw err;
  }
}

/** Per-upstream timeout budgets (ms). Each is well under the 30s Worker wall so
 *  a single stalled provider can never monopolize the whole invocation. */
export const UPSTREAM_TIMEOUT_MS = {
  /** Voyage embed — small payload, normally <500ms. */
  voyage: 10_000,
  /** Groq classify — fast (~300 tok/s) but allow headroom for a long batch. */
  groq: 10_000,
  /** Gemini JSON fallback — higher TPM but slower first-token. */
  gemini: 10_000,
  /** Gemini vision — image upload + multimodal decode is the heaviest call. */
  vision: 15_000,
} as const;
