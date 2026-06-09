/**
 * apps/native · api/types.ts
 *
 * Shared request / response types for all CF Worker endpoints.
 * Derived directly from worker source contracts (workers/ai-proxy, workers/apns-push).
 */

// ─── Generic result envelope (mirrors @ollie/api OllieApiResult) ──────────────

export interface ApiError {
  code:
    | 'network'
    | 'timeout'
    | 'http'
    | 'parse'
    | 'aborted'
    | 'unauthorized'
    | 'rate_limited';
  status?: number;
  message: string;
  body?: string;
}

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: ApiError };

// ─── /route/dump (POST) — v2 brain-dump router ────────────────────────────────

/**
 * MIME types accepted by the /route/dump vision pipeline. Anything outside
 * this list is rejected client-side before encoding so the worker never
 * sees a malformed payload.
 */
export type RouteDumpImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

export interface RouteDumpImage {
  mime: RouteDumpImageMime;
  /** Base64-encoded compressed image bytes. ≤900KB after encoding (≈700KB raw). */
  data: string;
}

export interface RouteDumpRequest {
  /** Free-text dump. At least one of `text` / `image` must be present. */
  text?: string;
  /** Optional photo intake — receipt / pill bottle / handwritten note / etc. */
  image?: RouteDumpImage;
  dumpId?: string;
  locale?: string;
}

// ─── /brain-dump (POST) ───────────────────────────────────────────────────────

export interface BrainDumpRequest {
  model: string;
  max_tokens: number;
  system: Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface BrainDumpResponse {
  content: Array<{ type: string; text: string }>;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// ─── /route/:module — module-specific AI routing (POST) ───────────────────────

export interface RouteModuleRequest {
  /** Module name (grocery, work, finance, …) */
  module: string;
  /** Free-text input to route */
  text: string;
  /** Optional user context block appended as second system message */
  context?: string;
}

export interface RouteModuleResponse {
  /** Parsed actions array from Haiku response */
  actions: Array<{
    module: string;
    action: string;
    data: string;
    daysAgo?: number;
    [key: string]: unknown;
  }>;
}

// ─── /brain-copy (POST) — Sprint 3 "speak in your words" ──────────────────────
//
// Generate one calm, neutral, situation-fitted noticing sentence in the user's
// app language. The worker wraps a Layer-2 model with the system+user prompt
// built client-side (packages/logic/src/brain/copy.ts). On any upstream failure
// the worker SHOULD return source='static_fallback' with text='' (HTTP 200);
// the client then uses its own trilingual fallbackCopy. The client also falls
// back on a non-ok ApiResult, so a live worker is not required for correctness.

export interface BrainCopyRequest {
  /** Pre-built system prompt (calm/neutral voice + target language). */
  system: string;
  /** Pre-built user prompt (the situation facts). */
  user: string;
  /** Target app language — passed through for worker-side logging / guards. */
  lang: 'en' | 'es' | 'tr';
}

export interface BrainCopyResponse {
  /** The generated sentence, or '' when the worker fell back. */
  text: string;
  source?: 'ai' | 'cache_hit' | 'static_fallback';
}

// ─── /enrich-dump (POST) ──────────────────────────────────────────────────────

export interface EnrichDumpRequest {
  user_hash: string;
  device_id: string;
  event_ts: string;
  locale: string;
  country: string;
  modality: 'voice' | 'text' | 'paste';
  raw_text: string;
  routing_module?: string | null;
  app_version: string;
}

export interface EnrichDumpResponse {
  id: string | null;
  queued: boolean;
  reason?: string;
}

// ─── /ingest-event (POST) ─────────────────────────────────────────────────────

export type IngestTable =
  | 'retention_events'
  | 'session_events'
  | 'module_events'
  | 'crisis_events'
  | 'consent_audit';

export interface IngestEventRequest {
  table: IngestTable;
  row: Record<string, unknown>;
}

export interface IngestEventResponse {
  ok: boolean;
  table?: string;
  inserted?: number;
  dropped?: string;
  status?: number;
  error?: string;
}

// ─── /label (POST) ────────────────────────────────────────────────────────────

export interface LabelRequest {
  text: string;
  [key: string]: unknown;
}

export interface LabelResponse {
  label: string;
  [key: string]: unknown;
}

// ─── /generate-invite (POST) ──────────────────────────────────────────────────

export interface GenerateInviteRequest {
  inviter_user_hash: string;
}

export interface GenerateInviteResponse {
  code: string;
  share_url: string;
  expires_at: string;
}

// ─── /validate-invite (POST) ──────────────────────────────────────────────────

export interface ValidateInviteRequest {
  code: string;
}

export interface ValidateInviteResponse {
  valid: boolean;
  reason?: 'not_found' | 'used' | 'expired';
}

// ─── /claim-invite (POST) ─────────────────────────────────────────────────────

export interface ClaimInviteRequest {
  code: string;
  invitee_user_hash: string;
}

export interface ClaimInviteResponse {
  success: boolean;
  code?: string;
  reason?: 'not_found' | 'used' | 'expired' | 'unknown';
}

// ─── /feed-me/:user (POST) — Layer 2 recipe suggestion ───────────────────────
//
// Mirrors workers/ai-proxy/src/router/feed-me.ts. The worker accepts a body
// shaped by FeedMeRequest and replies with FeedMeResponse. Source of truth
// for the contract: feed-me.ts:62-77 and feed-me.config.ts:31-46.
//
// The endpoint is per-user (path UUID) and Clerk-JWT gated. Worker returns
// `{ suggestions: [], source: 'static_fallback' }` with status 200 when
// Voyage or Gemini fail upstream — the UI treats source='static_fallback'
// + empty suggestions as "nothing to show, suggest dumping more".

export type FeedDietFilter = 'all' | 'vegetarian' | 'vegan' | 'mediterranean' | 'turkish';
export type FeedLocale = 'en' | 'es' | 'tr';
export type FeedTarget = 'user' | 'pet';
export type FeedSource =
  | 'gemini'
  | 'groq'
  | 'cloudflare'
  | 'openrouter'
  | 'cache_hit'
  | 'static_fallback';

export interface FeedMeRequest {
  pantry: string[];
  diet?: FeedDietFilter;
  feedTarget?: FeedTarget;
  petName?: string;
  count?: number;
  locale: FeedLocale;
  excludeDishes?: string[];
}

export interface FeedRecipeIngredient {
  name: string;
  canonical: string | null;
  have: boolean;
  qty?: number;
  unit?: string;
}

export interface FeedRecipeSuggestion {
  dish: string;
  cuisine: string;
  diet: string[];
  ingredients: FeedRecipeIngredient[];
  steps: string[];
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  reasonSuggested?: string;
}

export interface FeedMeResponse {
  suggestions: FeedRecipeSuggestion[];
  source: FeedSource;
  latencyMs: number;
}

// ─── /cook-history (POST) — cook event ingestion ─────────────────────────────
//
// Mirrors workers/ai-proxy/src/router/cook-history.ts. Body shape frozen with
// backend-senior; UI omits cuisine/diet/cookedAt for "just cooked it" v1 path.

export type CookRating = -1 | 0 | 1;

export interface CookHistoryRequest {
  dish: string;
  cuisine?: string;
  diet?: string[];
  rating: CookRating;
  feedTarget: FeedTarget;
  petName?: string | null;
  ingredientsUsed?: Array<{ name: string; canonical: string | null }>;
  cookedAt?: number;
}

export interface CookHistoryResponse {
  inserted: true;
  id?: string;
}

// ─── /shelf-life/all (GET) — pantry aging reference table ───────────────────
//
// Mirrors workers/ai-proxy/src/router/shelf-life.ts (backend-senior pod,
// shipping in parallel). Returns the canonical 721-item shelf-life table
// plus its alias map. The endpoint is ETag-cacheable so the client only
// pays the full body once per version bump — see shelfLifeCache.ts for
// the If-None-Match handshake.
//
// `version` is monotonic; the cache bumps its KV record only when the
// version changes. Days are integer days from open/added → mild-faded.
// `null` would be allowed by the spec but the worker omits null rows.

export interface ShelfLifeAllResponse {
  /** canonical → shelf-life days (integer) */
  items: Record<string, number>;
  /** alias → canonical name (e.g. "skim milk" → "milk") */
  aliases: Record<string, string>;
  /** monotonic version of the table; bumps invalidate cache */
  version: number;
}

// ─── /push (POST) — apns-push worker ──────────────────────────────────────────

export interface PushRegisterRequest {
  deviceToken: string;
  payload: Record<string, unknown>;
  userId?: string;
  topic?: string;
}

export interface PushRegisterResponse {
  /** Empty object on APNs success; {reason: string} on APNs failure. */
  reason?: string;
}

// ─── /tunnel (POST) — sentry-tunnel worker ────────────────────────────────────

/** Raw Sentry envelope string — line-delimited JSON. */
export type SentryEnvelope = string;
