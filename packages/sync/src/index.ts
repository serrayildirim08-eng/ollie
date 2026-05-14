/**
 * @ollie/sync · encrypted multidevice sync (C3)
 *
 * Subscribes to store changes per module, debounces 300ms, encrypts
 * the per-module slice via @ollie/crypto, and upserts to the Supabase
 * encrypted_state table via @ollie/api. Pulls all rows on boot,
 * decrypts, and writes back to the store using LWW.
 *
 * Constitutional:
 *   - server never sees plaintext (zero-knowledge)
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
import { bytesToBase64, base64ToBytes, encryptData, decryptData } from '@ollie/crypto';
import type { EncryptedPayload } from '@ollie/crypto';

const DEBOUNCE_MS = 300;
const QUEUE_CAP = 10_000;

export interface SyncSettings {
  enabled: boolean;
}

export interface RemoteRow {
  id: string;
  user_id: string;
  module: string;
  ciphertext: string;   // base64
  iv: string;           // base64
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
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let drainTimer: ReturnType<typeof setTimeout> | null = null;

  // ── outbound queue (persisted to store so offline writes survive reload)
  function readQueue(): QueueEntry[] {
    return deps.store.get<QueueEntry[]>('shared', '_sync_queue', []) ?? [];
  }
  function writeQueue(q: QueueEntry[]): void {
    deps.store.set('shared', '_sync_queue', q.slice(-QUEUE_CAP));
  }
  function enqueue(entry: QueueEntry): void {
    const q = readQueue();
    // Coalesce by module — only the latest write per module needs to ship.
    const filtered = q.filter((e) => e.module !== entry.module);
    filtered.push(entry);
    writeQueue(filtered);
  }

  // ── per-module encrypt + enqueue
  async function pushModule(module: string): Promise<void> {
    const settings = deps.store.get<SyncSettings>('shared', 'settings.sync', { enabled: false }) ?? { enabled: false };
    if (!settings.enabled) return;

    const payload = deps.store.getModule(module) ?? {};
    const enc: EncryptedPayload = await encryptData(deps.encryptionKey, payload);
    const updatedAt = new Date(nowFn()).toISOString();

    const row = {
      // No client-generated id — Supabase generates one. For idempotent
      // upsert we rely on the (user_id, module) unique constraint.
      user_id: deps.userId,
      module,
      ciphertext: bytesToBase64(enc.ciphertext),
      iv: bytesToBase64(enc.iv),
      updated_at: updatedAt,
      device_id: deps.deviceId,
      blob_version: 1,
    };

    enqueue({ module, row });
    scheduleDrain();
  }

  function debouncedPush(module: string): void {
    const existing = debounceTimers.get(module);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      debounceTimers.delete(module);
      void pushModule(module).catch((err) => {
        console.error('[sync] pushModule failed', module, err);
      });
    }, DEBOUNCE_MS);
    debounceTimers.set(module, t);
  }

  // ── drain queue (POST to Supabase)
  async function drainOnce(): Promise<void> {
    drainTimer = null;
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
    const r = await deps.api.supabase.rest.upsert<RemoteRow[]>('encrypted_state', rows, {
      authJwt: deps.authJwt,
    });
    if (r.ok) {
      // Remove successfully-shipped entries from the queue.
      const shipped = new Set(batch.map((e) => e.module));
      writeQueue(readQueue().filter((e) => !shipped.has(e.module) || e !== lastByModule.get(e.module)));
      try {
        events.emit('sync:outbound_flushed', { count: rows.length, ts: nowFn() });
      } catch { /* registry warn ok */ }
    } else {
      if (r.error.code === 'unauthorized') {
        try { events.emit('sync:auth_expired', { ts: nowFn() }); }
        catch { /* registry warn ok */ }
      } else {
        // Retry: leave queue intact, schedule another drain attempt.
        scheduleDrain(2_000);
      }
    }
  }

  function scheduleDrain(delayMs = 0): void {
    if (drainTimer) return;
    drainTimer = setTimeout(() => {
      void drainOnce().catch((err) => {
        console.error('[sync] drainOnce failed', err);
        drainTimer = null;
        scheduleDrain(5_000);
      });
    }, delayMs);
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
        const localTs = deps.store.get<number>('shared', `_sync_local_ts.${row.module}`, 0) ?? 0;
        const remoteTs = Date.parse(row.updated_at);
        if (Number.isFinite(remoteTs) && remoteTs <= localTs) continue;

        const ciphertext = base64ToBytes(row.ciphertext);
        const iv = base64ToBytes(row.iv);
        const data = await decryptData<Record<string, unknown>>(deps.encryptionKey, { ciphertext, iv });
        applyModule(deps.store, row.module, data);
        deps.store.set('shared', `_sync_local_ts.${row.module}`, remoteTs);
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
        // Record local edit ts before debounce — drives LWW.
        deps.store.set('shared', `_sync_local_ts.${m}`, nowFn());
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
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    running = false;
  }

  return {
    start,
    stop,
    syncOut,
    syncIn,
    setAuthJwt(jwt) { deps.authJwt = jwt; },
    setEncryptionKey(key) { deps.encryptionKey = key; },
    _inspect() { return { queueDepth: readQueue().length, running }; },
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

// Plaid inbox drain — see ./plaid-drain.ts for full architecture +
// plaintext-lifetime audit. Boot wiring (setInterval) is deliberately
// NOT done here; account-boot.ts will pick this up once the
// VITE_PLAID_SYNC_WORKER_URL env var is stable.
export {
  drainPlaidInbox,
  validateDrainedRow,
} from './plaid-drain';
export type {
  PlaidDrainDeps,
  PlaidDrainResult,
  PlaidDrainError,
  PlaidDrainResponse,
  PlaidInboxDrainedRow,
} from './plaid-drain';
