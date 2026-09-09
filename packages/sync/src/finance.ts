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
 *   - consent gated on the canonical @ollie/consent `necessary` flag
 *     (necessary off = app does not work, so this should never block in
 *     practice — but we guard anyway because defense in depth is free).
 *     Görev 1 (2026-05-15): reads via hasNecessaryConsent() rather than
 *     the raw `shared.consent.necessary` key — single source of truth.
 *   - LWW per-record via updated_at; ties broken server-side by the
 *     before-insert/update trigger that clamps updated_at >= now()
 *   - decryption failures fail-closed: skip the row, warn, never write
 *     partial / garbage state into the store
 */

import type { Store } from '@ollie/store';
import type { OllieAPI } from '@ollie/api';
import * as events from '@ollie/events';
import { hasNecessaryConsent } from '@ollie/consent';
import {
  bytesToPgHex,
  pgHexToBytes,
  encryptData,
  decryptData,
} from '@ollie/crypto';
import type { EncryptedPayload } from '@ollie/crypto';
import { createDebouncer, createBackoffScheduler, safeErrSummary } from './retry';

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
  encrypted_payload: string; // Postgres bytea hex (\x+hex) on the wire
  iv: string;                // Postgres bytea hex (\x+hex) on the wire
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
  /** Encrypted payload as Postgres bytea hex (\x+hex). For tombstones
   *  we still ship an encrypted empty-object blob so the server-side row
   *  shape is uniform. */
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
   * Lands a finance record into the user-encrypted store without
   * round-tripping through `store.set('finance', …)`.
   *
   * Errors propagate so the caller can decide how to handle a failed
   * write.
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
  // Per-store-key debounce + a single backoff-scheduled drain — shared
  // ./retry helper. The drain scheduler adds exponential backoff and a
  // max-attempt cap so a forever-failing server stops being retried.
  const diffDebouncer = createDebouncer<string>(DEBOUNCE_MS);
  const drainScheduler = createBackoffScheduler(() => drainOnce());
  // Local snapshot per store key — used to compute add/update/delete
  // diffs on each subscription tick (the store fires with the new
  // value; we keep the previous to detect deletions).
  const snapshots = new Map<string, Map<string, SyncableFinanceRow>>();

  // ── consent + sync gate ─────────────────────────────────────────────────
  function isEnabled(): boolean {
    const sync = deps.store.get<{ enabled?: boolean }>('shared', 'settings.sync', { enabled: false }) ?? { enabled: false };
    if (!sync.enabled) return false;
    // Defense in depth: respect the master consent gate even though
    // "necessary off" means the app does not work at all (consent screen
    // blocks sign-up). Reads the canonical @ollie/consent state.
    if (!hasNecessaryConsent(deps.store)) return false;
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

  // Per-pull set of ids already applied AT the boundary cursor timestamp.
  // We page with `gte.<cursor>` (not `gt.`) so rows that share the exact
  // boundary timestamp are never skipped (audit #6 — `updated_at` is not
  // unique). To avoid re-applying the very rows that defined the cursor we
  // dedupe by id: only ids seen AT the boundary timestamp need filtering;
  // anything strictly newer is always new. Reset whenever the boundary moves.
  let seenAtCursor = new Set<string>();
  let seenAtCursorTs: string | null = null;

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
      encrypted_payload: bytesToPgHex(enc.ciphertext),
      iv: bytesToPgHex(enc.iv),
      deleted: row._deleted === true,
      // LWW timestamp source (audit #117): MUST match the inbound LWW
      // comparison in syncIn() which reads `last_edited_at ?? created_at ?? 0`.
      // Falling straight to now() here (skipping created_at) made an
      // outbound push that lacked last_edited_at out-rank a remote row that
      // shared the same created_at. Mirror the inbound precedence exactly:
      // last_edited_at ?? created_at ?? now().
      updated_at_ms:
        typeof row.last_edited_at === 'number' ? row.last_edited_at
        : typeof row.created_at === 'number' ? row.created_at
        : nowFn(),
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
    diffDebouncer.schedule(storeKey, () => {
      void diffAndEnqueue(storeKey, recordType)
        .then(() => scheduleDrain())
        .catch((err) => {
          // SECURITY (S4): safe summary only — the error may carry a row.
          console.error('[sync/finance] diffAndEnqueue failed', storeKey, safeErrSummary(err));
        });
    });
  }

  // ── drain queue → Supabase ─────────────────────────────────────────────
  async function drainOnce(): Promise<void> {
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
        // Already encoded as Postgres `bytea` hex (`\x`+hex) at enqueue
        // time via bytesToPgHex — NOT base64. PostgREST stores string
        // literals verbatim into bytea, so base64 would make the IV 16
        // octets and trip `check (octet_length(iv) = 12)` (audit #1).
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
          // Leave queue intact, retry with exponential backoff (capped).
          drainScheduler.scheduleRetry();
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
        // leave the delete in queue, retry with exponential backoff (capped)
        drainScheduler.scheduleRetry();
        return;
      }
    }
    {
      const next = readQueue();
      const shippedIds = new Set(q.deletes.map((d) => d.id));
      next.deletes = next.deletes.filter((d) => !shippedIds.has(d.id));
      writeQueue(next);
    }

    // Full drain succeeded → clear the failure counter so backoff resets.
    drainScheduler.reset();

    try {
      events.emit('sync:finance_outbound_flushed', {
        upserts: q.upserts.length,
        deletes: q.deletes.length,
        ts: nowFn(),
      });
    } catch { /* registry warn ok */ }
  }

  function scheduleDrain(delayMs = 0): void {
    drainScheduler.schedule(delayMs);
  }

  // ── inbound: pull rows updated since cursor, decrypt, apply ────────────
  //
  // `keyset` is an in-drain composite high-water mark `(ts, id)` used ONLY to
  // page through the >PAGE_LIMIT-rows-sharing-a-timestamp case (audit #6). It
  // is never persisted. When set we fetch strictly AFTER (ts, id) in
  // (updated_at, id) order via a PostgREST composite predicate, so we neither
  // re-fetch already-applied rows nor skip a later-timestamp row with a
  // smaller id.
  async function syncIn(keyset?: { ts: string; id: string }): Promise<void> {
    if (!isEnabled()) return;
    const cursor = readCursor();
    const params: Record<string, string> = {
      user_id: `eq.${deps.userId}`,
      // Composite ordering by (updated_at, id) makes paging deterministic
      // across rows sharing a timestamp — required so the keyset / seen-id
      // dedupe below never skips a boundary-timestamp row (audit #6).
      order: 'updated_at.asc,id.asc',
      limit: String(PAGE_LIMIT),
    };
    if (keyset) {
      // Composite keyset: (updated_at, id) > (ts, id). PostgREST encodes this
      // as a top-level OR: updated_at strictly greater, OR same updated_at
      // with a strictly greater id.
      params.or = `(updated_at.gt.${keyset.ts},and(updated_at.eq.${keyset.ts},id.gt.${keyset.id}))`;
    } else if (cursor) {
      // gte. (not gt.) so rows sharing the boundary updated_at are not
      // permanently skipped; seen-id dedupe prevents re-applying the cursor row.
      params.updated_at = `gte.${cursor}`;
    }

    const r = await deps.api.supabase.rest.get<RemoteFinanceRow[]>(TABLE, {
      authJwt: deps.authJwt,
      params,
    });
    if (!r.ok) return;
    const rows = r.data ?? [];
    if (rows.length === 0) return;

    // Reset the boundary-dedupe set if the cursor moved since last page.
    if (seenAtCursorTs !== cursor) {
      seenAtCursor = new Set<string>();
      seenAtCursorTs = cursor;
    }

    // Group decrypted rows by record_type to map back to store keys.
    const decryptedByType = new Map<FinanceRecordType, SyncableFinanceRow[]>();
    const deletedByType = new Map<FinanceRecordType, Set<string>>();

    // Cursor derivation (audit #5): the written cursor must only advance
    // PAST rows we actually applied. A row that fails to decrypt must NOT
    // move the cursor beyond it, or the next pull (gte.cursor) would never
    // ask for it again → permanent silent data loss. We therefore track:
    //   - maxApplied: highest updated_at among applied/tombstone rows
    //   - minFailed:  lowest updated_at among failed rows
    // and clamp the written cursor strictly below minFailed.
    let maxApplied: string | null = null;
    let minFailed: string | null = null;
    // Track which ids we apply at each timestamp so the next page's / pull's
    // boundary dedupe knows what to skip.
    const appliedRowsAtTs = new Map<string, Set<string>>();
    const noteApplied = (ts: string, id: string): void => {
      if (maxApplied === null || ts > maxApplied) maxApplied = ts;
      const ids = appliedRowsAtTs.get(ts) ?? new Set<string>();
      ids.add(id);
      appliedRowsAtTs.set(ts, ids);
    };
    const noteFailed = (ts: string): void => {
      if (minFailed === null || ts < minFailed) minFailed = ts;
    };

    for (const row of rows) {
      // Boundary dedupe: a row at the cursor timestamp that we already
      // applied on a previous page/pull must be skipped (we re-fetch it
      // because we query with gte.). It is NOT a failure — do not let it
      // gate the cursor below itself.
      if (cursor && row.updated_at === cursor && seenAtCursor.has(row.id)) {
        continue;
      }
      try {
        if (row.deleted_at) {
          const s = deletedByType.get(row.record_type) ?? new Set<string>();
          s.add(row.id);
          deletedByType.set(row.record_type, s);
          noteApplied(row.updated_at, row.id);
          continue;
        }
        const ciphertext = pgHexToBytes(row.encrypted_payload);
        const iv = pgHexToBytes(row.iv);
        const plain = await decryptData<SyncableFinanceRow>(deps.encryptionKey, { ciphertext, iv });
        if (!plain || typeof plain !== 'object') {
          // Treat an unusable payload like a decrypt failure: do not
          // advance the cursor past it (audit #5).
          noteFailed(row.updated_at);
          continue;
        }
        // Pin the id from the row — defense against a tampered blob
        // that swaps id under us.
        plain.id = row.id;
        const list = decryptedByType.get(row.record_type) ?? [];
        list.push(plain);
        decryptedByType.set(row.record_type, list);
        noteApplied(row.updated_at, row.id);
      } catch (err) {
        // Fail-closed: skip the row, never write garbage to the store.
        // The cursor must stay BELOW this row so the next pull re-fetches
        // it (audit #5 — decrypt-failure data loss).
        noteFailed(row.updated_at);
        // SECURITY (S4): a decrypt error can carry ciphertext/plaintext —
        // log a safe summary only.
        console.warn('[sync/finance] decrypt failed for row', row.id, safeErrSummary(err));
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

    // Compute the new cursor (audit #5). Never advance to/past a row that
    // failed to decrypt: the cursor must stay strictly below minFailed so
    // the next pull (gte.cursor) re-fetches the failed row once it becomes
    // decryptable again. We pick the highest applied timestamp that is also
    // strictly < minFailed when a failure exists.
    //
    // NOTE: the cursor is only persisted for the top-level (non-keyset) pull.
    // While paging within a single timestamp via the keyset (audit #6) the
    // persisted cursor must NOT advance past the boundary timestamp, or a
    // crash mid-page could skip un-applied rows at that same timestamp.
    let nextCursor: string | null = cursor;
    if (minFailed !== null) {
      // Advance only as far as applied rows strictly below the failure.
      if (maxApplied !== null && maxApplied < minFailed) {
        nextCursor = maxApplied;
      } else {
        // The earliest failure is at or below everything we applied — hold
        // the cursor where it was so the failed row is retried next pull.
        nextCursor = cursor;
      }
    } else if (maxApplied !== null) {
      nextCursor = maxApplied;
    }
    if (nextCursor) writeCursor(nextCursor);

    // Maintain the boundary-dedupe set for the next page/pull: it must hold
    // every id we applied AT the new cursor timestamp.
    if (nextCursor) {
      if (seenAtCursorTs !== nextCursor) {
        seenAtCursor = new Set<string>();
        seenAtCursorTs = nextCursor;
      }
      const idsAtCursor = appliedRowsAtTs.get(nextCursor);
      if (idsAtCursor) for (const id of idsAtCursor) seenAtCursor.add(id);
    }

    try {
      events.emit('sync:finance_inbound_applied', {
        applied: rows.length,
        cursor: nextCursor,
        ts: nowFn(),
      });
    } catch { /* registry warn ok */ }

    // If we filled the page, drain the rest.
    if (rows.length >= PAGE_LIMIT) {
      const lastRow = rows[rows.length - 1];
      const cursorMoved = nextCursor !== null && nextCursor !== cursor;
      // The page's tail shares the written cursor timestamp → there may be
      // MORE rows at that exact timestamp beyond this page (audit #6,
      // >PAGE_LIMIT rows sharing a timestamp). A plain gte.cursor re-pull
      // would just return the same first PAGE_LIMIT ids again and the
      // seen-id dedupe would drop them all, never reaching the tail. Page by
      // (ts, id) WITHIN the timestamp instead so we always make forward
      // progress.
      const tailAtCursor = nextCursor !== null && lastRow.updated_at === nextCursor;
      if (tailAtCursor) {
        await syncIn({ ts: lastRow.updated_at, id: lastRow.id });
      } else if (cursorMoved) {
        // Cursor advanced cleanly to a fresh timestamp — the next pull picks
        // up from there (gte.cursor + seen-id dedupe).
        await syncIn();
      }
      // else: page full of failures/boundary rows we cannot advance past —
      // stop; the next pull (after the failure resolves) retries from cursor.
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
    return syncIn().catch((err) =>
      console.warn('[sync/finance] initial syncIn failed:', safeErrSummary(err)),
    );
  }

  function stop(): void {
    for (const u of unsubs) { try { u(); } catch { /* noop */ } }
    unsubs = [];
    diffDebouncer.cancelAll();
    drainScheduler.cancel();
    drainScheduler.reset();
    snapshots.clear();
    running = false;
  }

  // ── Public single-record upsert ───────────────────────────────────────
  // Encrypt the row with the user's key, enqueue, and request a drain.
  // We deliberately do NOT route through `store.set('finance', …)` for
  // two reasons:
  //   1. The store path piggybacks on the subscriber tick which would
  //      also pull the row into the in-memory FinanceModule arrays
  //      (records[]). That's the right end-state, but the LWW reconcile
  //      via syncIn() on the next page-load handles it cleanly without
  //      the caller having to know the FinanceRecord shape.
  //   2. Keeps the upsert free of any store-shape coupling — if the
  //      module store schema changes, it still works.
  async function upsertRecord(
    row: SyncableFinanceRow,
    recordType: FinanceRecordType = 'transaction',
  ): Promise<void> {
    if (!isEnabled()) {
      // Sync is opt-out — caller should treat this as a hard fail. The
      // next session with sync enabled will drain the outbound queue.
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
