/**
 * apps/web · aiRoute — cloud hybrid router client
 *
 * Calls the ai-proxy worker's `/route` endpoint (Voyage + Gemini hybrid).
 * Consent-gated: the dump text leaves the device, so this requires the
 * user's research consent. Returns null when:
 *   - no consent
 *   - VITE_AI_WORKER_URL is not set (dev / unconfigured)
 *   - the fetch fails or the response is malformed
 *
 * Never throws — failures always degrade to the on-device or keyword tier.
 */

import { getAccount, getAuthJwt } from './account-boot';

interface ViteEnv {
  VITE_AI_WORKER_URL?: string;
}

const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

// ─── public types ──────────────────────────────────────────────────────────

/** A single tool call returned by the hybrid router. */
export interface RouterCall {
  /** Tool name (matches TOOL_MODULE in routerCallToActions.ts). */
  tool: string;
  /** Tool input — the router extracts structured fields from the dump. */
  input: Record<string, unknown>;
}

/**
 * Routing path metadata — which stage of the Voyage + Gemini pipeline
 * produced the final answer.
 *
 *   fast   — Voyage embedding fast path matched with high confidence
 *   slow   — Gemini 2.5 Flash slow path was invoked
 *   queued — result came from the async queue (deferred slow path)
 */
export interface RouterMeta {
  path: 'fast' | 'slow' | 'queued';
  /** Round-trip latency in milliseconds, if the worker reported it. */
  latencyMs?: number;
  /** Top confidence score from the embedding pass, 0–1. */
  confidence?: number;
}

/** The hybrid router's response shape. */
export interface AiRouteResult {
  calls: RouterCall[];
  meta: RouterMeta;
}

// ─── injectable deps (for testing) ────────────────────────────────────────

export interface AiRouteDeps {
  fetchImpl?: typeof fetch;
  workerUrl?: string;
  /** Override consent check — defaults to research.hasConsent(). */
  hasConsent?: () => boolean;
  /** Override JWT source — defaults to getAuthJwt(). */
  getJwt?: () => string | null;
}

// ─── normalisation ─────────────────────────────────────────────────────────

/** Narrow an unknown value to a RouterCall, or return null. */
function parseCall(raw: unknown): RouterCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { tool?: unknown; input?: unknown };
  if (typeof r.tool !== 'string' || !r.tool) return null;
  const input =
    r.input && typeof r.input === 'object' ? (r.input as Record<string, unknown>) : {};
  return { tool: r.tool, input };
}

/** Narrow an unknown value to RouterMeta, falling back to 'slow'. */
function parseMeta(raw: unknown): RouterMeta {
  const fallback: RouterMeta = { path: 'slow' };
  if (!raw || typeof raw !== 'object') return fallback;
  const m = raw as { path?: unknown; latencyMs?: unknown; confidence?: unknown };
  const path =
    m.path === 'fast' || m.path === 'slow' || m.path === 'queued'
      ? m.path
      : 'slow';
  const latencyMs =
    typeof m.latencyMs === 'number' && Number.isFinite(m.latencyMs)
      ? m.latencyMs
      : undefined;
  const confidence =
    typeof m.confidence === 'number' && Number.isFinite(m.confidence)
      ? Math.min(Math.max(m.confidence, 0), 1)
      : undefined;
  return { path, ...(latencyMs !== undefined && { latencyMs }), ...(confidence !== undefined && { confidence }) };
}

// ─── main export ───────────────────────────────────────────────────────────

/**
 * Route a brain-dump through the cloud hybrid router.
 *
 * Consent-gated — skipped when the user has not opted in to research data
 * sharing (the dump text would leave the device). The caller (aiRouteBridge)
 * falls through to the on-device tier when this returns null.
 *
 * @returns AiRouteResult when the router returns usable calls, otherwise null.
 */
export async function aiRoute(
  text: string,
  deps: AiRouteDeps = {},
): Promise<AiRouteResult | null> {
  if (!text.trim()) return null;

  // Consent gate — dump text leaves the device.
  const account = getAccount();
  const consentOk = deps.hasConsent
    ? deps.hasConsent()
    : account?.research.hasConsent() === true;
  if (!consentOk) return null;

  const workerUrl = deps.workerUrl ?? env.VITE_AI_WORKER_URL;
  if (!workerUrl) return null;

  const jwt = (deps.getJwt ?? getAuthJwt)();
  // Auth is optional for the /route endpoint (worker may allow anon routing)
  // but we send it when available.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (jwt) headers.authorization = `Bearer ${jwt}`;

  const f = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!f) return null;

  try {
    const url = `${workerUrl.replace(/\/$/, '')}/route`;
    const res = await f(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
    });

    if (!res.ok) return null;

    const body: unknown = await res.json();
    if (!body || typeof body !== 'object') return null;

    const b = body as { calls?: unknown; meta?: unknown };
    if (!Array.isArray(b.calls)) return null;

    const calls: RouterCall[] = [];
    for (const raw of b.calls) {
      const call = parseCall(raw);
      if (call) calls.push(call);
    }

    if (calls.length === 0) return null;

    return { calls, meta: parseMeta(b.meta) };
  } catch {
    return null;
  }
}
