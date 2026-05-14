/**
 * @ollie/research-stream · foundation (C7 revised)
 *
 * B2B research data layer — PHYSICALLY ISOLATED from user data.
 * Anonymous, opt-in, GDPR-compliant. The product side (rigid schema,
 * k-anonymity bucketing, week / amount / merchant specifics) is
 * deferred until the B2B product is designed.
 *
 * What ships now (foundation):
 *   - opt-in toggle: shared.consent.necessary (default off — written
 *     true by ConsentScreen at sign-up; this is the master gate that
 *     replaced the older per-feature consent.spending_research key)
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

const CONSENT_KEY = 'consent.necessary';
const DEVICE_ID_KEY = '_research_device_id';
const QUEUE_KEY = '_research_queue';

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
    return Boolean(deps.store.get<boolean>('shared', CONSENT_KEY, false));
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
    const url = `${deps.ingestUrl.replace(/\/$/, '')}/ingest-event`;
    const f = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!f) return;
    // Fire-and-forget. We swallow promise rejections so a transient worker
    // failure never bubbles up into UI code that called us synchronously.
    try {
      void f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
    deps.store.set('shared', CONSENT_KEY, false);
    writeQueue([]);
    deps.store.set('shared', DEVICE_ID_KEY, null);
    stop();
  }

  function grantConsent(): void {
    deps.store.set('shared', CONSENT_KEY, true);
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
