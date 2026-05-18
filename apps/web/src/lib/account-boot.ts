/**
 * apps/web · account boot (Credibility audit C2 fix)
 *
 * Wires the orphaned Sprint 2 packages into the running app:
 *   - @ollie/api      → centralised fetch client
 *   - @ollie/auth     → email/passphrase session + encryption key
 *   - @ollie/sync     → encrypted multi-device sync (when signed in)
 *   - @ollie/research-stream → opt-in anonymous STRUCTURED-EVENT capture
 *   - @ollie/orchestrator · research → opt-in FREE-TEXT scrub+label pipeline
 *
 * Boot order:
 *   1. Create the OllieAPI singleton with Supabase URL + anon key
 *      from Vite env. If env is missing, the helpers gracefully no-op.
 *   2. Create the auth client. Hand-off if a session is already in
 *      store. Otherwise wait for the auth UI to call signIn/signUp.
 *   3. When auth becomes "unlocked", boot the sync client AND the
 *      research orchestrator (both need a post-auth user id).
 *   4. Independently: hook the research-stream client up so its toggle
 *      surfaces (Garden consent screen + future settings) work.
 *
 * ─── Two research paths, both canonical, NOT redundant ──────────────────────
 *
 * There are deliberately TWO research data paths. They capture different
 * shapes of data and do not overlap:
 *
 *   A. @ollie/research-stream → POST /ingest-event
 *      Captures STRUCTURED telemetry rows only: retention_events,
 *      session_events, module_events, consent_audit. Every caller
 *      (retention.ts, session-tracker.ts, ModuleScreen.tsx, ConsentScreen)
 *      passes a fixed-schema row of metadata — counts, timestamps, module
 *      ids, country, app_version, user_hash. NO free-text user content is
 *      ever passed to trackTable(). There is therefore no PII-leak: the
 *      rows are metadata, and the pivot's "scrub before data leaves the
 *      device" promise concerns free-text, which this path never carries.
 *      Kept as-is.
 *
 *   ─── Telemetry event bridge ────────────────────────────────────────────
 *
 * A small set of orphaned product events (finance impulse-pause, sign-up,
 * voice capture) carry behavioural / funnel signal but had no consumer.
 * `attachTelemetryBridge()` subscribes them ONCE here and forwards each to
 * `research.track(type, payload)` — the structured-event queue, consent
 * gated inside track(). Payloads are metadata only (counts, reasons,
 * sources, timestamps): no free-text user content, so path-A's "no PII"
 * invariant holds. This is path A, not B.
 *
 *   B. @ollie/orchestrator · research → scrubPII → POST /label → research_corpus
 *      The Sprint B' pipeline. Captures FREE-TEXT the user typed
 *      (brain_dump_log, finance_records.description, *_records.note, …),
 *      PII-scrubs it on-device, then labels it via Anthropic. This is the
 *      path that was BUILT BUT NEVER BOOTED — fixed here.
 *
 * Canonical mapping: free-text → path B; structured metadata → path A.
 * Anyone tempted to push free-text through trackTable() must instead emit
 * `research:row_written` so it flows through the on-device scrubber first.
 *
 * Everything here is best-effort. Failures degrade to local-only mode
 * (current behavior pre-fix) — they never throw or block first paint.
 */

import { createOllieAPI } from '@ollie/api';
import type { OllieAPI } from '@ollie/api';
import { createAuthClient } from '@ollie/auth';
import type { AuthClient } from '@ollie/auth';
import { createSyncClient, createFinanceSyncClient } from '@ollie/sync';
import type { SyncClient, FinanceSyncClient } from '@ollie/sync';
import { createResearchStream } from '@ollie/research-stream';
import type { ResearchClient } from '@ollie/research-stream';
import { createResearchOrchestrator } from '@ollie/orchestrator';
import type { Orchestrator } from '@ollie/orchestrator';
import { invalidateSector } from '@ollie/research-cache';
import * as Sentry from '@sentry/react';
import * as events from '@ollie/events';
import { store } from '../store';
import { createLabelClient } from './label-client';

interface ViteEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_ANTHROPIC_PROXY_URL?: string;
  VITE_RESEARCH_ENDPOINT?: string;
  VITE_AI_WORKER_URL?: string;
  VITE_USER_HASH_SALT?: string;
  /**
   * Base URL of the api worker that hosts `POST /account/delete`.
   * Example: https://ollie-notifications.workers.dev
   * When unset, deleteAccount() returns code='no-endpoint'.
   */
  VITE_API_WORKER_URL?: string;
}

/**
 * Read Vite env lazily rather than snapshotting at module load. bootAccount()
 * and the post-auth orchestrator boot all run after first paint, so a fresh
 * read is free — and it keeps tests honest (they can stub VITE_* before the
 * boot call without fighting import-order).
 */
function viteEnv(): ViteEnv {
  return (import.meta as unknown as { env?: ViteEnv }).env ?? {};
}

interface AccountBootHandles {
  api: OllieAPI;
  auth: AuthClient;
  research: ResearchClient;
  sync: SyncClient | null;
  /** Per-record finance sync (Sprint 5). Lives alongside module-blob sync. */
  financeSync: FinanceSyncClient | null;
  /**
   * Sprint B' free-text research pipeline. Listens for `research:row_written`,
   * scrubs PII, POSTs to /label. Null until attachSync() runs post-auth (it
   * needs a stable user id for the consent gate) AND VITE_AI_WORKER_URL is set.
   */
  researchOrchestrator: Orchestrator | null;
}

let handles: AccountBootHandles | null = null;

/** Active telemetry-bridge unsubscribers — torn down in _resetAccountBoot(). */
const telemetryUnsubs: Array<() => void> = [];

/**
 * Subscribe the orphaned telemetry events and forward each to
 * `research.track()`. Called once from bootAccount(). track() is consent
 * gated and fire-and-forget, so this is harmless when consent is off.
 *
 * Events bridged:
 *   finance:impulse_pause_started / _resolved → behavioural retention
 *     signal — did the user actually abandon the purchase?
 *   auth:signed_up                            → sign-up funnel marker
 *   voice:capture_started / _transcribed / _cancelled → voice-input
 *     adoption + failure rate. capture_cancelled.reason is a UX
 *     diagnostic ('no-speech' vs. an error code).
 *   grocery:interest_capture_detected         → ADHD interest-hijack
 *     signal for B2B research. Metadata only (category, count,
 *     window_days) — no free-text, path-A invariant holds.
 */
function attachTelemetryBridge(research: ResearchClient): void {
  if (telemetryUnsubs.length > 0) return; // idempotent

  /** Forward one event to research.track, mapping name → telemetry type. */
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

/**
 * Optional boot overrides. Production passes nothing — every value is read
 * from `import.meta.env`. Tests inject deterministically here because Vite
 * gives each module its own frozen `import.meta.env`, so stubbing the env
 * from a test file never reaches this module.
 */
export interface BootOverrides {
  /** Forces the ai-proxy worker base URL (the `/label` host). */
  aiWorkerUrl?: string;
}

let bootOverrides: BootOverrides = {};

/** Singleton accessor — returns null until bootAccount() has run. */
export function getAccount(): AccountBootHandles | null {
  return handles;
}

/**
 * One-time boot. Idempotent. Call once at app start.
 *
 * `overrides` is for tests only — production calls `bootAccount()` with no
 * args and everything is env-driven.
 */
export function bootAccount(overrides: BootOverrides = {}): AccountBootHandles {
  if (handles) return handles;

  bootOverrides = overrides;
  const env = viteEnv();

  const api = createOllieAPI({
    anthropicProxy: env.VITE_ANTHROPIC_PROXY_URL,
    supabaseUrl: env.VITE_SUPABASE_URL,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
  });

  const accountDeleteUrl = env.VITE_API_WORKER_URL
    ? `${env.VITE_API_WORKER_URL.replace(/\/$/, '')}/account/delete`
    : undefined;
  const auth = createAuthClient({ store, api, accountDeleteUrl });

  const research = createResearchStream({
    store,
    api,
    endpointUrl: env.VITE_RESEARCH_ENDPOINT,
    ingestUrl: env.VITE_AI_WORKER_URL,
    // The /ingest-event worker endpoint requires a verified Supabase JWT.
    // research-stream is auth-isolated, so we hand the bearer token IN via
    // a lazy getter that reads the auth client's session at call time.
    // `auth` is in scope below; this closure runs only when trackTable()
    // fires, long after boot completes.
    getJwt: () => auth.state().session?.access_token ?? null,
  });
  // Start the research flush loop unconditionally; track() is a no-op
  // until consent is granted, so the loop is harmless when off.
  research.start();

  handles = {
    api,
    auth,
    research,
    sync: null,
    financeSync: null,
    researchOrchestrator: null,
  };

  // If a session is already in store from a previous run, the auth
  // client's `state()` reports it. But the in-memory encryption key
  // is gone after a reload — we can't decrypt anything until the
  // user signs in again on this device. That UX flow is owned by the
  // future sign-in screen; here we just expose the session so it can
  // be read.
  const sessionAlreadyPresent = !!auth.state().session;
  if (sessionAlreadyPresent && auth.state().unlocked) {
    // Cold boot won't typically reach this branch (key in memory only)
    // but kept for completeness — sync attaches automatically.
    void attachSync();
  }

  // On future sign-in / sign-up, the auth client emits auth:signed_in.
  events.on('auth:signed_in', () => { void attachSync(); });
  events.on('auth:signed_out', () => { detachSync(); });

  // Bridge orphaned telemetry events → research.track (consent gated).
  attachTelemetryBridge(research);

  return handles;
}

async function attachSync(): Promise<void> {
  if (!handles) return;
  const session = handles.auth.state().session;
  const key = handles.auth.encryptionKey();
  if (!session || !key) return;

  if (!handles.sync) {
    const sync = createSyncClient({
      store,
      api: handles.api,
      userId: session.user_id,
      authJwt: session.access_token,
      encryptionKey: key,
    });
    await sync.start();
    handles.sync = sync;
  }

  if (!handles.financeSync) {
    const financeSync = createFinanceSyncClient({
      store,
      api: handles.api,
      userId: session.user_id,
      authJwt: session.access_token,
      encryptionKey: key,
    });
    await financeSync.start();
    handles.financeSync = financeSync;
  }

  // Sprint B' free-text research pipeline. Boots here, post-auth, because
  // it needs a stable per-user id for the consent gate. We use
  // `session.user_id` (same identifier the sync clients above use): it is
  // ALWAYS present once authed, unlike readUserHash() which is only
  // populated on the invite-claim path. The consent layer treats `userId`
  // purely as a cache key over the single local `consent.state` row — it
  // is never persisted per-user and, critically, is never forwarded to
  // /label (the corpus row is anonymized server-side).
  bootResearchOrchestrator(session.user_id);
}

/**
 * Boot the free-text research orchestrator. Idempotent — safe to call on
 * every auth:signed_in. No-ops when VITE_AI_WORKER_URL is unset (no /label
 * endpoint to reach), leaving `research:row_written` events to fall
 * harmlessly on the floor exactly as they did before this fix.
 */
function bootResearchOrchestrator(userId: string): void {
  if (!handles) return;
  if (handles.researchOrchestrator) return;

  const workerUrl = bootOverrides.aiWorkerUrl ?? viteEnv().VITE_AI_WORKER_URL;
  if (!workerUrl) {
    // No worker URL → no /label. Don't boot; the orchestrator with a
    // throwing client would just spam Sentry on every flush.
    return;
  }

  const labelClient = createLabelClient({ workerUrl });

  const orchestrator = createResearchOrchestrator(store, {
    userId,
    labelClient,
    // onError → Sentry. Mirrors the app's error-reporting posture: Sentry
    // is init'd in main.tsx (with the Türk Telekom DPI tunnel applied
    // there), so a plain captureException routes through the same tunnel.
    // Failures here are silent to the user — corpus writes are best-effort.
    onError: (err, ctx) => {
      Sentry.captureException(err, {
        tags: { area: 'research-pipeline' },
        extra: { table: ctx.table, row_id: ctx.row_id },
      });
    },
    // onCorpusAppended → evict the research-cache entry for that sector so
    // the next "users like you" insight read recomputes instead of serving
    // a stale 1h snapshot.
    onCorpusAppended: (sector) => {
      invalidateSector(sector);
    },
  });

  orchestrator.init();
  handles.researchOrchestrator = orchestrator;
}

function detachSync(): void {
  if (!handles) return;
  if (handles.sync) {
    try { handles.sync.stop(); } catch { /* noop */ }
    handles.sync = null;
  }
  if (handles.financeSync) {
    try { handles.financeSync.stop(); } catch { /* noop */ }
    handles.financeSync = null;
  }
  if (handles.researchOrchestrator) {
    // Tear down the listener + 60s flush timer on sign-out. A subsequent
    // sign-in re-boots it via attachSync() with the new session's user id.
    try { handles.researchOrchestrator.teardown(); } catch { /* noop */ }
    handles.researchOrchestrator = null;
  }
}

/**
 * Test-only — drop the singleton so a fresh bootAccount() runs clean.
 * Tears down the research orchestrator's listener + flush timer first so it
 * doesn't leak the @ollie/events subscription across test cases.
 */
export function _resetAccountBoot(): void {
  if (handles?.researchOrchestrator) {
    try { handles.researchOrchestrator.teardown(); } catch { /* noop */ }
  }
  if (handles?.sync) {
    try { handles.sync.stop(); } catch { /* noop */ }
  }
  if (handles?.financeSync) {
    try { handles.financeSync.stop(); } catch { /* noop */ }
  }
  telemetryUnsubs.splice(0).forEach((fn) => { try { fn(); } catch { /* noop */ } });
  handles = null;
  bootOverrides = {};
}
