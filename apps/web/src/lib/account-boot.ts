/**
 * apps/web · account boot
 *
 * Wires the account-layer packages into the running app:
 *   - @ollie/api             → centralised fetch client
 *   - @ollie/auth            → passphrase-derived encryption vault
 *   - @ollie/research-stream → opt-in anonymous STRUCTURED-EVENT capture (Path A)
 *
 * ─── Clerk migration · Phase 1 (2026-05-19) ─────────────────────────────────
 *
 * Identity moved to Clerk. Two subsystems that used to boot here are
 * deferred to Phase 2:
 *   - @ollie/sync          (encrypted multi-device sync)
 *   - @ollie/orchestrator  (Path B free-text research pipeline)
 * Both authenticate to Supabase, which does not yet accept Clerk tokens
 * (the Clerk↔Supabase integration is Phase 2). Until then they would only
 * fail, so they are not booted — the app runs local-only, exactly the
 * documented best-effort degrade. They are re-wired in Phase 2 with the
 * Clerk user id + a Supabase-accepted JWT.
 *
 * ─── research-stream · Path A (still booted) ────────────────────────────────
 *
 * @ollie/research-stream captures STRUCTURED telemetry rows only
 * (retention_events, session_events, module_events, consent_audit) —
 * fixed-schema metadata, never free-text user content, so there is no
 * PII leak. track() is consent-gated and the whole path is best-effort:
 * with no backend JWT in Phase 1 its flushes fail silently and the rows
 * stay local — the pre-existing degrade path. `attachTelemetryBridge`
 * forwards a few orphaned product events (finance impulse-pause, voice
 * capture, grocery interest) into research.track() — metadata only.
 *
 * Everything here is best-effort. Failures degrade to local-only mode;
 * they never throw or block first paint.
 */

import { createOllieAPI } from '@ollie/api';
import type { OllieAPI } from '@ollie/api';
import { createVault } from '@ollie/auth';
import type { VaultClient } from '@ollie/auth';
import { createResearchStream } from '@ollie/research-stream';
import type { ResearchClient } from '@ollie/research-stream';
import * as events from '@ollie/events';
import { store } from '../store';

interface ViteEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_ANTHROPIC_PROXY_URL?: string;
  VITE_RESEARCH_ENDPOINT?: string;
  VITE_AI_WORKER_URL?: string;
  VITE_USER_HASH_SALT?: string;
}

/**
 * Read Vite env lazily rather than snapshotting at module load. bootAccount()
 * runs after first paint, so a fresh read is free — and it keeps tests
 * honest (they can stub VITE_* before the boot call).
 */
function viteEnv(): ViteEnv {
  return (import.meta as unknown as { env?: ViteEnv }).env ?? {};
}

interface AccountBootHandles {
  api: OllieAPI;
  /** Passphrase-derived encryption vault (@ollie/auth). */
  vault: VaultClient;
  /** Path-A structured-telemetry research stream. */
  research: ResearchClient;
}

let handles: AccountBootHandles | null = null;

/** Active telemetry-bridge unsubscribers — torn down in _resetAccountBoot(). */
let telemetryUnsubs: Array<() => void> = [];

/**
 * Subscribe the orphaned telemetry events and forward each to
 * `research.track()`. Called once from bootAccount(). track() is consent
 * gated and fire-and-forget, so this is harmless when consent is off.
 */
function attachTelemetryBridge(research: ResearchClient): void {
  if (telemetryUnsubs.length > 0) return; // idempotent

  function bridge(eventName: string, telemetryType: string): void {
    telemetryUnsubs.push(
      events.on(eventName, (raw: unknown) => {
        try {
          const payload = (raw && typeof raw === 'object')
            ? (raw as Record<string, unknown>)
            : {};
          research.track(telemetryType, payload);
        } catch { /* telemetry is best-effort */ }
      }),
    );
  }

  bridge('finance:impulse_pause_started', 'finance.impulse_pause.started');
  bridge('finance:impulse_pause_resolved', 'finance.impulse_pause.resolved');
  bridge('auth:signed_up', 'auth.signed_up');
  bridge('voice:capture_started', 'voice.capture.started');
  bridge('voice:capture_transcribed', 'voice.capture.transcribed');
  bridge('voice:capture_cancelled', 'voice.capture.cancelled');
  bridge('grocery:interest_capture_detected', 'grocery.interest_capture.detected');
}

/** Singleton accessor — returns null until bootAccount() has run. */
export function getAccount(): AccountBootHandles | null {
  return handles;
}

/**
 * The bearer token for authenticated backend calls.
 *
 * Phase 1 (Clerk migration): returns null. Supabase no longer mints our
 * JWT, and the Cloudflare workers do not yet verify Clerk tokens. Callers
 * (invite, enrich-dump, /label, server jobs) treat null as "skip the
 * request" — their documented best-effort degrade. Re-wired to the Clerk
 * session token in Phase 3, when the workers verify Clerk JWTs.
 */
export function getAuthJwt(): string | null {
  return null;
}

/**
 * The signed-in user's id for backend payloads (push-token mirroring,
 * server jobs). Phase 1: null — re-wired to the Clerk user id in Phase 2.
 */
export function getAuthUserId(): string | null {
  return null;
}

/**
 * One-time boot. Idempotent. Call once at app start. Everything is
 * env-driven; production calls `bootAccount()` with no args.
 */
export function bootAccount(): AccountBootHandles {
  if (handles) return handles;

  const env = viteEnv();

  const api = createOllieAPI({
    anthropicProxy: env.VITE_ANTHROPIC_PROXY_URL,
    supabaseUrl: env.VITE_SUPABASE_URL,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
  });

  // The encryption vault. Holds the passphrase-derived AES key in memory
  // only; Clerk owns identity. See @ollie/auth.
  const vault = createVault({ store });

  const research = createResearchStream({
    store,
    api,
    endpointUrl: env.VITE_RESEARCH_ENDPOINT,
    ingestUrl: env.VITE_AI_WORKER_URL,
    // Phase 1 (Clerk migration): the /ingest-event worker still expects a
    // Supabase JWT, which we no longer mint. Hand it null — flushes degrade
    // to local-only. Re-wired to the Clerk session token in Phase 3, when
    // the workers verify Clerk JWTs.
    getJwt: () => null,
  });
  // Start the research flush loop unconditionally; track() is a no-op
  // until consent is granted, so the loop is harmless when off.
  research.start();

  handles = { api, vault, research };

  // Bridge orphaned telemetry events → research.track (consent gated).
  attachTelemetryBridge(research);

  return handles;
}

/**
 * Test-only — drop the singleton so a fresh bootAccount() runs clean.
 * Tears down the telemetry-bridge subscriptions so they don't leak the
 * @ollie/events subscription across test cases.
 */
export function _resetAccountBoot(): void {
  telemetryUnsubs.splice(0).forEach((fn) => { try { fn(); } catch { /* noop */ } });
  handles = null;
}
