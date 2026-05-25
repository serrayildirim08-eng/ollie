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
  BrainDumpRequest,
  BrainDumpResponse,
  EnrichDumpRequest,
  EnrichDumpResponse,
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
  SentryEnvelope,
} from './types';

// ─── env helpers ──────────────────────────────────────────────────────────────

function workerUrl(key: string, fallback?: string): string {
  const val = import.meta.env[key] as string | undefined;
  if (val) return val.replace(/\/$/, '');
  if (fallback) return fallback;
  throw new Error(`[ollie/native] Missing worker URL env var: ${key}`);
}

// Lazy getters so missing env only throws when the function is actually called.
const urls = {
  get aiProxy() { return workerUrl('VITE_AI_PROXY_URL', 'https://ollie-api.ollieapp.workers.dev'); },
  get apnsPush() { return workerUrl('VITE_APNS_PUSH_URL', 'https://ollie-apns.ollieapp.workers.dev'); },
  get sentryTunnel() { return workerUrl('VITE_SENTRY_TUNNEL_URL', 'https://ollie-sentry.ollieapp.workers.dev'); },
};

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
 * x-user-id header is injected if userId is provided — used for per-user
 * rate limiting in the worker (10 req/min).
 */
export function brainDump(
  req: BrainDumpRequest,
  opts: { userId?: string; timeoutMs?: number } = {},
): Promise<ApiResult<BrainDumpResponse>> {
  const extra: Record<string, string> = {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  };
  if (opts.userId) extra['x-user-id'] = opts.userId;

  return post<BrainDumpResponse>(
    `${urls.aiProxy}/brain-dump`,
    req,
    { extraHeaders: extra, timeoutMs: opts.timeoutMs ?? 10_000 },
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
