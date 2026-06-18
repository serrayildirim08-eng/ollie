/**
 * @ollie/sync · encrypted multidevice sync (C3)
 *
 * Subscribes to store changes per module, debounces 300ms, encrypts
 * the per-module slice via @ollie/crypto, and upserts to the Supabase
 * encrypted_state table via @ollie/api. Pulls all rows on boot,
 * decrypts, and writes back to the store using LWW.
 *
 * Constitutional (Sprint B' pivot 2026-05-14):
 *   - opt-out encrypted sync (this file) is retained as the opt-out path;
 *     opt-in users route through the research pipeline instead (see
 *     `@ollie/orchestrator/research`, which sends scrubbed text to /label).
 *     The original blanket "server never sees plaintext" default is gone.
 *   - sync is opt-in (shared.settings.sync_enabled default false)
 *   - offline queue caps at 10k entries; reconnect drains it
 *   - toggle off → zero network calls
 *
 * Finance note (Sprint 5):
 *   The 'finance' module remains in DEFAULT_MODULES below for backwards
 *   compatibility (settings, cancellations, dismissed-id bookkeeping
 *   still ride this path). Per-record finance state — bills,
 *   subscriptions, adhd_tax entries, transactions, savings goals, raw
 *   records — also syncs via the per-record finance_records table; see
 *   ./finance.ts and createFinanceSyncClient. The two paths coexist;
 *   the per-record path is authoritative on a fresh device because it
 *   pulls first via syncIn() and uses LWW per-record reconciliation.
 */

import type { Store } from '@ollie/store';
import * as events from '@ollie/events';
import type { OllieAPI } from '@ollie/api';
import { bytesToPgHex, pgHexToBytes, encryptData, decryptData } from '@ollie/crypto';
import type { EncryptedPayload } from '@ollie/crypto';
import { createDebouncer, createBackoffScheduler } from './retry';

const DEBOUNCE_MS = 300;
const QUEUE_CAP = 10_000;

export interface SyncSettings {
  enabled: boolean;
}

export interface RemoteRow {
  id: string;
  user_id: string;
  module: string;
  ciphertext: string;   // Postgres bytea hex (\x+hex) on the wire
  iv: string;           // Postgres bytea hex (\x+hex) on the wire
  updated_at: string;   // ISO
  device_id?: string;
  blob_version: number;
}

export interface SyncDeps {
  store: Store;
  api: OllieAPI;
  /** Authenticated user id (Supabase user.id uuid). */
  userId: string;
  /** Fresh JWT — refresh externally and update via setAuthJwt(). */
  authJwt: string;
  /** Derived encryption key (lives in memory only). */
  encryptionKey: CryptoKey;
  /** Modules to sync. Default: a sensible set. */
  modules?: string[];
  /** Optional device identifier for diagnostics. */
  deviceId?: string;
  /** Injected timers + clock for tests. */
  now?: () => number;
  /** Pluggable connectivity check. Default: navigator.onLine. */
  isOnline?: () => boolean;
}

interface QueueEntry {
  /** Monotonic per-enqueue id (audit #118). The previous dedupe key was
   *  (module, updated_at), which is NOT unique: two writes for the same
   *  module in the same millisecond produced identical keys, so removing
   *  "shipped" entries by that key could drop a newer un-shipped entry.
   *  A strictly increasing seq gives every enqueue a unique identity, so
   *  drain removes exactly the entries it shipped — no newer same-ms write
   *  is ever silently dropped. (It also replaces the NUL-separated string
   *  key that made git treat this file as binary.) */
  seq: number;
  module: string;
  row: {
    id?: string;
    user_id: string;
    module: string;
    ciphertext: string;
    iv: string;
    updated_at: string;
    device_id?: string;
    blob_version: number;
  };
}

const DEFAULT_MODULES = [
  'cycle', 'finance', 'grocery', 'pets', 'sleep', 'body', 'habits', 'work',
  'goals', 'admin', 'astrology', 'dump', 'journal', 'burhan', 'medication',
  'shared',
];

/**
 * Top-level store module that holds SYNC-INTERNAL bookkeeping (audit #120):
 * the outbound queue (`queue`) + per-module LWW watermarks (`local_ts.<mod>`).
 * These were previously keys under the user-facing `shared` module, where two
 * problems compounded:
 *   1. a cross-tab write to a watermark invalidated the WHOLE `shared` module
 *      (the cross-tab filter skips `_`-prefixed MODULES, but these were keys,
 *      not a module — so the `_` filter was dead), and
 *   2. it muddied `shared` with engine state that isn't user data.
 * Namespacing them under a `_`-prefixed module makes the cross-tab `_` filter
 * correctly skip them. NOTE: user-facing `settings.sync` stays under `shared`
 * — it is genuine config, not bookkeeping.
 */
const SYNC_NS = '_sync';

export interface SyncClient {
  /** Subscribe + drain on boot. Returns immediately; pull happens async. */
  start(): Promise<void>;
  /** Unsubscribe all and stop draining. Idempotent. */
  stop(): void;
  /** Manual force-push of all known modules. */
  syncOut(): Promise<void>;
  /** Manual pull-and-apply of all remote rows. */
  syncIn(): Promise<void>;
  /** Hot-swap the auth jwt (after refresh). */
  setAuthJwt(jwt: string): void;
  /** Hot-swap the encryption key (e.g. on relogin). */
  setEncryptionKey(key: CryptoKey): void;
  /** Read-only view of outbound queue for tests/debug. */
  _inspect(): { queueDepth: number; running: boolean };
}

export function createSyncClient(initialDeps: SyncDeps): SyncClient {
  const deps: SyncDeps = { ...initialDeps };
  const nowFn = deps.now ?? (() => Date.now());
  const isOnlineFn = deps.isOnline ?? (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis;
    return typeof g.navigator?.onLine === 'boolean' ? g.navigator.onLine : true;
  });
  const modules = deps.modules ?? DEFAULT_MODULES;
  let running = false;
  let unsubs: Array<() => void> = [];
  // Monotonic enqueue counter (audit #118). Seeded above any seq already
  // sitting in a persisted queue so a reload never re-issues a live seq.
  let seqCounter = 0;
  // Re-entrancy guard (audit #7): modules currently being written BY syncIn.
  // A store write that originates from an inbound apply must NOT enqueue a
  // push (ping-pong) — `subscribe` fires synchronously inside applyModule,
  // so we mark the module before the write and unmark right after.
  const applyingModules = new Set<string>();
  // Per-module debounce + a single backoff-scheduled drain. Both come from
  // the shared ./retry helper — the drain scheduler adds exponential
  // backoff and a max-attempt cap (a forever-failing server stops looping).
  const pushDebouncer = createDebouncer<string>(DEBOUNCE_MS);
  const drainScheduler = createBackoffScheduler(() => drainOnce());

  // ── outbound queue (persisted to store so offline writes survive reload)
  function readQueue(): QueueEntry[] {
    return deps.store.get<QueueEntry[]>(SYNC_NS, 'queue', []) ?? [];
  }
  function writeQueue(q: QueueEntry[]): void {
    deps.store.set(SYNC_NS, 'queue', q.slice(-QUEUE_CAP));
  }
  // Number of DISTINCT modules in the queue — i.e. the count that will
  // actually be shipped after drainOnce()'s coalesce step (audit #120). The
  // raw queue can transiently hold >1 entry per module between enqueues, so
  // readQueue().length over-reports what's pending.
  function coalescedQueueDepth(): number {
    const mods = new Set<string>();
    for (const e of readQueue()) mods.add(e.module);
    return mods.size;
  }
  function nextSeq(): number {
    // Seed past any seq persisted from a prior session before issuing.
    if (seqCounter === 0) {
      for (const e of readQueue()) {
        if (typeof e.seq === 'number' && e.seq > seqCounter) seqCounter = e.seq;
      }
    }
    seqCounter += 1;
    return seqCounter;
  }
  function enqueue(entry: Omit<QueueEntry, 'seq'>): void {
    const q = readQueue();
    // Coalesce by module — only the latest write per module needs to ship.
    const filtered = q.filter((e) => e.module !== entry.module);
    filtered.push({ ...entry, seq: nextSeq() });
    writeQueue(filtered);
  }

  // ── per-module encrypt + enqueue
  async function pushModule(module: string): Promise<void> {
    const settings = deps.store.get<SyncSettings>('shared', 'settings.sync', { enabled: false }) ?? { enabled: false };
    if (!settings.enabled) return;
    // Re-entrancy guard (audit #7): a write made BY syncIn must not bounce
    // back out as a push. (Belt-and-braces — the subscribe handler already
    // skips enqueue while applying, but a debounced push could be scheduled
    // from an earlier real edit and fire mid-apply.)
    if (applyingModules.has(module)) return;

    const payload = deps.store.getModule(module) ?? {};
    const enc: EncryptedPayload = await encryptData(deps.encryptionKey, payload);
    const updatedAt = new Date(nowFn()).toISOString();

    const row = {
      // No client-generated id — Supabase generates one. For idempotent
      // upsert we rely on the (user_id, module) unique constraint.
      user_id: deps.userId,
      module,
      // Postgres `bytea` hex input (`\x`+hex), NOT base64: PostgREST stores
      // string literals verbatim into bytea, so base64 would make the IV 16
      // octets and trip `check (octet_length(iv) = 12)` (audit #1).
      ciphertext: bytesToPgHex(enc.ciphertext),
      iv: bytesToPgHex(enc.iv),
      updated_at: updatedAt,
      device_id: deps.deviceId,
      blob_version: 1,
    };

    enqueue({ module, row });
    scheduleDrain();
  }

  function debouncedPush(module: string): void {
    pushDebouncer.schedule(module, () => {
      void pushModule(module).catch((err) => {
        console.error('[sync] pushModule failed', module, err);
      });
    });
  }

  // ── drain queue (POST to Supabase)
  async function drainOnce(): Promise<void> {
    if (!isOnlineFn()) return;
    const settings = deps.store.get<SyncSettings>('shared', 'settings.sync', { enabled: false }) ?? { enabled: false };
    if (!settings.enabled) return;
    const queue = readQueue();
    if (queue.length === 0) return;

    // Coalesce: keep only the most recent entry per module.
    const lastByModule = new Map<string, QueueEntry>();
    for (const e of queue) lastByModule.set(e.module, e);
    const batch = Array.from(lastByModule.values());

    const rows = batch.map((e) => e.row);
    // Stable identity for each shipped entry: its monotonic enqueue seq
    // (audit #118). We CANNOT use object identity — readQueue() JSON-reparses
    // the store value, so the post-upsert re-read returns fresh object
    // instances and an `e !== …` check would never match (audit item #16:
    // the queue grew unboundedly and re-shipped forever). The PREVIOUS fix
    // keyed on `${module}<NUL>${updated_at}`, but (module, updated_at) is NOT
    // unique — two writes for one module in the same millisecond collide, so
    // removing "shipped" could drop a newer un-shipped entry; and the NUL
    // separator made git treat this file as binary. The seq is strictly
    // unique per enqueue: a NEW write that lands DURING the in-flight upsert
    // gets a higher seq, so it is NOT in shippedSeqs and is correctly kept.
    const shippedSeqs = new Set(batch.map((e) => e.seq));
    const r = await deps.api.supabase.rest.upsert<RemoteRow[]>('encrypted_state', rows, {
      authJwt: deps.authJwt,
      // #23: explicit conflict target so PostgREST UPDATEs on (user_id,module) instead of 409-looping
      params: { on_conflict: 'user_id,module' },
    });
    if (r.ok) {
      // Success → clear the failure counter so backoff starts fresh.
      drainScheduler.reset();
      // Remove ONLY the exact entries we shipped — match on the unique seq,
      // never object identity nor the non-unique (module, updated_at) key.
      writeQueue(
        readQueue().filter((e) => !shippedSeqs.has(e.seq)),
      );
      try {
        events.emit('sync:outbound_flushed', { count: rows.length, ts: nowFn() });
      } catch { /* registry warn ok */ }
    } else {
      if (r.error.code === 'unauthorized') {
        try { events.emit('sync:auth_expired', { ts: nowFn() }); }
        catch { /* registry warn ok */ }
      } else {
        // Retry with exponential backoff. Once the attempt cap is hit the
        // scheduler stops — the queue is left intact for the next push.
        drainScheduler.scheduleRetry();
      }
    }
  }

  function scheduleDrain(delayMs = 0): void {
    drainScheduler.schedule(delayMs);
  }

  // ── inbound pull + apply
  async function syncIn(): Promise<void> {
    const settings = deps.store.get<SyncSettings>('shared', 'settings.sync', { enabled: false }) ?? { enabled: false };
    if (!settings.enabled) return;
    const r = await deps.api.supabase.rest.get<RemoteRow[]>('encrypted_state', {
      authJwt: deps.authJwt,
      params: { user_id: `eq.${deps.userId}` },
    });
    if (!r.ok) return;
    for (const row of r.data ?? []) {
      try {
        // LWW: skip remote if our local module was edited after row.updated_at.
        const localTs = deps.store.get<number>(SYNC_NS, `local_ts.${row.module}`, 0) ?? 0;
        const remoteTs = Date.parse(row.updated_at);
        if (Number.isFinite(remoteTs) && remoteTs <= localTs) continue;

        const ciphertext = pgHexToBytes(row.ciphertext);
        const iv = pgHexToBytes(row.iv);
        const data = await decryptData<Record<string, unknown>>(deps.encryptionKey, { ciphertext, iv });
        // Suppress the push that the subscribe handler would otherwise fire
        // for this write (audit #7). setModule fires subscribers synchronously,
        // so marking before and clearing after fully brackets the apply.
        applyingModules.add(row.module);
        try {
          applyModule(deps.store, row.module, data);
        } finally {
          applyingModules.delete(row.module);
        }
        // Watermark = the applied REMOTE ts (audit #7), not nowFn(). Set after
        // the apply so a same-module re-pull is LWW-skipped correctly.
        deps.store.set(SYNC_NS, `local_ts.${row.module}`, remoteTs);
      } catch (err) {
        console.warn('[sync] decrypt failed for module', row.module, err);
      }
    }
    try {
      events.emit('sync:inbound_applied', { ts: nowFn() });
    } catch { /* registry warn ok */ }
  }

  async function syncOut(): Promise<void> {
    for (const m of modules) await pushModule(m);
    await drainOnce();
  }

  // ── store subscriptions
  function start(): Promise<void> {
    if (running) return Promise.resolve();
    running = true;
    for (const m of modules) {
      // Subscribe by module — every key change inside that module re-pushes.
      const unsub = deps.store.subscribe(m, () => {
        // Re-entrancy guard (audit #7): the write that just fired came from
        // syncIn applying an inbound row. Do NOT record a local edit ts (the
        // watermark is set to the remote ts inside syncIn) and do NOT enqueue
        // a push — otherwise every inbound apply echoes straight back out
        // (ping-pong) and clobbers the LWW watermark with nowFn().
        if (applyingModules.has(m)) return;
        // Record local edit ts before debounce — drives LWW.
        deps.store.set(SYNC_NS, `local_ts.${m}`, nowFn());
        debouncedPush(m);
      });
      unsubs.push(unsub);
    }
    // online → drain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis;
    if (typeof g.addEventListener === 'function') {
      const onOnline = () => scheduleDrain();
      g.addEventListener('online', onOnline);
      unsubs.push(() => g.removeEventListener('online', onOnline));
    }
    // Initial drain attempt
    scheduleDrain();
    return syncIn().catch((err) => console.warn('[sync] initial syncIn failed', err));
  }

  function stop(): void {
    for (const u of unsubs) { try { u(); } catch { /* noop */ } }
    unsubs = [];
    pushDebouncer.cancelAll();
    drainScheduler.cancel();
    drainScheduler.reset();
    running = false;
  }

  return {
    start,
    stop,
    syncOut,
    syncIn,
    setAuthJwt(jwt) { deps.authJwt = jwt; },
    setEncryptionKey(key) { deps.encryptionKey = key; },
    _inspect() { return { queueDepth: coalescedQueueDepth(), running }; },
  };
}

function applyModule(store: Store, module: string, data: Record<string, unknown>): void {
  // setModule replaces the entire module slice atomically — exactly what
  // LWW reconciliation needs.
  store.setModule(module, data ?? {});
}

// Re-export the per-record finance sync. Boot code in apps/web/src/lib/
// account-boot.ts should call createFinanceSyncClient(...).start() in
// addition to createSyncClient(...).start() so finance gets both the
// module-blob settings path and the per-record delta-sync path.
export {
  createFinanceSyncClient,
  FINANCE_RECORD_STORE_KEYS,
} from './finance';
export type {
  FinanceSyncClient,
  FinanceSyncDeps,
  FinanceRecordType,
  SyncableFinanceRow,
  RemoteFinanceRow,
} from './finance';
