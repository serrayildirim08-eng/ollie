/**
 * @ollie/research-stream · foundation (C7 revised)
 *
 * B2B research data layer — PHYSICALLY ISOLATED from user data.
 * Anonymous, opt-in, GDPR-compliant. The product side (rigid schema,
 * k-anonymity bucketing, week / amount / merchant specifics) is
 * deferred until the B2B product is designed.
 *
 * What ships now (foundation):
 *   - master gate: the canonical @ollie/consent `necessary` flag (default
 *     off — written true by ConsentScreen at sign-up). Görev 1 (2026-05-15):
 *     this used to read the raw `shared.consent.necessary` key directly;
 *     it now goes through @ollie/consent's `hasNecessaryConsent()` so there
 *     is a single source of truth for consent. `necessary` gates STRUCTURED
 *     telemetry (session/module/retention/consent_audit rows) — the
 *     free-text research-corpus pipeline has its own `research_optin` gate
 *     in @ollie/orchestrator/research.ts.
 *   - flexible JSON event capture: track(type, payload)
 *   - random_uuid per device (NO link to user_id, email, anything)
 *   - GDPR endpoints: exportContributions(), deleteContributions(),
 *     withdrawConsent()
 *   - send to a separate research API endpoint (configured externally
 *     so the prod Supabase project never sees it)
 *
 * Constitutional:
 *   - off by default. ON requires an explicit, informed toggle.
 *   - withdraw consent → flush nothing further, ever.
 *   - the random_uuid here is NOT the user_id. It's per-device,
 *     deletable, and not joinable to any account.
 *   - this package has NO access to @ollie/auth or @ollie/crypto.
 *     it must not see the encryption key or the email.
 */

import type { Store } from '@ollie/store';
import type { OllieAPI } from '@ollie/api';
import * as events from '@ollie/events';
import {
  hasNecessaryConsent,
  setNecessaryConsentSync,
} from '@ollie/consent';

const QUEUE_CAP = 5_000;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

export interface ResearchEvent {
  /** Anonymous device id — UUID v4, no link to user. */
  device_id: string;
  /** Free-form event type. UI-stable names; B2B schema will rigidify later. */
  type: string;
  /** Wall-clock ts in ms. Stripped to nearest minute by toJSON to avoid fingerprinting. */
  ts: number;
  /** Flexible payload bag. Caller responsibility to omit PII; we do not introspect. */
  payload: Record<string, unknown>;
}

export interface ResearchDeps {
  store: Store;
  api: OllieAPI;
  /** Endpoint URL of the research API. Distinct project from user data. */
  endpointUrl?: string;
  /** Bearer token if the research API requires one. */
  bearerToken?: string;
  /**
   * Optional URL of the ollie-ai-proxy worker. When set, trackTable()
   * POSTs `{table,row}` directly to `${ingestUrl}/ingest-event`. When
   * omitted, trackTable() is a silent no-op (consent gated either way).
   */
  ingestUrl?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  now?: () => number;
  /** Pluggable connectivity check. Default navigator.onLine. */
  isOnline?: () => boolean;
  /**
   * Supplies the Supabase user JWT for the `/ingest-event` worker call.
   * The ai-proxy worker requires `Authorization: Bearer <jwt>` on that
   * endpoint. This package deliberately has NO access to @ollie/auth, so
   * the bearer string is handed IN by the constructing caller (account-boot)
   * rather than read here. The JWT is an opaque auth credential — NOT the
   * encryption key or email — so passing it via deps respects the isolation
   * rule. When omitted or returning null, trackTable() no-ops.
   */
  getJwt?: () => string | null;
}

export interface ResearchClient {
  /**
   * Capture an event. No-op (returns immediately) when consent is off.
   * Caller-tolerant — never throws on offline / queue full.
   */
  track(type: string, payload?: Record<string, unknown>): void;
  /**
   * Server-shaped capture. Fire-and-forget POSTs `{table,row}` to the
   * ollie-ai-proxy worker's `/ingest-event` endpoint. No-op when consent
   * is off OR `ingestUrl` was not configured. Never throws.
   *
   * Used by retention.ts (D1/D7), session/module event hooks, and the
   * consent-audit writer. The legacy `track()` queue stays for any future
   * batch-shaped use cases.
   */
  trackTable(table: string, row: Record<string, unknown>): void;
  /** Manually flush the queue once. */
  flush(): Promise<void>;
  /** Start the background flush loop. */
  start(): void;
  /** Stop the background flush loop. Idempotent. */
  stop(): void;
  /** GDPR — return everything we have locally queued for this device. */
  exportContributions(): ResearchEvent[];
  /** GDPR — delete queued contributions locally AND remote (within 30d). */
  deleteContributions(): Promise<void>;
  /** GDPR — withdraw consent. Future track() calls become no-ops. */
  withdrawConsent(): void;
  /** Opt in. Generates the device_id if missing. */
  grantConsent(): void;
  /** Current consent state. */
  hasConsent(): boolean;
  /** Read-only — for tests / debug. */
  _inspect(): { queueDepth: number; deviceId: string | null; running: boolean };
}

const DEVICE_ID_KEY = '_research_device_id';
const QUEUE_KEY = '_research_queue';

/**
 * Görev 1 (2026-05-15): research-stream's GDPR withdrawal flag.
 *
 * Pre-consolidation `withdrawConsent()` flipped `shared.consent.necessary`
 * to false to disable the stream. That key is now the canonical app-master
 * gate and `necessary` is structurally non-false (the app cannot run
 * without it). So GDPR research-contribution withdrawal gets its OWN local
 * flag here. `hasConsent()` = canonical necessary AND not-withdrawn.
 *
 * Default (unset) means "not withdrawn" → `hasConsent()` follows `necessary`
 * exactly, which is the production behaviour: withdrawConsent()/grantConsent()
 * are GDPR-surface methods that production code never calls.
 */
const RESEARCH_OPTOUT_KEY = '_research_withdrawn';

export function createResearchStream(deps: ResearchDeps): ResearchClient {
  const nowFn = deps.now ?? (() => Date.now());
  const isOnlineFn = deps.isOnline ?? (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis;
    return typeof g.navigator?.onLine === 'boolean' ? g.navigator.onLine : true;
  });
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function readQueue(): ResearchEvent[] {
    return deps.store.get<ResearchEvent[]>('shared', QUEUE_KEY, []) ?? [];
  }
  function writeQueue(q: ResearchEvent[]): void {
    deps.store.set('shared', QUEUE_KEY, q.slice(-QUEUE_CAP));
  }
  function hasConsent(): boolean {
    // Single source of truth: the canonical @ollie/consent `necessary`
    // flag, read synchronously off the store. hasNecessaryConsent() lazily
    // migrates the legacy `shared.consent.necessary` key for returning
    // users, so a pre-consolidation install keeps working unchanged.
    //
    // AND not GDPR-withdrawn — withdrawConsent() sets the local flag below.
    if (deps.store.get<boolean>('shared', RESEARCH_OPTOUT_KEY, false)) return false;
    return hasNecessaryConsent(deps.store);
  }
  function deviceId(): string | null {
    return deps.store.get<string | null>('shared', DEVICE_ID_KEY, null);
  }
  function ensureDeviceId(): string {
    let id = deviceId();
    if (!id) {
      id = randomUuid();
      deps.store.set('shared', DEVICE_ID_KEY, id);
    }
    return id;
  }

  function track(type: string, payload: Record<string, unknown> = {}): void {
    if (!hasConsent()) return;
    if (!type || typeof type !== 'string') return;
    const id = ensureDeviceId();
    const event: ResearchEvent = {
      device_id: id,
      type,
      ts: roundToMinute(nowFn()),
      payload,
    };
    const q = readQueue();
    q.push(event);
    writeQueue(q);
    try { events.emit('research:event_queued', { event_id: `${event.device_id}:${event.ts}:${event.type}`, ts: nowFn() }); }
    catch { /* registry warn ok */ }
  }

  function trackTable(table: string, row: Record<string, unknown>): void {
    if (!hasConsent()) return;
    if (!deps.ingestUrl) return;
    if (!table || typeof table !== 'string') return;
    if (!row || typeof row !== 'object') return;
    // The /ingest-event worker endpoint requires a verified Supabase JWT.
    // No token → no-op (an unauthenticated POST would only 401, and this
    // path is best-effort / consent-gated).
    const jwt = deps.getJwt?.() ?? null;
    if (!jwt) return;
    const url = `${deps.ingestUrl.replace(/\/$/, '')}/ingest-event`;
    const f = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!f) return;
    // Fire-and-forget. We swallow promise rejections so a transient worker
    // failure never bubbles up into UI code that called us synchronously.
    try {
      void f(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ table, row }),
      }).catch(() => { /* best-effort */ });
    } catch {
      /* best-effort */
    }
  }

  async function flush(): Promise<void> {
    if (!hasConsent()) return;
    if (!deps.endpointUrl) return;
    if (!isOnlineFn()) return;
    const q = readQueue();
    if (q.length === 0) return;
    const batch = q.slice(0, 500); // ship in batches
    const r = await deps.api.request<{ ok: boolean }>(
      'POST',
      deps.endpointUrl,
      {
        body: { events: batch },
        headers: deps.bearerToken ? { authorization: `Bearer ${deps.bearerToken}` } : {},
        // Research is non-critical: never retry aggressively.
        retry: { max: 1, baseDelayMs: 500 },
        timeoutMs: 8_000,
      },
    );
    if (r.ok) {
      writeQueue(q.slice(batch.length));
      try { events.emit('research:flush_succeeded', { count: batch.length, ts: nowFn() }); }
      catch { /* registry warn ok */ }
    } else {
      try { events.emit('research:flush_failed', { count: batch.length, reason: r.error.code, ts: nowFn() }); }
      catch { /* registry warn ok */ }
    }
  }

  function scheduleFlush(): void {
    if (!running) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      try { await flush(); } catch (err) { console.warn('[research] flush failed', err); }
      scheduleFlush();
    }, DEFAULT_FLUSH_INTERVAL_MS);
  }

  function start(): void {
    if (running) return;
    running = true;
    scheduleFlush();
  }

  function stop(): void {
    running = false;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  function exportContributions(): ResearchEvent[] {
    return [...readQueue()];
  }

  async function deleteContributions(): Promise<void> {
    const id = deviceId();
    writeQueue([]);
    if (id && deps.endpointUrl) {
      try {
        await deps.api.request('DELETE', `${deps.endpointUrl}/by-device/${id}`, {
          headers: deps.bearerToken ? { authorization: `Bearer ${deps.bearerToken}` } : {},
          retry: { max: 2, baseDelayMs: 1_000 },
        });
      } catch (err) {
        console.warn('[research] remote delete failed (local cleared)', err);
      }
    }
  }

  function withdrawConsent(): void {
    // GDPR withdrawal of the RESEARCH-STREAM contribution: flush nothing
    // further, drop the queue, sever the device id, raise the local
    // withdrawal flag so hasConsent() reads false. We deliberately do NOT
    // flip the canonical `necessary` flag — its type forbids `false` and
    // `necessary` off means the app cannot run at all. Account deletion is
    // the path to revoke `necessary`.
    deps.store.set('shared', RESEARCH_OPTOUT_KEY, true);
    writeQueue([]);
    deps.store.set('shared', DEVICE_ID_KEY, null);
    stop();
  }

  function grantConsent(): void {
    // Clear any prior GDPR withdrawal and persist the master `necessary`
    // flag through the canonical writer so the consent.state row is the
    // one and only record.
    deps.store.set('shared', RESEARCH_OPTOUT_KEY, false);
    setNecessaryConsentSync(deps.store);
    ensureDeviceId();
    if (running) scheduleFlush();
  }

  return {
    track,
    trackTable,
    flush,
    start,
    stop,
    exportContributions,
    deleteContributions,
    withdrawConsent,
    grantConsent,
    hasConsent,
    _inspect: () => ({ queueDepth: readQueue().length, deviceId: deviceId(), running }),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function roundToMinute(ts: number): number {
  return Math.floor(ts / 60_000) * 60_000;
}

function randomUuid(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID() as string;
  // Fallback (Node 20 has randomUUID; this is just for completeness)
  const bytes = new Uint8Array(16);
  g.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
