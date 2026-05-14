/**
 * apps/api · /account/delete handler (Sprint B' · GDPR + App Store erasure)
 *
 * Threat model + invariants:
 *
 *   1. The route receives a Supabase user JWT in the Authorization header
 *      and a `{ confirm: "DELETE" }` body. The JWT proves the caller IS
 *      the user whose account they want erased; the confirm token guards
 *      against CSRF + accidental fire.
 *
 *   2. The worker verifies the JWT by calling Supabase's `auth/v1/user`
 *      endpoint with the bearer header. That endpoint returns the row
 *      Supabase considers authenticated, so we read `user.id` from
 *      Supabase's mouth — never from a self-decoded JWT claim — to avoid
 *      ever trusting a forged token. Returns 401 on any failure.
 *
 *   3. Once we know the user_id we cascade DELETE every user-scoped row
 *      via the service-role key (which bypasses RLS). Defense-in-depth:
 *      every table already has `on delete cascade` on its `auth.users`
 *      FK, so deleting the auth user alone would in principle cascade.
 *      We still issue explicit DELETEs first so:
 *        - we get per-table row counts back (auditable)
 *        - if cascade is ever silently turned off (drift), we still
 *          erase user data
 *        - the deletion log is self-contained without a Postgres trigger
 *
 *   4. The auth.users row is deleted LAST. Once it's gone the JWT we
 *      received is invalid and any in-flight retries can no longer
 *      authenticate — so we must complete cascade DELETEs first.
 *
 *   5. Service-role is REQUIRED here for two reasons. (a) `delete from
 *      profiles` and friends are RLS-gated to `auth.uid() = id`, so the
 *      user's JWT would work — but we use service-role anyway so
 *      *every* table (including ones without permissive DELETE policies,
 *      e.g. plaid_inbox which doesn't grant DELETE to authenticated) is
 *      reachable. (b) deleting the auth.users row REQUIRES the service-
 *      role key — that endpoint is gated to admin.
 *
 *   6. Cross-table transactions are NOT available in the Supabase REST
 *      surface. We accept best-effort sequential DELETEs. If a step
 *      mid-cascade fails we return 500 with the partial results so the
 *      client can show "deletion partially failed" and Serra can rerun.
 *      Because every FK has `on delete cascade`, a *successful* delete
 *      of the auth.users row would clean up any straggler rows even if
 *      an explicit DELETE failed transiently. The recommended retry
 *      path is: client receives 500 → retries the POST. The cascade is
 *      idempotent (DELETE on an already-empty table is a no-op).
 *
 *   7. Anonymized rows (raw_dumps / enriched_signals / research_corpus
 *      / consent_audit etc.) carry user_hash, NOT user_id. They are
 *      anonymized at write time and cannot be linked back to the user
 *      via this endpoint. They remain in the corpus as documented in
 *      the privacy policy.
 *
 * Hard constraints (re-stated):
 *   - JWT verification through Supabase, never self-decoded
 *   - Confirm token === literal string "DELETE"
 *   - auth.users delete LAST
 *   - service-role secret never leaves the worker env
 */

export interface AccountDeleteEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface AccountDeleteBody {
  confirm?: string;
}

export interface AccountDeleteSuccess {
  ok: true;
  user_id: string;
  deleted_tables: string[];
  deleted_rows: Record<string, number>;
  auth_user_deleted: boolean;
}

export interface AccountDeleteFailure {
  ok: false;
  code:
    | 'config-missing'
    | 'no-jwt'
    | 'bad-jwt'
    | 'bad-confirm'
    | 'bad-json'
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
 * Ordered list of every user-scoped table that has a `user_id`
 * (or `id` for `profiles`) FK to `auth.users`. Order is logical, not
 * critical — every FK is `on delete cascade` so order only affects
 * the count breakdown. Kept stable for the audit trail in
 * deleted_tables[].
 *
 * If you add a new table with `user_id uuid references auth.users(id)`
 * add it HERE too — the FK cascade will silently clean it up otherwise,
 * but the explicit DELETE gives us the row count for the GDPR audit.
 */
export const USER_SCOPED_TABLES: ReadonlyArray<{ table: string; column: 'user_id' | 'id' }> = [
  { table: 'encrypted_state', column: 'user_id' },
  { table: 'finance_records', column: 'user_id' },
  { table: 'plaid_inbox', column: 'user_id' },
  { table: 'plaid_items', column: 'user_id' },
  { table: 'scheduled_jobs', column: 'user_id' },
  // profiles last among user-scoped tables — it's 1:1 with auth.users
  // and other tables can reference it transitively (none do today, but
  // future-proofs against schema drift).
  { table: 'profiles', column: 'id' },
];

export interface AccountDeleteDeps {
  /** Injectable fetch — tests substitute a mock. */
  fetchImpl: typeof fetch;
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
  const status = httpStatusForFailure(result.code);
  return Response.json(result, { status });
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

  // 2. Body must include `confirm: "DELETE"` — guards against CSRF and
  //    accidental fire. The string is intentionally not localised.
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

  // 3. Verify the JWT by asking Supabase WHO it thinks this token belongs
  //    to. Never trust self-decoded claims. A bad token returns 401.
  const userId = await verifyJwtAndExtractUserId(env, deps, jwt);
  if (!userId) {
    return { ok: false, code: 'bad-jwt', message: 'invalid or expired token' };
  }

  // 4. Cascade DELETE every user-scoped table via service-role.
  const deleted_tables: string[] = [];
  const deleted_rows: Record<string, number> = {};
  for (const { table, column } of USER_SCOPED_TABLES) {
    const r = await deleteUserRows(env, deps, table, column, userId);
    if (!r.ok) {
      return {
        ok: false,
        code: 'cascade-failed',
        message: `failed to delete from ${table}: ${r.error}`,
        partial: {
          deleted_tables: [...deleted_tables],
          deleted_rows: { ...deleted_rows },
          failed_table: table,
          auth_user_deleted: false,
        },
      };
    }
    deleted_tables.push(table);
    deleted_rows[table] = r.count;
  }

  // 5. Delete the Supabase auth user LAST. Once this completes the JWT
  //    is permanently invalid. Any FK rows we somehow missed cascade
  //    automatically via `on delete cascade`.
  const authDelete = await deleteAuthUser(env, deps, userId);
  if (!authDelete.ok) {
    return {
      ok: false,
      code: 'auth-delete-failed',
      message: `cascade succeeded but auth.users delete failed: ${authDelete.error}`,
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
    deleted_tables,
    deleted_rows,
    auth_user_deleted: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Ask Supabase Auth which user this JWT belongs to. Returning a user_id
 * is the ONLY evidence we trust — never the JWT payload itself.
 *
 *   GET /auth/v1/user
 *   Authorization: Bearer <user-jwt>
 *   apikey: <service-role-or-anon>
 *
 * Service-role works as the apikey here (Supabase accepts either anon
 * or service-role for this endpoint; we use service-role since it's the
 * only Supabase secret the worker carries).
 */
async function verifyJwtAndExtractUserId(
  env: AccountDeleteEnv,
  deps: AccountDeleteDeps,
  jwt: string,
): Promise<string | null> {
  const url = `${env.SUPABASE_URL}/auth/v1/user`;
  try {
    const res = await deps.fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${jwt}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: string };
    if (typeof body.id !== 'string' || body.id.length === 0) return null;
    return body.id;
  } catch {
    return null;
  }
}

interface DeleteResult { ok: true; count: number }
interface DeleteFailure { ok: false; error: string }

/**
 * DELETE FROM <table> WHERE <column> = <userId>.
 *
 * Uses service-role to bypass RLS. PostgREST returns the deleted rows
 * when `prefer=return=representation` is set — we use that to count.
 * For tables that could be large (plaid_inbox), the response can be
 * sizeable; the typical-per-user counts are well under 10k so this is
 * acceptable. If a user ever blows past that we can switch to
 * `count=exact` headers and a HEAD request, but YAGNI today.
 */
async function deleteUserRows(
  env: AccountDeleteEnv,
  deps: AccountDeleteDeps,
  table: string,
  column: 'user_id' | 'id',
  userId: string,
): Promise<DeleteResult | DeleteFailure> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${column}=eq.${encodeURIComponent(userId)}`;
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
      const body = await safeText(res);
      return { ok: false, error: `http ${res.status} ${body ?? ''}`.trim() };
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
 * Delete the auth.users row.
 *
 *   DELETE /auth/v1/admin/users/{userId}
 *   apikey: <service-role>
 *   Authorization: Bearer <service-role>
 *
 * GoTrue's admin API requires service-role for the bearer token AND
 * the apikey header. Without service-role this returns 401.
 */
async function deleteAuthUser(
  env: AccountDeleteEnv,
  deps: AccountDeleteDeps,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  try {
    const res = await deps.fetchImpl(url, {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        accept: 'application/json',
      },
    });
    // Supabase returns 200 with the deleted user payload OR 204. Both ok.
    if (res.status === 200 || res.status === 204) return { ok: true };
    // Some GoTrue versions return 404 if the user is already gone — treat
    // as success so a retry after a partial failure still completes.
    if (res.status === 404) return { ok: true };
    const body = await safeText(res);
    return { ok: false, error: `http ${res.status} ${body ?? ''}`.trim() };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err).slice(0, 200) };
  }
}

async function safeText(res: Response): Promise<string | undefined> {
  try { return await res.text(); } catch { return undefined; }
}
