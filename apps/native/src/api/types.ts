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

export interface RouteDumpRequest {
  text: string;
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
