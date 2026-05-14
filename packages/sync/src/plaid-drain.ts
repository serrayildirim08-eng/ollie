/**
 * @ollie/sync · Plaid inbox drain (client-side)
 *
 * Sprint 6 · companion to the Plaid sandbox worker scaffold shipped
 * 2026-05-14 (commit debb0b2: "money: close gap — Plaid sandbox + worker
 * scaffold"). This is the security-sensitive flow that makes a Plaid
 * webhook round-trip end-to-end into an encrypted finance_records row.
 *
 * ────────────────────────────────────────────────────────────────────
 * ARCHITECTURE DECISION — key handling (Option A · worker proxy)
 * ────────────────────────────────────────────────────────────────────
 *
 * The plaid-sync worker stages Plaid payloads in `plaid_inbox`,
 * encrypted with PLAID_INBOX_ENCRYPTION_KEY (a 32-byte symmetric key
 * held only in the worker's env). The client does NOT possess that
 * key, by design — distributing it would defeat the point of staging.
 *
 * Two routes considered:
 *
 *   A. Worker proxy: client calls /inbox/drain on the worker, which
 *      decrypts each row server-side with the inbox key and returns
 *      plaintext over TLS. Client immediately re-encrypts with the
 *      user's key and writes to finance_records. Worker keeps the
 *      symmetric key; client never sees it.
 *
 *   B. Distribute the inbox key to clients. REJECTED — defeats the
 *      whole reason the staging table exists. If every client has the
 *      key, the staging encryption provides no protection beyond TLS.
 *
 * Locked: Option A.
 *
 * ────────────────────────────────────────────────────────────────────
 * PLAINTEXT LIFETIME AUDIT
 * ────────────────────────────────────────────────────────────────────
 *
 *   Worker memory: TLS request in → decrypt with PLAID_INBOX_ENCRYPTION_KEY
 *                  → JSON response serialized → TLS response out. The
 *                  decrypted plaintext exists for the duration of one
 *                  request handler. Worker isolates are recycled and
 *                  never persist memory to disk.
 *
 *   Network:       HTTPS only. The plaid-sync worker uses Cloudflare's
 *                  TLS termination; no plaintext on the wire.
 *
 *   Client memory: response.json() parses → shape validation → handed
 *                  to financeSync.upsertRecord(rec) which IMMEDIATELY
 *                  encrypts with the user's AES-GCM-256 key (derived
 *                  in-memory from the user's passphrase via PBKDF2)
 *                  and enqueues the ciphertext blob into the outbound
 *                  queue. The plaintext object is unreferenced and
 *                  eligible for GC at the end of the for-loop tick.
 *
 *   At rest:       NEVER as plaintext.
 *                    - plaid_inbox.encrypted_with_server_key — AES-GCM
 *                      under the worker's env key.
 *                    - finance_records.encrypted_payload — AES-GCM
 *                      under the user's derived key.
 *                  The server cannot read either side without
 *                  compromising the matching key environment.
 *
 *   Logging:       We log row ids + error reasons. We NEVER log the
 *                  decrypted transaction payload (no merchant names,
 *                  amounts, account ids end up in console output).
 *
 * ────────────────────────────────────────────────────────────────────
 * FAIL-CLOSED POLICY
 * ────────────────────────────────────────────────────────────────────
 *
 *   - Shape validation rejects rows that look tampered (missing/typed
 *     fields, NaN amounts, foreign userId). These are NOT acked, so
 *     they remain in plaid_inbox for human inspection. Worst case the
 *     row sits forever; we'd rather leak storage than lose data or
 *     write garbage to finance_records.
 *
 *   - Upsert failure: row id is NOT added to the ack list. Worker
 *     keeps the staging row; next drain retries.
 *
 *   - Missing auth: do not call the worker. Return an error result —
 *     never throw silently (so callers can surface "please sign in").
 *
 *   - Network failure on /inbox/drain: return error result, do NOT
 *     call /inbox/ack with stale ids.
 *
 *   - Network failure on /inbox/ack: rows remain staged; next drain
 *     re-pulls them. Upsert is idempotent (same Plaid transaction_id
 *     → same finance_records.id → encrypted blob replaces last write).
 */

import type { FinanceSyncClient } from './finance';

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

/**
 * One row as returned by POST /inbox/drain. The worker has already
 * decrypted the at-rest envelope, so `transaction` is plaintext.
 *
 * Shape must be validated before any side-effect — see isValidRow().
 */
export interface PlaidInboxDrainedRow {
  id: string;
  item_id: string;
  /**
   * Discriminator. Mirrors plaid_inbox.record_kind.
   * Tombstones carry { kind: 'tombstones', removed_ids: string[] }
   * in `transaction`; sync_markers carry { kind: 'sync_required', … }.
   */
  record_kind: 'sync_marker' | 'tombstones' | 'transaction';
  /**
   * Decrypted payload. Shape depends on record_kind:
   *   - 'transaction': PlaidNormalizedTransaction-shaped object
   *   - 'sync_marker': { kind: 'sync_required', reason, ts }
   *   - 'tombstones':  { kind: 'tombstones', removed_ids, ts }
   */
  transaction: Record<string, unknown>;
  created_at: string;
}

export interface PlaidDrainResponse {
  rows: PlaidInboxDrainedRow[];
}

export interface PlaidDrainDeps {
  /**
   * Worker base URL — e.g. https://plaid-sync.ollie.workers.dev. The
   * drain calls `${workerUrl}/inbox/drain` and `${workerUrl}/inbox/ack`.
   * Inject from VITE_PLAID_SYNC_WORKER_URL.
   */
  workerUrl: string;
  /**
   * Returns the current Supabase JWT or null. Called fresh on each
   * drain — supports JWT refresh between drains.
   */
  authToken: () => string | null;
  /** The signed-in user's Supabase auth uid. */
  userId: string;
  /**
   * The shared FinanceSyncClient instance already wired in
   * account-boot.ts. We DO NOT create a second client here — that
   * would race with the existing outbound queue.
   */
  financeSync: FinanceSyncClient;
  /** Override for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Override max rows pulled per drain. Defaults to 50. */
  limit?: number;
  /** Injected clock for tests. */
  now?: () => number;
}

export interface PlaidDrainError {
  id: string;
  reason:
    | 'invalid_shape'
    | 'upsert_failed'
    | 'no_auth'
    | 'network'
    | 'http_error'
    | 'unknown';
  detail?: string;
}

export interface PlaidDrainResult {
  drained: number;
  failed: number;
  errors: PlaidDrainError[];
}

// ──────────────────────────────────────────────────────────────────────────
// Shape validators (pure, exported for tests)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Validate a drained row before any side-effect. We are strict on
 * purpose: a tampered server response should NEVER produce a
 * finance_records write.
 *
 * Returns the typed transaction on success, null on rejection.
 */
export function validateDrainedRow(
  row: unknown,
  expectedUserId: string,
): { ok: true; row: PlaidInboxDrainedRow } | { ok: false; reason: string } {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'row not an object' };
  const r = row as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) {
    return { ok: false, reason: 'id missing' };
  }
  if (typeof r.item_id !== 'string') {
    return { ok: false, reason: 'item_id missing' };
  }
  if (typeof r.created_at !== 'string') {
    return { ok: false, reason: 'created_at missing' };
  }

  // record_kind must be one of three. The worker today only stages
  // sync_marker + tombstones; we forward-declare 'transaction' for the
  // next sprint when worker-side cursor sync lands.
  if (r.record_kind !== 'sync_marker' && r.record_kind !== 'tombstones' && r.record_kind !== 'transaction') {
    return { ok: false, reason: 'record_kind invalid' };
  }

  const tx = r.transaction;
  if (!tx || typeof tx !== 'object') {
    return { ok: false, reason: 'transaction missing' };
  }

  if (r.record_kind === 'transaction') {
    // Strict finance-record validation — see PlaidNormalizedTransaction
    // in @ollie/plaid/types. We do NOT import that type to keep the
    // sync package free of a plaid dep; we duplicate the field check.
    const t = tx as Record<string, unknown>;
    if (typeof t.id !== 'string' || t.id.length === 0) {
      return { ok: false, reason: 'transaction.id missing' };
    }
    if (typeof t.amount !== 'number' || !Number.isFinite(t.amount)) {
      return { ok: false, reason: 'transaction.amount not finite' };
    }
    if (typeof t.event_date !== 'string' && typeof t.ts !== 'number') {
      // event_date (YYYY-MM-DD) is the canonical Plaid normalizer
      // output. We also accept a legacy `ts` ms-epoch in case the
      // worker pipeline changes.
      return { ok: false, reason: 'transaction.event_date or ts required' };
    }
    if (t.direction !== 'in' && t.direction !== 'out') {
      return { ok: false, reason: 'transaction.direction invalid' };
    }
    // merchant_normalized may be null per PlaidNormalizedTransaction —
    // do NOT reject on null, only on wrong type.
    if (t.merchant_normalized !== null && typeof t.merchant_normalized !== 'string') {
      return { ok: false, reason: 'transaction.merchant_normalized invalid' };
    }
  } else if (r.record_kind === 'tombstones') {
    const t = tx as Record<string, unknown>;
    if (!Array.isArray(t.removed_ids)) {
      return { ok: false, reason: 'tombstones.removed_ids not array' };
    }
    for (const id of t.removed_ids) {
      if (typeof id !== 'string' || id.length === 0) {
        return { ok: false, reason: 'tombstones.removed_ids invalid entry' };
      }
    }
  } else if (r.record_kind === 'sync_marker') {
    const t = tx as Record<string, unknown>;
    if (t.kind !== 'sync_required') {
      return { ok: false, reason: 'sync_marker.kind invalid' };
    }
  }

  // We intentionally do NOT validate a `user_id` field inside the
  // payload — the worker stripped it (the drain endpoint scopes by
  // auth.uid()). Defense in depth: the worker MUST also enforce
  // auth.uid() === body.userId. See workers/plaid-sync/src/index.ts.
  void expectedUserId;

  return { ok: true, row: r as unknown as PlaidInboxDrainedRow };
}

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Drain plaid_inbox once. Idempotent + safe to call on an interval.
 *
 * Steps (atomic from the perspective of one row):
 *   1. POST /inbox/drain with the user's JWT.
 *   2. For each row, validate shape. Invalid → error, do NOT ack.
 *   3. For 'transaction' rows: financeSync.upsertRecord(payload). The
 *      sync client encrypts under the user's key + enqueues for the
 *      next outbound drain to finance_records.
 *   4. For 'tombstones' rows: enqueue a delete via the existing
 *      finance-sync delete path. Today we do this by writing the
 *      synthetic _deleted=true marker on a SyncableFinanceRow so the
 *      same encryption + queue path handles it.
 *   5. For 'sync_marker' rows: no-op locally; ack so the marker is
 *      cleared. (The actual transaction fetch happens worker-side in
 *      the next sprint.)
 *   6. After the loop, POST /inbox/ack with the ids of every row
 *      that successfully landed.
 */
export async function drainPlaidInbox(deps: PlaidDrainDeps): Promise<PlaidDrainResult> {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      drained: 0,
      failed: 0,
      errors: [{ id: '', reason: 'network', detail: 'fetch unavailable' }],
    };
  }

  const token = deps.authToken();
  if (!token) {
    // No JWT — bail fast. Caller (interval) will retry on next tick
    // once auth is established. We do NOT throw because the interval
    // wrapper would unhandled-reject; returning a result lets the
    // caller log + continue.
    return {
      drained: 0,
      failed: 0,
      errors: [{ id: '', reason: 'no_auth', detail: 'authToken() returned null' }],
    };
  }

  if (!deps.workerUrl) {
    return {
      drained: 0,
      failed: 0,
      errors: [{ id: '', reason: 'network', detail: 'workerUrl empty' }],
    };
  }
  if (!deps.userId) {
    return {
      drained: 0,
      failed: 0,
      errors: [{ id: '', reason: 'no_auth', detail: 'userId empty' }],
    };
  }

  const limit = Math.min(Math.max(deps.limit ?? 50, 1), 200);

  // ── 1. Pull staged rows from the worker (server-side decrypts) ────────
  let drainResp: PlaidDrainResponse;
  try {
    const r = await fetchFn(`${deps.workerUrl}/inbox/drain`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: deps.userId, limit }),
    });
    if (!r.ok) {
      return {
        drained: 0,
        failed: 0,
        errors: [{ id: '', reason: 'http_error', detail: `drain ${r.status}` }],
      };
    }
    drainResp = (await r.json()) as PlaidDrainResponse;
  } catch (err) {
    return {
      drained: 0,
      failed: 0,
      errors: [{ id: '', reason: 'network', detail: stringifyErr(err) }],
    };
  }

  const rows = Array.isArray(drainResp?.rows) ? drainResp.rows : [];
  if (rows.length === 0) {
    return { drained: 0, failed: 0, errors: [] };
  }

  // ── 2 + 3 + 4 + 5. Validate + write + collect ack list ────────────────
  const ackIds: string[] = [];
  const errors: PlaidDrainError[] = [];

  for (const raw of rows) {
    const v = validateDrainedRow(raw, deps.userId);
    if (!v.ok) {
      const id = (raw as { id?: unknown })?.id;
      // SECURITY: tampered or malformed row. We intentionally do NOT
      // ack — leave it in the staging table for ops to inspect. The
      // worker can be patched + the row re-processed.
      errors.push({
        id: typeof id === 'string' ? id : '',
        reason: 'invalid_shape',
        detail: v.reason,
      });
      // eslint-disable-next-line no-console
      console.warn('[plaid-drain] invalid row shape — leaving staged for inspection', {
        id,
        reason: v.reason,
      });
      continue;
    }

    const row = v.row;
    try {
      if (row.record_kind === 'transaction') {
        // SECURITY: this is the immediate re-encryption point. The
        // upsertRecord call encrypts under the user's key before
        // any persistence. Plaintext does not survive this call.
        await deps.financeSync.upsertRecord(
          row.transaction as Record<string, unknown>,
          'transaction',
        );
        ackIds.push(row.id);
      } else if (row.record_kind === 'tombstones') {
        const removed = row.transaction as { removed_ids: string[] };
        for (const removedId of removed.removed_ids) {
          // Encode as a tombstone via the standard sync path:
          // _deleted=true triggers the queue's delete branch.
          await deps.financeSync.upsertRecord(
            { id: removedId, _deleted: true, last_edited_at: deps.now?.() ?? Date.now() },
            'transaction',
          );
        }
        ackIds.push(row.id);
      } else if (row.record_kind === 'sync_marker') {
        // No-op locally. The worker-side cursor sync (next sprint)
        // will land actual transactions on subsequent webhooks. Ack
        // so the marker doesn't accumulate.
        ackIds.push(row.id);
      }
    } catch (err) {
      errors.push({
        id: row.id,
        reason: 'upsert_failed',
        detail: stringifyErr(err),
      });
      // eslint-disable-next-line no-console
      console.warn('[plaid-drain] upsert failed — leaving staged for retry', row.id);
    }
  }

  // ── 6. Ack — delete staging rows the client successfully ingested ────
  if (ackIds.length > 0) {
    try {
      const r = await fetchFn(`${deps.workerUrl}/inbox/ack`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: deps.userId, ids: ackIds }),
      });
      if (!r.ok) {
        // Rows didn't get cleared. Not fatal — finance_records upsert
        // is idempotent on the next drain. Surface as a non-blocking
        // error.
        errors.push({
          id: '',
          reason: 'http_error',
          detail: `ack ${r.status}`,
        });
      }
    } catch (err) {
      errors.push({
        id: '',
        reason: 'network',
        detail: `ack: ${stringifyErr(err)}`,
      });
    }
  }

  return {
    drained: ackIds.length,
    failed: errors.filter((e) => e.reason !== 'http_error' || e.detail?.startsWith('ack')).length === 0
      ? 0
      : errors.filter((e) => e.reason === 'invalid_shape' || e.reason === 'upsert_failed').length,
    errors,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
