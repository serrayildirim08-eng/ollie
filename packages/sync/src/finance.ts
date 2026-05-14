/**
 * @ollie/sync · finance per-record encrypted sync
 *
 * Sprint 5 · companion to the module-blob sync in ./index.ts.
 *
 * Why a separate path?
 *   The module-blob sync ships ONE encrypted blob per module on every
 *   change. Finance can hold thousands of records; a 500KB blob upload
 *   on every record edit is wrong. Finance instead syncs row-per-record
 *   against `finance_records` (see supabase/migrations/…_finance_records.sql),
 *   keyed on a stable client-generated uuid id, with a per-row IV and
 *   ciphertext. Delta sync uses updated_at as cursor.
 *
 * Architectural decisions (locked):
 *   1. Union table with record_type discriminator (server side).
 *   2. Same root encryption key as other modules (auth.encryptionKey()).
 *   3. Whole-record blob inside ciphertext — server never sees fields.
 *
 * Constitutional:
 *   - server NEVER sees plaintext finance data
 *   - sync gated on shared.settings.sync.enabled (= opt-in)
 *   - consent gated on shared.consent.necessary (necessary off = app
 *     does not work, so this should never block in practice — but we
 *     guard anyway because defense in depth is free)
 *   - LWW per-record via updated_at; ties broken server-side by the
 *     before-insert/update trigger that clamps updated_at >= now()
 *   - decryption failures fail-closed: skip the row, warn, never write
 *     partial / garbage state into the store
 */

import type { Store } from '@ollie/store';
import type { OllieAPI } from '@ollie/api';
import * as events from '@ollie/events';
import {
  bytesToBase64,
  base64ToBytes,
  encryptData,
  decryptData,
} from '@ollie/crypto';
import type { EncryptedPayload } from '@ollie/crypto';

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

/**
 * Five record_type buckets accepted by the finance_records CHECK
 * constraint. Mirror this list when extending the schema.
 */
export type FinanceRecordType =
  | 'bill'
  | 'subscription'
  | 'adhd_tax'
  | 'savings_goal'
  | 'transaction';

/**
 * Minimum shape we require on every finance row to sync it. The
 * concrete @ollie/logic/finance FinanceRecord type is a superset of
 * this — we keep the sync-side shape intentionally lax so adding
 * fields to FinanceRecord does not force a sync-package update.
 */
export interface SyncableFinanceRow {
  id?: string;
  last_edited_at?: number;
  created_at?: number;
  // tombstone marker — when true, the row is deleted on next push.
  _deleted?: boolean;
  [k: string]: unknown;
}

/**
 * Store key → record_type mapping. The four "stored" keys in the
 * FinanceModule client (bills/subscriptions/adhd_tax/transactions)
 * plus `records` (the raw ingested FinanceRecord[]) and `goals`
 * (savings_goal). Anything not listed here remains on the module-blob
 * path (settings, derived data, cancellations, dismissed-id bookkeeping).
 */
export const FINANCE_RECORD_STORE_KEYS: Record<string, FinanceRecordType> = {
  bills: 'bill',
  subscriptions: 'subscription',
  adhd_tax: 'adhd_tax',
  transactions: 'transaction',
  goals: 'savings_goal',
  // `records` is the raw FinanceRecord[] — we route to 'transaction'
  // since FinanceRecord.kind is heterogeneous and `transaction` is the
  // catch-all bucket on the server side. (FinanceRecord.kind is preserved
  // inside the ciphertext for client-side reconstruction.)
  records: 'transaction',
};

export interface RemoteFinanceRow {
  id: string;
  user_id: string;
  module: 'finance';
  record_type: FinanceRecordType;
  encrypted_payload: string; // base64
  iv: string;                // base64
  blob_version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  device_id?: string | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const TABLE = 'finance_records';
const CURSOR_KEY = '_sync_finance_cursor';
const QUEUE_KEY = '_sync_finance_queue';
const DEBOUNCE_MS = 300;
const QUEUE_CAP = 10_000;
const PAGE_LIMIT = 500;

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers — pure, exported for tests
// ──────────────────────────────────────────────────────────────────────────

interface QueuedPush {
  id: string;
  record_type: FinanceRecordType;
  /** Encrypted payload (base64). For tombstones we still ship an
   *  encrypted empty-object blob so the server-side row shape is
   *  uniform. */
  encrypted_payload: string;
  iv: string;
  deleted: boolean;
  /** Client-supplied LWW timestamp (ms). Server may clamp upward. */
  updated_at_ms: number;
}

interface QueuedDelete {
  id: string;
  record_type: FinanceRecordType;
  updated_at_ms: number;
}

interface FinanceSyncQueue {
  upserts: QueuedPush[];
  deletes: QueuedDelete[];
}

function emptyQueue(): FinanceSyncQueue {
  return { upserts: [], deletes: [] };
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

export interface FinanceSyncDeps {
  store: Store;
  api: OllieAPI;
  userId: string;
  authJwt: string;
  encryptionKey: CryptoKey;
  /** Injected clock for tests. */
  now?: () => number;
  /** Pluggable connectivity check. Default: navigator.onLine. */
  isOnline?: () => boolean;
  /** Optional device id for diagnostics — never used as a security boundary. */
  deviceId?: string;
}

export interface FinanceSyncClient {
  start(): Promise<void>;
  stop(): void;
  /** Push every dirty in-store record. */
  syncOut(): Promise<void>;
  /** Pull every record updated since the local cursor. */
  syncIn(): Promise<void>;
  /**
   * Encrypt + enqueue a single record for upsert into finance_records.
   *
   * Used by the Plaid inbox drain (see ./plaid-drain.ts) to land
   * webhook-delivered transactions into the user-encrypted store
   * without round-tripping through `store.set('finance', …)`.
   *
   * Errors propagate so the caller can decide whether to ack the
   * staging row.
   *
   * TODO(serra): wire `setInterval(drainPlaidInbox, 60_000)` from
   * account-boot.ts once Plaid env URLs are stable.
   */
  upsertRecord(
    row: SyncableFinanceRow,
    recordType?: FinanceRecordType,
  ): Promise<void>;
  setAuthJwt(jwt: string): void;
  setEncryptionKey(key: CryptoKey): void;
  /** Read-only queue depth + cursor — for tests / debug. */
  _inspect(): { queueDepth: number; cursor: string | null; running: boolean };
}

export function createFinanceSyncClient(initialDeps: FinanceSyncDeps): FinanceSyncClient {
  const deps: FinanceSyncDeps = { ...initialDeps };
  const nowFn = deps.now ?? (() => Date.now());
  const isOnlineFn = deps.isOnline ?? (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis;
    return typeof g.navigator?.onLine === 'boolean' ? g.navigator.onLine : true;
  });

  let running = false;
  let unsubs: Array<() => void> = [];
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  // Local snapshot per store key — used to compute add/update/delete
  // diffs on each subscription tick (the store fires with the new
  // value; we keep the previous to detect deletions).
  const snapshots = new Map<string, Map<string, SyncableFinanceRow>>();

  // ── consent + sync gate ─────────────────────────────────────────────────
  function isEnabled(): boolean {
    const sync = deps.store.get<{ enabled?: boolean }>('shared', 'settings.sync', { enabled: false }) ?? { enabled: false };
    if (!sync.enabled) return false;
    // Defense in depth: respect the master consent toggle even though
    // "necessary off" means the app does not work at all (consent screen
    // blocks sign-up). If somehow the toggle reads false here, we no-op.
    const consent = deps.store.get<boolean>('shared', 'consent.necessary', false) ?? false;
    if (!consent) return false;
    return true;
  }

  // ── queue persistence ──────────────────────────────────────────────────
  function readQueue(): FinanceSyncQueue {
    return deps.store.get<FinanceSyncQueue>('shared', QUEUE_KEY, emptyQueue()) ?? emptyQueue();
  }
  function writeQueue(q: FinanceSyncQueue): void {
    // Cap by id-coalesce: keep only the latest entry per (kind, id).
    const lastUpsert = new Map<string, QueuedPush>();
    for (const u of q.upserts) lastUpsert.set(`u:${u.id}`, u);
    const lastDelete = new Map<string, QueuedDelete>();
    for (const d of q.deletes) lastDelete.set(`d:${d.id}`, d);
    // Cap total at QUEUE_CAP keeping most recent entries.
    const upserts = Array.from(lastUpsert.values()).slice(-QUEUE_CAP);
    const deletes = Array.from(lastDelete.values()).slice(-QUEUE_CAP);
    deps.store.set('shared', QUEUE_KEY, { upserts, deletes });
  }

  // ── cursor (delta-sync watermark) ──────────────────────────────────────
  function readCursor(): string | null {
    return deps.store.get<string | null>('shared', CURSOR_KEY, null) ?? null;
  }
  function writeCursor(iso: string): void {
    deps.store.set('shared', CURSOR_KEY, iso);
  }

  // ── encrypt + enqueue one row ───────────────────────────────────────────
  async function enqueueUpsert(
    row: SyncableFinanceRow,
    recordType: FinanceRecordType,
  ): Promise<void> {
    if (!row.id) return; // unidentified — cannot sync
    const enc: EncryptedPayload = await encryptData(deps.encryptionKey, row);
    const entry: QueuedPush = {
      id: String(row.id),
      record_type: recordType,
      encrypted_payload: bytesToBase64(enc.ciphertext),
      iv: bytesToBase64(enc.iv),
      deleted: row._deleted === true,
      updated_at_ms: typeof row.last_edited_at === 'number' ? row.last_edited_at : nowFn(),
    };
    const q = readQueue();
    q.upserts.push(entry);
    writeQueue(q);
  }

  function enqueueDelete(id: string, recordType: FinanceRecordType): void {
    const q = readQueue();
    q.deletes.push({ id, record_type: recordType, updated_at_ms: nowFn() });
    writeQueue(q);
  }

  // ── diff a store key ────────────────────────────────────────────────────
  // For each (storeKey → recordType), compute (added, updated, deleted) by
  // comparing the current array against the previous snapshot. We encrypt
  // every added/updated row and tombstone every deleted id.
  async function diffAndEnqueue(storeKey: string, recordType: FinanceRecordType): Promise<void> {
    const arr = deps.store.get<SyncableFinanceRow[]>('finance', storeKey, []) ?? [];
    const prev = snapshots.get(storeKey) ?? new Map<string, SyncableFinanceRow>();
    const next = new Map<string, SyncableFinanceRow>();

    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      if (!row.id || typeof row.id !== 'string') continue;
      next.set(row.id, row);
    }

    // adds + updates
    for (const [id, row] of next) {
      const prevRow = prev.get(id);
      if (!prevRow) {
        await enqueueUpsert(row, recordType);
        continue;
      }
      // Re-enqueue only on actual change — cheap structural compare
      // via JSON. For the volumes finance handles client-side
      // (low thousands) this is bounded.
      if (JSON.stringify(prevRow) !== JSON.stringify(row)) {
        await enqueueUpsert(row, recordType);
      }
    }

    // deletes
    for (const id of prev.keys()) {
      if (!next.has(id)) {
        enqueueDelete(id, recordType);
      }
    }

    snapshots.set(storeKey, next);
  }

  function debouncedDiff(storeKey: string, recordType: FinanceRecordType): void {
    const existing = debounceTimers.get(storeKey);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      debounceTimers.delete(storeKey);
      void diffAndEnqueue(storeKey, recordType)
        .then(() => scheduleDrain())
        .catch((err) => {
          console.error('[sync/finance] diffAndEnqueue failed', storeKey, err);
        });
    }, DEBOUNCE_MS);
    debounceTimers.set(storeKey, t);
  }

  // ── drain queue → Supabase ─────────────────────────────────────────────
  async function drainOnce(): Promise<void> {
    drainTimer = null;
    if (!isEnabled()) return;
    if (!isOnlineFn()) return;

    const q = readQueue();
    if (q.upserts.length === 0 && q.deletes.length === 0) return;

    // Upsert all queued rows (server returns the canonical updated_at
    // we use to advance the cursor).
    if (q.upserts.length > 0) {
      const rows = q.upserts.map((u) => ({
        id: u.id,
        user_id: deps.userId,
        module: 'finance' as const,
        record_type: u.record_type,
        // Supabase REST accepts base64 for bytea via the
        // `\x` hex prefix OR base64; we go base64 → \x hex below to
        // match the rest of the codebase (encrypted_state path uses
        // base64 strings on a bytea column too).
        encrypted_payload: u.encrypted_payload,
        iv: u.iv,
        blob_version: 1,
        deleted_at: u.deleted ? new Date(u.updated_at_ms).toISOString() : null,
        updated_at: new Date(u.updated_at_ms).toISOString(),
        device_id: deps.deviceId ?? null,
      }));
      const r = await deps.api.supabase.rest.upsert<RemoteFinanceRow[]>(TABLE, rows, {
        authJwt: deps.authJwt,
      });
      if (!r.ok) {
        if (r.error.code === 'unauthorized') {
          try { events.emit('sync:auth_expired', { ts: nowFn() }); }
          catch { /* registry warn ok */ }
        } else {
          // Leave queue intact, retry with backoff.
          scheduleDrain(2_000);
        }
        return;
      }
      // Clear shipped upserts.
      const next = readQueue();
      const shippedIds = new Set(q.upserts.map((u) => u.id));
      next.upserts = next.upserts.filter((u) => !shippedIds.has(u.id));
      writeQueue(next);
    }

    // Hard deletes — server has tombstones from upsert path above, but
    // we also support hard delete (e.g. GDPR erase per record) via the
    // queued-delete branch. RLS still enforces ownership.
    for (const d of q.deletes) {
      const r = await deps.api.supabase.rest.delete<unknown>(TABLE, {
        authJwt: deps.authJwt,
        params: { id: `eq.${d.id}`, user_id: `eq.${deps.userId}` },
      });
      if (!r.ok) {
        if (r.error.code === 'unauthorized') {
          try { events.emit('sync:auth_expired', { ts: nowFn() }); }
          catch { /* registry warn ok */ }
          return;
        }
        // leave the delete in queue, retry later
        scheduleDrain(2_000);
        return;
      }
    }
    {
      const next = readQueue();
      const shippedIds = new Set(q.deletes.map((d) => d.id));
      next.deletes = next.deletes.filter((d) => !shippedIds.has(d.id));
      writeQueue(next);
    }

    try {
      events.emit('sync:finance_outbound_flushed', {
        upserts: q.upserts.length,
        deletes: q.deletes.length,
        ts: nowFn(),
      });
    } catch { /* registry warn ok */ }
  }

  function scheduleDrain(delayMs = 0): void {
    if (drainTimer) return;
    drainTimer = setTimeout(() => {
      void drainOnce().catch((err) => {
        console.error('[sync/finance] drainOnce failed', err);
        drainTimer = null;
        scheduleDrain(5_000);
      });
    }, delayMs);
  }

  // ── inbound: pull rows updated since cursor, decrypt, apply ────────────
  async function syncIn(): Promise<void> {
    if (!isEnabled()) return;
    const cursor = readCursor();
    const params: Record<string, string> = {
      user_id: `eq.${deps.userId}`,
      order: 'updated_at.asc',
      limit: String(PAGE_LIMIT),
    };
    if (cursor) params.updated_at = `gt.${cursor}`;

    const r = await deps.api.supabase.rest.get<RemoteFinanceRow[]>(TABLE, {
      authJwt: deps.authJwt,
      params,
    });
    if (!r.ok) return;
    const rows = r.data ?? [];
    if (rows.length === 0) return;

    // Group decrypted rows by record_type to map back to store keys.
    const decryptedByType = new Map<FinanceRecordType, SyncableFinanceRow[]>();
    const deletedByType = new Map<FinanceRecordType, Set<string>>();

    let maxUpdatedAt = cursor ?? '';
    for (const row of rows) {
      if (row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at;
      try {
        if (row.deleted_at) {
          const s = deletedByType.get(row.record_type) ?? new Set<string>();
          s.add(row.id);
          deletedByType.set(row.record_type, s);
          continue;
        }
        const ciphertext = base64ToBytes(row.encrypted_payload);
        const iv = base64ToBytes(row.iv);
        const plain = await decryptData<SyncableFinanceRow>(deps.encryptionKey, { ciphertext, iv });
        if (!plain || typeof plain !== 'object') continue;
        // Pin the id from the row — defense against a tampered blob
        // that swaps id under us.
        plain.id = row.id;
        const list = decryptedByType.get(row.record_type) ?? [];
        list.push(plain);
        decryptedByType.set(row.record_type, list);
      } catch (err) {
        // Fail-closed: skip the row, never write garbage to the store.
        console.warn('[sync/finance] decrypt failed for row', row.id, err);
      }
    }

    // Apply per record_type → its store key. Inverse of FINANCE_RECORD_STORE_KEYS.
    const storeKeyByType = new Map<FinanceRecordType, string[]>();
    for (const [storeKey, type] of Object.entries(FINANCE_RECORD_STORE_KEYS)) {
      const list = storeKeyByType.get(type) ?? [];
      list.push(storeKey);
      storeKeyByType.set(type, list);
    }

    for (const [type, rowsForType] of decryptedByType) {
      // record_type=transaction routes to BOTH `records` and `transactions`
      // store keys conceptually, but the canonical write target is
      // `records` (raw FinanceRecord[] driving recompute). `transactions`
      // is the lighter user-entered list. We choose the routing per
      // record's `kind` field if present, else default to `records`.
      const storeKeys = storeKeyByType.get(type) ?? [];
      for (const storeKey of storeKeys) {
        const existing = deps.store.get<SyncableFinanceRow[]>('finance', storeKey, []) ?? [];
        const byId = new Map(existing.filter((r) => r && r.id).map((r) => [r.id as string, r] as const));
        for (const r of rowsForType) {
          // For the 'transaction' bucket, only write the row to a given
          // store key when it matches the canonical mapping — avoids
          // duplicating rows across `records` and `transactions`.
          if (type === 'transaction' && storeKeys.length > 1) {
            const kind = (r as { kind?: string }).kind;
            const goesToRecords = kind !== 'manual_transaction';
            if (storeKey === 'records' && !goesToRecords) continue;
            if (storeKey === 'transactions' && goesToRecords) continue;
          }
          if (!r.id) continue;
          // LWW per-record: compare timestamps if local has one.
          const local = byId.get(r.id);
          const localTs = local?.last_edited_at ?? local?.created_at ?? 0;
          const remoteTs = r.last_edited_at ?? r.created_at ?? 0;
          if (local && typeof localTs === 'number' && typeof remoteTs === 'number' && localTs > remoteTs) {
            continue;
          }
          byId.set(r.id, r);
        }
        const merged = Array.from(byId.values());
        deps.store.set('finance', storeKey, merged);
        // Refresh snapshot so a write triggered by syncIn doesn't bounce
        // back out via the subscriber tick.
        const snap = new Map<string, SyncableFinanceRow>();
        for (const r of merged) if (r.id) snap.set(r.id as string, r);
        snapshots.set(storeKey, snap);
      }
    }

    for (const [type, ids] of deletedByType) {
      const storeKeys = storeKeyByType.get(type) ?? [];
      for (const storeKey of storeKeys) {
        const existing = deps.store.get<SyncableFinanceRow[]>('finance', storeKey, []) ?? [];
        const next = existing.filter((r) => !(r && r.id && ids.has(r.id as string)));
        if (next.length !== existing.length) {
          deps.store.set('finance', storeKey, next);
          const snap = new Map<string, SyncableFinanceRow>();
          for (const r of next) if (r.id) snap.set(r.id as string, r);
          snapshots.set(storeKey, snap);
        }
      }
    }

    if (maxUpdatedAt) writeCursor(maxUpdatedAt);

    try {
      events.emit('sync:finance_inbound_applied', {
        applied: rows.length,
        cursor: maxUpdatedAt,
        ts: nowFn(),
      });
    } catch { /* registry warn ok */ }

    // If we hit the page limit, there are likely more rows — recurse
    // once to drain the rest. Bounded by the cursor advancing.
    if (rows.length >= PAGE_LIMIT) {
      await syncIn();
    }
  }

  // ── outbound: force-push every key ──────────────────────────────────────
  async function syncOut(): Promise<void> {
    if (!isEnabled()) return;
    for (const [storeKey, recordType] of Object.entries(FINANCE_RECORD_STORE_KEYS)) {
      await diffAndEnqueue(storeKey, recordType);
    }
    await drainOnce();
  }

  // ── subscriptions ───────────────────────────────────────────────────────
  function start(): Promise<void> {
    if (running) return Promise.resolve();
    running = true;

    // Seed snapshots from the current store state so the first
    // subscription tick computes a real diff (not "everything is new").
    for (const storeKey of Object.keys(FINANCE_RECORD_STORE_KEYS)) {
      const arr = deps.store.get<SyncableFinanceRow[]>('finance', storeKey, []) ?? [];
      const snap = new Map<string, SyncableFinanceRow>();
      for (const r of arr) if (r && r.id) snap.set(r.id as string, r);
      snapshots.set(storeKey, snap);
    }

    for (const [storeKey, recordType] of Object.entries(FINANCE_RECORD_STORE_KEYS)) {
      const unsub = deps.store.subscribeKey(
        'finance',
        storeKey,
        () => debouncedDiff(storeKey, recordType),
      );
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

    scheduleDrain();
    return syncIn().catch((err) => console.warn('[sync/finance] initial syncIn failed', err));
  }

  function stop(): void {
    for (const u of unsubs) { try { u(); } catch { /* noop */ } }
    unsubs = [];
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    snapshots.clear();
    running = false;
  }

  // ── Public single-record upsert (used by plaid-drain) ─────────────────
  // Encrypt the row with the user's key, enqueue, and request a drain.
  // We deliberately do NOT route through `store.set('finance', …)` for
  // two reasons:
  //   1. The store path piggybacks on the subscriber tick which would
  //      also pull the row into the in-memory FinanceModule arrays
  //      (records[]). That's the right end-state, but the LWW reconcile
  //      via syncIn() on the next page-load handles it cleanly without
  //      the drain having to know the FinanceRecord shape.
  //   2. Keeps the drain free of any store-shape coupling — if the
  //      module store schema changes, the drain still works.
  async function upsertRecord(
    row: SyncableFinanceRow,
    recordType: FinanceRecordType = 'transaction',
  ): Promise<void> {
    if (!isEnabled()) {
      // Sync is opt-out — caller (plaid-drain) should treat this as a
      // hard fail so the staging row is NOT acked. The next session
      // with sync enabled will drain.
      throw new Error('finance sync disabled (consent or settings)');
    }
    if (!row || typeof row !== 'object' || !row.id) {
      throw new Error('upsertRecord: row.id required');
    }
    await enqueueUpsert(row, recordType);
    scheduleDrain();
  }

  return {
    start,
    stop,
    syncOut,
    syncIn,
    upsertRecord,
    setAuthJwt(jwt) { deps.authJwt = jwt; },
    setEncryptionKey(key) { deps.encryptionKey = key; },
    _inspect() {
      const q = readQueue();
      return {
        queueDepth: q.upserts.length + q.deletes.length,
        cursor: readCursor(),
        running,
      };
    },
  };
}
