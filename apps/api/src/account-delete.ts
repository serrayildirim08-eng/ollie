/**
 * apps/api · /account/delete handler (GDPR + App Store account erasure) — v2
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS WAS REWRITTEN
 * ───────────────────────────────────────────────────────────────────────────
 * The first version (a) verified only Supabase JWTs, so every LIVE user — who
 * authenticates with Clerk — got 401 and erasure never ran; and (b) hardcoded
 * the core data tables (encrypted_state, finance_records, …) as Supabase `uuid`
 * tables and SKIPPED them for Clerk users while still returning `ok:true`. That
 * told the user "your data is deleted" while their encrypted_state and most PII
 * stayed in the DB. This version is built against the schema confirmed LIVE on
 * ollie-prod (2026-06-28):
 *
 *   - Migration 20260618000002 (uuid→text) IS applied. EVERY user-scoped table
 *     is keyed on the Clerk user id (the JWT `sub`, a `user_2…` TEXT string) or
 *     on a hash of it. There is NO uuid keying left on the data tables, so there
 *     is NO uuid-skip class for them.
 *   - `invite_funnel` is a VIEW (not a table); its backing user-owned base table
 *     is `invites`, keyed by `inviter_user_hash` / `invitee_user_hash`.
 *   - `partner_pairs` (user_lo/user_hi, raw Clerk ids) holds the pairing PII and
 *     IS erased here too.
 *   - `profiles` is a legacy table: PK `id uuid`, 0 rows live, never written
 *     under Clerk. Its uuid PK is type-incompatible with a Clerk text id, so a
 *     Clerk user provably has no row there (and firing `id=eq.user_2…` against a
 *     uuid column is a hard 22P02 that would abort the whole erasure). It is the
 *     ONLY legacy-uuid table and is handled explicitly (deleted only for a
 *     legacy Supabase-uuid identity); this is documented, surfaced in the
 *     response, and is NOT the dangerous "skip a populated clerk table" pattern.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THREAT MODEL + INVARIANTS
 * ───────────────────────────────────────────────────────────────────────────
 *   1. Caller sends a session JWT in Authorization and `{ confirm: "DELETE" }`.
 *      The JWT proves identity; the confirm token guards CSRF / accidental fire.
 *
 *   2. The JWT is verified DUAL-MODE, never self-decoded:
 *        - Clerk first: RS256 signature checked against the Clerk JWKS
 *          (CLERK_ISSUER/.well-known/jwks.json) with iss/exp/nbf validation.
 *          The verified `sub` is the user id. This is the live path.
 *        - Supabase fallback: GET /auth/v1/user with the bearer token; we read
 *          `id` from Supabase's own response. Covers any pre-Clerk token.
 *      Either way the id comes from a trusted source. 401 on any failure.
 *
 *   3. USER_HASH_SALT must be set and equal to the value ai-proxy used when it
 *      wrote the hash-keyed telemetry tables (deriveUserHash = SHA-256 hex of
 *      `${salt}:${userId}`). If the salt is unset we would derive a DIFFERENT
 *      hash and silently delete 0 rows from raw_dumps/enriched_signals/… while
 *      returning success — a fake erasure. We therefore FAIL LOUD (503) when the
 *      salt is missing rather than under-deleting.
 *
 *   4. We DELETE every user-scoped row via the service-role key (bypasses RLS),
 *      using the CORRECT key per table: Clerk text id for the data tables, the
 *      derived hash for the telemetry tables, OR across both columns for the
 *      two-sided tables (partner_pairs, invites). Explicit per-table DELETEs
 *      give us row counts for the GDPR audit and do not rely on FK cascade
 *      (which no longer exists on the clerk-id tables).
 *
 *   5. The identity record is deleted LAST — once it is gone the JWT is invalid
 *      and in-flight retries can no longer authenticate. Clerk identity →
 *      Clerk Backend API (needs CLERK_SECRET_KEY); legacy uuid identity →
 *      GoTrue admin API (needs service-role). The prerequisite secret is checked
 *      BEFORE any data is deleted, so we never half-erase and then discover we
 *      cannot remove the login.
 *
 *   6. No cross-table transaction is available on the PostgREST surface. DELETEs
 *      are sequential + idempotent; a mid-cascade failure returns 500 with the
 *      partial result and the identity record is NOT deleted, so a retry is safe.
 *
 *   7. We NEVER report ok:true unless a real DELETE ran against every covered
 *      table for the authenticated user.
 *
 * Tables with NO per-user linkage are correctly EXCLUDED (disclosed in the
 * privacy policy): research_corpus + crisis_events (anonymized / count-only,
 * no user column) and routing_cache (shared embedding cache).
 */

export interface AccountDeleteEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** apikey for the GET /auth/v1/user fallback verify. Service-role also works. */
  SUPABASE_ANON_KEY?: string;
  /** Clerk JWKS issuer host — primary (live) verify path. */
  CLERK_ISSUER?: string;
  /** Clerk Backend API key — deletes the Clerk user record (identity, LAST). */
  CLERK_SECRET_KEY?: string;
  /** Server salt for deriving user_hash on the anonymized telemetry tables.
   *  MUST equal the value ai-proxy used at write time. */
  USER_HASH_SALT?: string;
}

export interface AccountDeleteBody {
  confirm?: string;
}

export interface AccountDeleteSuccess {
  ok: true;
  user_id: string;
  /** 'clerk' = Clerk identity, 'supabase' = legacy uuid identity. */
  identity: 'clerk' | 'supabase';
  deleted_tables: string[];
  deleted_rows: Record<string, number>;
  /** Tables intentionally not queried for this identity, with the reason. */
  skipped_tables: Record<string, string>;
  auth_user_deleted: boolean;
}

export interface AccountDeleteFailure {
  ok: false;
  code:
    | 'config-missing'
    | 'salt-missing'
    | 'no-jwt'
    | 'bad-jwt'
    | 'bad-confirm'
    | 'bad-json'
    | 'identity-config-missing'
    | 'cascade-failed'
    | 'auth-delete-failed';
  message: string;
  partial?: {
    deleted_tables: string[];
    deleted_rows: Record<string, number>;
    failed_table?: string;
    auth_user_deleted: boolean;
  };
}

export type AccountDeleteResult = AccountDeleteSuccess | AccountDeleteFailure;

/**
 * Identity class of a user-scoped table:
 *   'clerk'       — column(s) hold the raw Clerk text id → delete by the id.
 *   'hash'        — column(s) hold user_hash = SHA-256(salt:userId) → delete by
 *                   the derived hash, never the raw id.
 *   'legacy-uuid' — column holds a Supabase auth.users uuid. Only a legacy
 *                   (uuid) identity can have rows; a Clerk id is type-
 *                   incompatible (and the table is empty in prod). Deleted only
 *                   when the verified identity IS a uuid; otherwise recorded as a
 *                   transparent skip (NOT silently dropped).
 */
export type TableKey = 'clerk' | 'hash' | 'legacy-uuid';

export interface UserScopedTable {
  table: string;
  key: TableKey;
  /** Identity column(s). >1 ⇒ DELETE with a PostgREST `or=` across them. */
  columns: string[];
}

/**
 * Every user-owned Supabase base table, enumerated from the LIVE prod schema
 * (ollie-prod, 2026-06-28). Order is logical, not load-bearing — DELETEs are
 * independent + idempotent. Kept stable for the audit trail.
 *
 * When you add a table that stores per-user rows, add it HERE with its identity
 * class — there is no FK cascade safety net on the clerk-id tables, so a missed
 * table is permanently orphaned.
 */
export const USER_SCOPED_TABLES: ReadonlyArray<UserScopedTable> = [
  // ── Clerk-text id (user_id), one column ── (12 tables)
  { table: 'cook_history', key: 'clerk', columns: ['user_id'] },
  { table: 'dump_inbox', key: 'clerk', columns: ['user_id'] },
  { table: 'encrypted_state', key: 'clerk', columns: ['user_id'] },
  { table: 'finance_records', key: 'clerk', columns: ['user_id'] },
  { table: 'grocery_pantry', key: 'clerk', columns: ['user_id'] },
  { table: 'grocery_purchase_history', key: 'clerk', columns: ['user_id'] },
  { table: 'partner_codes', key: 'clerk', columns: ['user_id'] },
  { table: 'partner_snapshots', key: 'clerk', columns: ['user_id'] },
  { table: 'plaid_inbox', key: 'clerk', columns: ['user_id'] },
  { table: 'plaid_items', key: 'clerk', columns: ['user_id'] },
  { table: 'push_tokens', key: 'clerk', columns: ['user_id'] },
  { table: 'scheduled_jobs', key: 'clerk', columns: ['user_id'] },

  // ── Clerk-text id, two-sided (OR across both columns) ── (1 table)
  // partner_pairs stores the pairing as user_lo/user_hi (raw Clerk ids); the
  // deleted user may be on either side.
  { table: 'partner_pairs', key: 'clerk', columns: ['user_lo', 'user_hi'] },

  // ── Anonymized telemetry, keyed on user_hash = SHA-256(salt:userId) ──
  // (7 tables)
  { table: 'consent_audit', key: 'hash', columns: ['user_hash'] },
  { table: 'enriched_signals', key: 'hash', columns: ['user_hash'] },
  { table: 'module_events', key: 'hash', columns: ['user_hash'] },
  { table: 'raw_dumps', key: 'hash', columns: ['user_hash'] },
  { table: 'retention_events', key: 'hash', columns: ['user_hash'] },
  { table: 'session_events', key: 'hash', columns: ['user_hash'] },
  { table: 'user_consent', key: 'hash', columns: ['user_hash'] },

  // ── user_hash, two-sided (OR across both columns) ── (1 table)
  // invites: the user may be the inviter or the (claimed) invitee. This is the
  // base table behind the `invite_funnel` VIEW (the view itself is not a table
  // and cannot be deleted from).
  { table: 'invites', key: 'hash', columns: ['inviter_user_hash', 'invitee_user_hash'] },

  // ── Legacy uuid (Supabase auth era), empty in prod ── (1 table)
  // profiles.id IS the auth.users uuid. 0 rows live; never written under Clerk.
  { table: 'profiles', key: 'legacy-uuid', columns: ['id'] },
];

/**
 * Derive the anonymized telemetry key for a user. MUST match ai-proxy's
 * deriveUserHash (workers/ai-proxy/src/telemetry.ts): SHA-256 hex of
 * `${salt}:${userId}`. Callers MUST guarantee a non-empty salt (we fail loud
 * upstream if USER_HASH_SALT is unset) so this never produces an unsalted hash
 * that would miss every telemetry row.
 */
export async function deriveUserHash(userId: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A Clerk user id looks like `user_2…`; a Supabase id is a uuid. */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export interface VerifiedIdentity {
  userId: string;
  identity: 'clerk' | 'supabase';
}

export interface AccountDeleteDeps {
  /** Injectable fetch — tests substitute a mock. */
  fetchImpl: typeof fetch;
  /**
   * Injectable identity verifier. Defaults to the dual-mode verifier (Clerk
   * JWKS first, Supabase /auth/v1/user fallback). Tests stub this to drive the
   * Clerk path without standing up a JWKS endpoint. Returns the verified
   * identity, or null on any failure.
   */
  verifyIdentity?: (jwt: string) => Promise<VerifiedIdentity | null>;
}

/** Public entry point for the worker. */
export async function handleAccountDelete(
  req: Request,
  env: AccountDeleteEnv,
): Promise<Response> {
  const result = await runAccountDelete(req, env, { fetchImpl: fetch.bind(globalThis) });
  if (result.ok) {
    return Response.json(result, { status: 200 });
  }
  return Response.json(result, { status: httpStatusForFailure(result.code) });
}

function httpStatusForFailure(code: AccountDeleteFailure['code']): number {
  switch (code) {
    case 'no-jwt':
    case 'bad-jwt':
      return 401;
    case 'bad-confirm':
      return 403;
    case 'bad-json':
      return 400;
    case 'config-missing':
    case 'salt-missing':
    case 'identity-config-missing':
      return 503;
    case 'cascade-failed':
    case 'auth-delete-failed':
      return 500;
  }
}

/** Core flow — exported separately so tests can drive it without HTTP. */
export async function runAccountDelete(
  req: Request,
  env: AccountDeleteEnv,
  deps: AccountDeleteDeps,
): Promise<AccountDeleteResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      code: 'config-missing',
      message: 'account deletion is not configured on this worker',
    };
  }

  // 1. Authorization header → bearer JWT
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false, code: 'no-jwt', message: 'missing bearer token' };
  }
  const jwt = authHeader.slice(7).trim();
  if (!jwt) {
    return { ok: false, code: 'no-jwt', message: 'empty bearer token' };
  }

  // 2. Body must include `confirm: "DELETE"`. Checked before any network /
  //    verify work so a missing confirm cannot be used to probe.
  let body: AccountDeleteBody;
  try {
    body = (await req.json()) as AccountDeleteBody;
  } catch {
    return { ok: false, code: 'bad-json', message: 'request body is not valid JSON' };
  }
  if (body?.confirm !== 'DELETE') {
    return {
      ok: false,
      code: 'bad-confirm',
      message: 'request body must include { confirm: "DELETE" }',
    };
  }

  // 3. FAIL LOUD if the hash salt is missing — otherwise the telemetry tables
  //    (raw_dumps, enriched_signals, …) would be queried with the wrong hash
  //    and silently delete 0 rows while we report success.
  //    ⚠️ USER_HASH_SALT IS IMMUTABLE (audit H7): it is the deletion key, not a
  //    rotatable credential. Rotating it makes deriveUserHash miss every prior
  //    row and fake-erase silently. Never add it to the launch rotation queue.
  if (!env.USER_HASH_SALT) {
    return {
      ok: false,
      code: 'salt-missing',
      message:
        'USER_HASH_SALT is not configured — refusing to delete because the ' +
        'hash-keyed telemetry tables would not be matched (fake erasure risk)',
    };
  }

  // 4. Verify the JWT (Clerk first, Supabase fallback). Never self-decode.
  const verify = deps.verifyIdentity ?? ((j: string) => verifyIdentity(j, env, deps.fetchImpl));
  const verified = await verify(jwt);
  if (!verified) {
    return { ok: false, code: 'bad-jwt', message: 'invalid or expired token' };
  }
  const { userId, identity } = verified;

  // 5. Check the identity-delete prerequisite BEFORE touching data, so we never
  //    erase data and then find we cannot remove the login.
  if (identity === 'clerk' && !env.CLERK_SECRET_KEY) {
    return {
      ok: false,
      code: 'identity-config-missing',
      message:
        'CLERK_SECRET_KEY is not configured — refusing to delete data because ' +
        'the Clerk identity record could not then be removed',
    };
  }

  const userHash = await deriveUserHash(userId, env.USER_HASH_SALT);
  const userIsUuid = isUuid(userId);

  // 6. DELETE every user-scoped table via service-role.
  const deleted_tables: string[] = [];
  const deleted_rows: Record<string, number> = {};
  const skipped_tables: Record<string, string> = {};

  for (const entry of USER_SCOPED_TABLES) {
    // The single legacy uuid table (profiles): only a uuid identity can own a
    // row. A Clerk text id is type-incompatible with the uuid PK, and the table
    // is empty in prod — so firing the query would 22P02-abort the erasure for
    // zero benefit. Record a transparent skip (this is NOT a populated clerk
    // table being hidden behind ok:true).
    if (entry.key === 'legacy-uuid' && !userIsUuid) {
      skipped_tables[entry.table] =
        'legacy uuid PK; clerk identity cannot own a row (table empty in prod)';
      continue;
    }

    const value = entry.key === 'hash' ? userHash : userId;
    const r = await deleteUserRows(env, deps, entry, value);
    if (!r.ok) {
      return {
        ok: false,
        code: 'cascade-failed',
        message: `failed to delete from ${entry.table}: ${r.error}`,
        partial: {
          deleted_tables: [...deleted_tables],
          deleted_rows: { ...deleted_rows },
          failed_table: entry.table,
          auth_user_deleted: false,
        },
      };
    }
    deleted_tables.push(entry.table);
    deleted_rows[entry.table] = r.count;
  }

  // 7. Delete the identity record LAST.
  const authDelete = await deleteIdentity(env, deps, userId, identity);
  if (!authDelete.ok) {
    return {
      ok: false,
      code: 'auth-delete-failed',
      message: `data erased but identity-record delete failed: ${authDelete.error}`,
      partial: {
        deleted_tables,
        deleted_rows,
        auth_user_deleted: false,
      },
    };
  }

  return {
    ok: true,
    user_id: userId,
    identity,
    deleted_tables,
    deleted_rows,
    skipped_tables,
    auth_user_deleted: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// identity verification
// ──────────────────────────────────────────────────────────────────────────

/**
 * Dual-mode verify: Clerk JWKS signature first (the live path), then a legacy
 * Supabase /auth/v1/user fallback. Returns the verified identity or null.
 */
export async function verifyIdentity(
  jwt: string,
  env: AccountDeleteEnv,
  fetchImpl: typeof fetch,
): Promise<VerifiedIdentity | null> {
  const clerkSub = await verifyClerkJwt(jwt, env, fetchImpl);
  if (clerkSub) return { userId: clerkSub, identity: 'clerk' };

  const supaId = await verifySupabaseJwt(jwt, env, fetchImpl);
  if (supaId) return { userId: supaId, identity: 'supabase' };

  return null;
}

/**
 * Verify a Clerk session JWT (RS256) against the Clerk JWKS using Web Crypto —
 * no external dependency. Mirrors the security properties of
 * workers/ai-proxy/src/clerk-verify.ts. Returns the `sub` on success, else null.
 */
async function verifyClerkJwt(
  jwt: string,
  env: AccountDeleteEnv,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  if (!env.CLERK_ISSUER) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { sub?: string; iss?: string; exp?: number; nbf?: number };
  try {
    header = JSON.parse(b64urlToString(headerB64)) as typeof header;
    payload = JSON.parse(b64urlToString(payloadB64)) as typeof payload;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  // Fetch JWKS (Clerk publishes rotating keys at /.well-known/jwks.json).
  let jwk: JsonWebKey | undefined;
  try {
    const url = `${env.CLERK_ISSUER.replace(/\/$/, '')}/.well-known/jwks.json`;
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const jwks = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    jwk = jwks.keys?.find((k) => k.kid === header.kid);
  } catch {
    return null;
  }
  if (!jwk) return null;

  let valid = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signature = b64urlToBytes(sigB64) as unknown as BufferSource;
    const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`) as unknown as BufferSource;
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signed);
  } catch {
    return null;
  }
  if (!valid) return null;

  // Claim checks. iss must match; exp must be in the future; nbf (if present)
  // must not be in the future (small skew allowance).
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== env.CLERK_ISSUER) return null;
  if (typeof payload.exp === 'number' && payload.exp < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 5) return null;

  return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
}

/**
 * Legacy Supabase verify — ask Supabase WHO this token belongs to. The `id`
 * field from Supabase's own response is the only thing we trust.
 */
async function verifySupabaseJwt(
  jwt: string,
  env: AccountDeleteEnv,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `${env.SUPABASE_URL}/auth/v1/user`;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${jwt}`,
        apikey: env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: string };
    return typeof body.id === 'string' && body.id ? body.id : null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// deletes
// ──────────────────────────────────────────────────────────────────────────

interface DeleteResult { ok: true; count: number }
interface DeleteFailure { ok: false; error: string }

/**
 * PostgREST filter for a table's identity column(s):
 *   - single column → `<col>=eq.<value>`
 *   - multiple cols → `or=(<c1>.eq.<value>,<c2>.eq.<value>)`
 */
function buildFilter(columns: string[], value: string): string {
  const enc = encodeURIComponent(value);
  if (columns.length === 1) return `${columns[0]}=eq.${enc}`;
  return `or=(${columns.map((c) => `${c}.eq.${enc}`).join(',')})`;
}

/**
 * DELETE FROM <table> WHERE <identity column(s)> = <value>, via service-role
 * (bypasses RLS). `prefer=return=representation` makes PostgREST return the
 * deleted rows so we can count them for the GDPR audit.
 */
async function deleteUserRows(
  env: AccountDeleteEnv,
  deps: AccountDeleteDeps,
  entry: UserScopedTable,
  value: string,
): Promise<DeleteResult | DeleteFailure> {
  const url = `${env.SUPABASE_URL}/rest/v1/${entry.table}?${buildFilter(entry.columns, value)}`;
  try {
    const res = await deps.fetchImpl(url, {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        accept: 'application/json',
        prefer: 'return=representation',
      },
    });
    if (!res.ok) {
      const txt = await safeText(res);
      return { ok: false, error: `http ${res.status} ${txt ?? ''}`.trim() };
    }
    let count = 0;
    try {
      const rows = (await res.json()) as unknown[];
      if (Array.isArray(rows)) count = rows.length;
    } catch {
      // 204 No Content path — count unknown, leave at 0.
    }
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err).slice(0, 200) };
  }
}

/**
 * Delete the user's login record LAST.
 *   - Clerk identity → DELETE https://api.clerk.com/v1/users/{id}
 *                      Authorization: Bearer <CLERK_SECRET_KEY>
 *   - Supabase (uuid) → DELETE {SUPABASE_URL}/auth/v1/admin/users/{id}
 *                      apikey + Authorization: Bearer <service-role>
 * 404 ⇒ already gone ⇒ idempotent success.
 */
async function deleteIdentity(
  env: AccountDeleteEnv,
  deps: AccountDeleteDeps,
  userId: string,
  identity: 'clerk' | 'supabase',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { url, headers } =
    identity === 'clerk'
      ? {
          url: `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
          headers: {
            authorization: `Bearer ${env.CLERK_SECRET_KEY ?? ''}`,
            accept: 'application/json',
          },
        }
      : {
          url: `${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
            accept: 'application/json',
          },
        };

  try {
    const res = await deps.fetchImpl(url, { method: 'DELETE', headers });
    if (res.status === 200 || res.status === 204 || res.status === 404) return { ok: true };
    const txt = await safeText(res);
    return { ok: false, error: `http ${res.status} ${txt ?? ''}`.trim() };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err).slice(0, 200) };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// base64url helpers (no dependency)
// ──────────────────────────────────────────────────────────────────────────

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function safeText(res: Response): Promise<string | undefined> {
  try { return await res.text(); } catch { return undefined; }
}
