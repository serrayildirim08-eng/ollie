/**
 * apps/native · api/workers.ts
 *
 * Typed fetch wrappers for every Cloudflare Worker endpoint Ollie uses.
 * All functions return ApiResult<T> — never throw. Callers branch on `.ok`.
 *
 * Worker URLs come from Vite env (see .env.example). The pattern mirrors
 * packages/api/client.ts but is standalone (no workspace dep required).
 *
 * Endpoints wired:
 *   ai-proxy  POST /brain-dump        → brainDump()
 *             POST /enrich-dump       → enrichDump()
 *             POST /ingest-event      → ingestEvent()
 *             POST /label             → label()
 *             POST /generate-invite   → generateInvite()
 *             POST /validate-invite   → validateInvite()
 *             POST /claim-invite      → claimInvite()
 *   apns-push POST /push              → pushSend()
 *   sentry    POST /tunnel            → sentryTunnel()
 */

import type {
  ApiResult,
  BrainCopyRequest,
  BrainCopyResponse,
  BrainDumpRequest,
  BrainDumpResponse,
  CookHistoryRequest,
  CookHistoryResponse,
  EnrichDumpRequest,
  EnrichDumpResponse,
  FeedMeRequest,
  FeedMeResponse,
  IngestEventRequest,
  IngestEventResponse,
  LabelRequest,
  LabelResponse,
  GenerateInviteRequest,
  GenerateInviteResponse,
  ValidateInviteRequest,
  ValidateInviteResponse,
  ClaimInviteRequest,
  ClaimInviteResponse,
  PushRegisterRequest,
  PushRegisterResponse,
  RouteDumpRequest,
  RouteModuleRequest,
  RouteModuleResponse,
  SentryEnvelope,
  ShelfLifeAllResponse,
} from './types';
import type { RouterOutput } from '../router/schema';

// ─── env helpers ──────────────────────────────────────────────────────────────

function workerUrl(key: string, fallback?: string): string {
  const val = import.meta.env[key] as string | undefined;
  if (val) return val.replace(/\/$/, '');
  if (fallback) return fallback;
  throw new Error(`[ollie/native] Missing worker URL env var: ${key}`);
}

// Lazy getters so missing env only throws when the function is actually called.
export const urls = {
  get aiProxy() { return workerUrl('VITE_AI_PROXY_URL', 'https://ollie-api.ollieapp.workers.dev'); },
  get routeDump() {
    const override = import.meta.env.VITE_ROUTE_DUMP_URL as string | undefined;
    if (override) return override.replace(/\/$/, '');
    return this.aiProxy;
  },
  get apnsPush() { return workerUrl('VITE_APNS_PUSH_URL', 'https://ollie-apns.ollieapp.workers.dev'); },
  get sentryTunnel() { return workerUrl('VITE_SENTRY_TUNNEL_URL', 'https://ollie-sentry.ollieapp.workers.dev'); },
};

// ─── ai-proxy: /route/:module — module-specific Layer 2 routing ───────────────

/**
 * Re-route an ambiguous fragment through the module-specific AI endpoint.
 * Called by module handlers when Layer 1 emits `dump_only` or `needsConfirm`.
 *
 * The worker responds with a `RouteModuleResponse` whose `actions` array the
 * caller uses to replace the original fragment action before persisting.
 */
export function routeModule(
  module: string,
  text: string,
  opts: { bearer: string; timeoutMs?: number },
): Promise<ApiResult<RouteModuleResponse>> {
  const req: RouteModuleRequest = { module, text };
  return post<RouteModuleResponse>(
    `${urls.aiProxy}/route/${module}`,
    req,
    { authJwt: opts.bearer, timeoutMs: opts.timeoutMs ?? 15_000 },
  );
}

// ─── ai-proxy: /brain-copy — Sprint 3 noticing sentence generation ───────────

/**
 * Generate ONE calm, neutral noticing sentence in the user's app language. The
 * system + user prompts are built client-side by @ollie/logic/brain's
 * buildCopyPrompt; the worker only wraps a Layer-2 model. Short timeout — the
 * caller has a trilingual hardcoded fallback (fallbackCopy) and uses it on any
 * non-ok result, so a live worker is NOT required for correctness.
 */
export function routeBrainCopy(
  req: BrainCopyRequest,
  opts: { bearer: string; timeoutMs?: number },
): Promise<ApiResult<BrainCopyResponse>> {
  return post<BrainCopyResponse>(
    `${urls.aiProxy}/brain-copy`,
    req,
    { authJwt: opts.bearer, timeoutMs: opts.timeoutMs ?? 8_000 },
  );
}

// ─── ai-proxy: /feed-me/:user — Layer 2 recipe suggestion ────────────────────

/**
 * Ask the worker for AI-generated recipes derived from the user's pantry.
 * Worker handles PII scrub + Voyage embedding cache + Gemini call, returning
 * either `source='gemini' | 'cache_hit'` with suggestions or, on upstream
 * failure, `source='static_fallback'` with an empty list (HTTP 200). The
 * caller treats an empty static_fallback as "nothing to render right now".
 *
 * `userId` is the path UUID — must match the verified JWT `sub` claim or
 * the worker returns 403.
 */
export function routeFeedMe(
  userId: string,
  req: FeedMeRequest,
  opts: { bearer: string; timeoutMs?: number },
): Promise<ApiResult<FeedMeResponse>> {
  return post<FeedMeResponse>(
    `${urls.aiProxy}/feed-me/${encodeURIComponent(userId)}`,
    req,
    { authJwt: opts.bearer, timeoutMs: opts.timeoutMs ?? 20_000 },
  );
}

// ─── ai-proxy: /cook-history — event ingest ───────────────────────────────────

/**
 * Record a cook event. Used by the "cooked it" affordance under each recipe
 * card. Fire-and-forget on the calling side: a failed write only loses one
 * cook signal, doesn't block the optimistic UI.
 */
export function routeCookHistory(
  req: CookHistoryRequest,
  opts: { bearer: string; timeoutMs?: number },
): Promise<ApiResult<CookHistoryResponse>> {
  return post<CookHistoryResponse>(
    `${urls.aiProxy}/cook-history`,
    req,
    { authJwt: opts.bearer, timeoutMs: opts.timeoutMs ?? 10_000 },
  );
}

// ─── ai-proxy: /transcribe — brain-dump mic → text (Groq Whisper) ────────────

/**
 * Send a recorded audio clip for transcription. Posts the raw bytes (the post()
 * helper is JSON-only, so this is a bespoke fetch) and returns the recognised
 * text for the dump input to pre-fill.
 */
export async function routeTranscribe(
  audio: Blob,
  opts: { bearer: string; timeoutMs?: number },
): Promise<ApiResult<{ text: string }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${urls.aiProxy}/transcribe`, {
      method: 'POST',
      headers: {
        'content-type': audio.type || 'audio/webm',
        authorization: `Bearer ${opts.bearer}`,
      },
      body: audio,
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { ok: false, error: { code: 'unauthorized', status: 401, message: 'unauthorized' } };
    }
    if (res.status === 429) {
      return { ok: false, error: { code: 'rate_limited', status: 429, message: 'rate limited' } };
    }
    if (!res.ok) {
      const bodyText = await safeText(res);
      return {
        ok: false,
        error: { code: 'http', status: res.status, message: `http ${res.status}`, body: bodyText },
      };
    }
    const data = (await res.json()) as { text: string };
    return { ok: true, data, status: res.status };
  } catch (err) {
    const e = err as Error & { name?: string };
    if (e?.name === 'AbortError') {
      return { ok: false, error: { code: 'timeout', message: 'transcription timed out' } };
    }
    return { ok: false, error: { code: 'network', message: e?.message ?? 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}

// ─── ai-proxy: /partner/* — bilateral "intimate window" sync ─────────────────

export interface PartnerSnapshotWire {
  phrases: string[];
  self_word: string | null;
  crisis: boolean;
  gone_dark: boolean;
  updated_at?: string;
}

export interface PartnerSnapshotResult {
  paired: boolean;
  partnerId: string | null;
  snapshot: PartnerSnapshotWire | null;
}

export function mintPartnerCode(opts: { bearer: string }): Promise<ApiResult<{ code: string; expiresInSec: number }>> {
  return post(`${urls.aiProxy}/partner/code`, {}, { authJwt: opts.bearer, timeoutMs: 12_000 });
}

export function pairPartner(code: string, opts: { bearer: string }): Promise<ApiResult<{ partnerId: string }>> {
  return post(`${urls.aiProxy}/partner/pair`, { code }, { authJwt: opts.bearer, timeoutMs: 12_000 });
}

export function putPartnerSnapshot(
  snapshot: PartnerSnapshotWire,
  opts: { bearer: string },
): Promise<ApiResult<{ ok: true }>> {
  return post(`${urls.aiProxy}/partner/snapshot`, snapshot, { authJwt: opts.bearer, timeoutMs: 12_000 });
}

export function unpairPartner(opts: { bearer: string }): Promise<ApiResult<{ ok: true }>> {
  return post(`${urls.aiProxy}/partner/unpair`, {}, { authJwt: opts.bearer, timeoutMs: 12_000 });
}

/** GET the partner's current snapshot (the other side). */
export async function getPartnerSnapshot(opts: { bearer: string; timeoutMs?: number }): Promise<ApiResult<PartnerSnapshotResult>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(`${urls.aiProxy}/partner/snapshot`, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${opts.bearer}` },
      signal: controller.signal,
    });
    if (res.status === 401) return { ok: false, error: { code: 'unauthorized', status: 401, message: 'unauthorized' } };
    if (!res.ok) return { ok: false, error: { code: 'http', status: res.status, message: `http ${res.status}` } };
    const data = (await res.json()) as PartnerSnapshotResult;
    return { ok: true, data, status: res.status };
  } catch (err) {
    const e = err as Error & { name?: string };
    if (e?.name === 'AbortError') return { ok: false, error: { code: 'timeout', message: 'timeout' } };
    return { ok: false, error: { code: 'network', message: e?.message ?? 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}

// ─── ai-proxy: /shelf-life/all — pantry aging reference table ────────────────

/**
 * Fetch the canonical shelf-life table + alias map. Supports ETag
 * conditional GET — pass the last seen ETag in `ifNoneMatch` and the
 * worker may return 304 (no body) when the table hasn't bumped.
 *
 * The returned `etag` (when present) should be persisted by the caller
 * alongside the body so the next call can use it. On 304 the caller
 * keeps its existing cached body.
 *
 * Unauthenticated by design — the table is the same for every user.
 */
export async function getShelfLifeAll(
  opts: { ifNoneMatch?: string | null; timeoutMs?: number } = {},
): Promise<
  | { ok: true; status: 200; data: ShelfLifeAllResponse; etag: string | null }
  | { ok: true; status: 304; etag: string | null }
  | { ok: false; error: { code: string; status?: number; message: string } }
> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.ifNoneMatch) headers['if-none-match'] = opts.ifNoneMatch;

  try {
    const res = await fetch(`${urls.aiProxy}/shelf-life/all`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const etag = res.headers.get('etag');

    if (res.status === 304) {
      return { ok: true, status: 304, etag };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: { code: 'http', status: res.status, message: `http ${res.status}` },
      };
    }
    let data: ShelfLifeAllResponse;
    try {
      data = (await res.json()) as ShelfLifeAllResponse;
    } catch (e) {
      return {
        ok: false,
        error: { code: 'parse', status: res.status, message: `parse failed: ${(e as Error).message}` },
      };
    }
    return { ok: true, status: 200, data, etag };
  } catch (err) {
    const e = err as Error & { name?: string };
    if (e?.name === 'AbortError') {
      return { ok: false, error: { code: 'timeout', message: 'shelf-life fetch timeout' } };
    }
    return { ok: false, error: { code: 'network', message: e?.message ?? 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}

// ─── ai-proxy: /route/dump — v2 brain-dump router ─────────────────────────────

export function routeDump(
  req: RouteDumpRequest,
  opts: { bearer: string; timeoutMs?: number },
): Promise<ApiResult<RouterOutput>> {
  return post<RouterOutput>(
    `${urls.routeDump}/route/dump`,
    req,
    { authJwt: opts.bearer, timeoutMs: opts.timeoutMs ?? 30_000 },
  );
}

// ─── core fetch helper ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;

async function post<T>(
  url: string,
  body: unknown,
  opts: {
    timeoutMs?: number;
    extraHeaders?: Record<string, string>;
    authJwt?: string;
  } = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json',
    ...(opts.extraHeaders ?? {}),
  };
  if (opts.authJwt) headers['authorization'] = `Bearer ${opts.authJwt}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401) {
      return { ok: false, error: { code: 'unauthorized', status: 401, message: 'unauthorized' } };
    }
    if (res.status === 429) {
      return { ok: false, error: { code: 'rate_limited', status: 429, message: 'rate limited' } };
    }
    if (!res.ok) {
      const bodyText = await safeText(res);
      return {
        ok: false,
        error: { code: 'http', status: res.status, message: `http ${res.status}`, body: bodyText },
      };
    }

    let data: T;
    try {
      data = (await res.json()) as T;
    } catch (e) {
      return {
        ok: false,
        error: { code: 'parse', status: res.status, message: `parse failed: ${(e as Error).message}` },
      };
    }
    return { ok: true, data, status: res.status };
  } catch (err) {
    const e = err as Error & { name?: string };
    if (e?.name === 'AbortError') {
      return { ok: false, error: { code: 'timeout', message: `timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` } };
    }
    return { ok: false, error: { code: 'network', message: e?.message ?? 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string | undefined> {
  try { return await res.text(); } catch { return undefined; }
}

// ─── ai-proxy: /brain-dump ────────────────────────────────────────────────────

/**
 * Forward a Claude Haiku request through the ai-proxy worker.
 * The worker hides ANTHROPIC_API_KEY; we never see it client-side.
 *
 * Auth: the worker now requires a verified Clerk session JWT (Bearer) and
 * derives the per-user rate-limit key from the verified token `sub` — the
 * old spoofable x-user-id header is ignored. Pass `bearer` (a Clerk JWT) or
 * the call will 401. (This helper currently has no live caller; the real
 * brain-dump flow goes through the Clerk-authed /route/dump endpoint.)
 */
export function brainDump(
  req: BrainDumpRequest,
  opts: { bearer?: string; timeoutMs?: number } = {},
): Promise<ApiResult<BrainDumpResponse>> {
  return post<BrainDumpResponse>(
    `${urls.aiProxy}/brain-dump`,
    req,
    {
      extraHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
      authJwt: opts.bearer,
      timeoutMs: opts.timeoutMs ?? 10_000,
    },
  );
}

// ─── ai-proxy: /enrich-dump ───────────────────────────────────────────────────

/**
 * Queue a brain-dump for async PII scrub + Anthropic enrichment.
 * Fire-and-forget in most call sites — zero added UX latency.
 */
export function enrichDump(
  req: EnrichDumpRequest,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<EnrichDumpResponse>> {
  return post<EnrichDumpResponse>(
    `${urls.aiProxy}/enrich-dump`,
    req,
    { timeoutMs: opts.timeoutMs ?? 5_000 },
  );
}

// ─── ai-proxy: /ingest-event ──────────────────────────────────────────────────

/**
 * Insert a single telemetry row into Supabase via the worker.
 * The worker validates `table` against an allowlist (retention_events,
 * session_events, module_events, crisis_events, consent_audit).
 */
export function ingestEvent(
  req: IngestEventRequest,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<IngestEventResponse>> {
  return post<IngestEventResponse>(
    `${urls.aiProxy}/ingest-event`,
    req,
    { timeoutMs: opts.timeoutMs ?? 8_000 },
  );
}

// ─── ai-proxy: /label ─────────────────────────────────────────────────────────

export function label(
  req: LabelRequest,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<LabelResponse>> {
  return post<LabelResponse>(
    `${urls.aiProxy}/label`,
    req,
    { timeoutMs: opts.timeoutMs ?? 10_000 },
  );
}

// ─── ai-proxy: invite endpoints ───────────────────────────────────────────────

/**
 * Mint a single-use invite code. Requires a Supabase user JWT.
 * Rate-limited: 5 generates per user per 24h.
 */
export function generateInvite(
  req: GenerateInviteRequest,
  authJwt: string,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<GenerateInviteResponse>> {
  return post<GenerateInviteResponse>(
    `${urls.aiProxy}/generate-invite`,
    req,
    {
      extraHeaders: { 'x-user-jwt': authJwt },
      timeoutMs: opts.timeoutMs ?? 8_000,
    },
  );
}

/**
 * Check whether an invite code is still valid (unauthenticated).
 * Use on the join/landing screen before showing the signup form.
 */
export function validateInvite(
  req: ValidateInviteRequest,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<ValidateInviteResponse>> {
  return post<ValidateInviteResponse>(
    `${urls.aiProxy}/validate-invite`,
    req,
    { timeoutMs: opts.timeoutMs ?? 8_000 },
  );
}

/**
 * Atomically mark an invite code as used at signup. Requires a Supabase user JWT.
 * Call once immediately after the user's account is created.
 */
export function claimInvite(
  req: ClaimInviteRequest,
  authJwt: string,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<ClaimInviteResponse>> {
  return post<ClaimInviteResponse>(
    `${urls.aiProxy}/claim-invite`,
    req,
    {
      extraHeaders: { 'x-user-jwt': authJwt },
      timeoutMs: opts.timeoutMs ?? 8_000,
    },
  );
}

// ─── apns-push: /push ─────────────────────────────────────────────────────────

/**
 * Send an APNs push notification via the push worker.
 * The worker holds the Apple p8 key — clients never see it.
 *
 * Payload should follow Apple notification payload spec:
 *   { aps: { alert: { title, body }, sound: 'default' } }
 *
 * Rate-limited: 5 req/sec per user on the worker side.
 */
export function pushSend(
  req: PushRegisterRequest,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<PushRegisterResponse>> {
  return post<PushRegisterResponse>(
    `${urls.apnsPush}/push`,
    req,
    { timeoutMs: opts.timeoutMs ?? 10_000 },
  );
}

// ─── sentry-tunnel: /tunnel ───────────────────────────────────────────────────

/**
 * Forward a Sentry SDK envelope through the tunnel worker.
 * The Sentry SDK calls this automatically when `tunnel` is configured
 * in Sentry.init() — you typically do not call this directly.
 *
 * Body must be the raw line-delimited JSON envelope string as produced
 * by the Sentry SDK (do not JSON.stringify it again).
 */
export async function sentryTunnel(
  envelope: SentryEnvelope,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetch(`${urls.sentryTunnel}/tunnel`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body: envelope,
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await safeText(res);
      return {
        ok: false,
        error: { code: 'http', status: res.status, message: `http ${res.status}`, body: bodyText },
      };
    }
    return { ok: true, data: undefined, status: res.status };
  } catch (err) {
    const e = err as Error & { name?: string };
    if (e?.name === 'AbortError') {
      return { ok: false, error: { code: 'timeout', message: 'sentry tunnel timeout' } };
    }
    return { ok: false, error: { code: 'network', message: e?.message ?? 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}
