/**
 * apps/api · /account/delete worker — Sprint B' tests
 *
 * Covers:
 *   - happy path: JWT verify → cascade DELETE every user-scoped table →
 *     auth.users delete LAST → 200 with row counts
 *   - 401 on missing/empty/invalid bearer
 *   - 403 on missing/wrong confirm token
 *   - 400 on malformed JSON body
 *   - 503 when SUPABASE_URL or service-role key not configured
 *   - 500 + partial on mid-cascade failure (auth.users NOT deleted)
 *   - 500 + partial on auth.users delete failure (cascade was done)
 *   - ORDER assertion: every cascade DELETE issued BEFORE the auth.users
 *     admin delete call
 *   - service-role key sent on cascade + admin call; NEVER as request
 *     output (defense in depth)
 */

import { describe, it, expect } from 'vitest';
import {
  runAccountDelete,
  USER_SCOPED_TABLES,
  type AccountDeleteEnv,
} from '../src/account-delete';

const ENV: AccountDeleteEnv = {
  SUPABASE_URL: 'https://supa.test',
  SUPABASE_SERVICE_ROLE_KEY: 'sr-secret',
};

interface CallLog {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

interface FetchRouterOpts {
  /** Result for GET /auth/v1/user (jwt verification). */
  userResult: { status: number; body?: unknown };
  /** Per-table override for DELETE /rest/v1/<table>. Default: 200 [] (0 rows). */
  tableResults?: Record<string, { status: number; body?: unknown }>;
  /** Result for DELETE /auth/v1/admin/users/{id}. Default: 204. */
  adminDeleteResult?: { status: number; body?: unknown };
}

function makeFetch(opts: FetchRouterOpts): { fetchImpl: typeof fetch; calls: CallLog[] } {
  const calls: CallLog[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers: Record<string, string> = {};
    const initHeaders = init?.headers as Record<string, string> | undefined;
    if (initHeaders) for (const [k, v] of Object.entries(initHeaders)) headers[k.toLowerCase()] = v;
    calls.push({ method: init?.method ?? 'GET', url: u, headers, body: init?.body as string | undefined });

    if (u.endsWith('/auth/v1/user')) {
      const { status, body } = opts.userResult;
      return new Response(JSON.stringify(body ?? null), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/auth/v1/admin/users/')) {
      const r = opts.adminDeleteResult ?? { status: 204 };
      return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, { status: r.status });
    }
    if (u.includes('/rest/v1/')) {
      // Extract table name
      const m = u.match(/\/rest\/v1\/([^?]+)/);
      const table = m?.[1] ?? '';
      const r = opts.tableResults?.[table] ?? { status: 200, body: [] };
      return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://worker.test/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('runAccountDelete · happy path', () => {
  it('verifies JWT, cascades every table, deletes auth user LAST, returns 200 with counts', async () => {
    const { fetchImpl, calls } = makeFetch({
      userResult: { status: 200, body: { id: 'user-123' } },
      tableResults: {
        encrypted_state: { status: 200, body: [{ id: 'a' }, { id: 'b' }] },
        finance_records: { status: 200, body: Array.from({ length: 42 }, (_, i) => ({ id: i })) },
        plaid_inbox: { status: 200, body: [] },
        plaid_items: { status: 200, body: [{ id: 'p1' }] },
        scheduled_jobs: { status: 200, body: [{ id: 's1' }, { id: 's2' }] },
        profiles: { status: 200, body: [{ id: 'user-123' }] },
      },
      adminDeleteResult: { status: 204 },
    });
    const req = postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good-jwt' });
    const r = await runAccountDelete(req, ENV, { fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user_id).toBe('user-123');
    expect(r.deleted_tables).toEqual(USER_SCOPED_TABLES.map((t) => t.table));
    expect(r.deleted_rows.encrypted_state).toBe(2);
    expect(r.deleted_rows.finance_records).toBe(42);
    expect(r.deleted_rows.plaid_inbox).toBe(0);
    expect(r.auth_user_deleted).toBe(true);

    // Order: verify call → cascade DELETEs (in USER_SCOPED_TABLES order)
    //        → admin user delete LAST.
    expect(calls[0].url).toMatch(/\/auth\/v1\/user$/);
    const tableCalls = calls.filter((c) => c.url.includes('/rest/v1/'));
    expect(tableCalls.length).toBe(USER_SCOPED_TABLES.length);
    USER_SCOPED_TABLES.forEach((t, i) => {
      expect(tableCalls[i].url).toContain(`/rest/v1/${t.table}`);
      expect(tableCalls[i].method).toBe('DELETE');
      expect(tableCalls[i].headers.authorization).toBe('Bearer sr-secret');
      expect(tableCalls[i].headers.apikey).toBe('sr-secret');
    });
    const adminIdx = calls.findIndex((c) => c.url.includes('/auth/v1/admin/users/'));
    expect(adminIdx).toBe(calls.length - 1);
    expect(calls[adminIdx].method).toBe('DELETE');
    expect(calls[adminIdx].url).toContain('user-123');
    // Last call also uses service-role on both headers.
    expect(calls[adminIdx].headers.authorization).toBe('Bearer sr-secret');
    expect(calls[adminIdx].headers.apikey).toBe('sr-secret');
  });

  it('treats 404 from admin user delete as success (idempotent retry)', async () => {
    const { fetchImpl } = makeFetch({
      userResult: { status: 200, body: { id: 'u-1' } },
      adminDeleteResult: { status: 404, body: { msg: 'user not found' } },
    });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer x' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.auth_user_deleted).toBe(true);
  });
});

describe('runAccountDelete · auth guards', () => {
  it('returns 401-code on missing Authorization header', async () => {
    const { fetchImpl } = makeFetch({ userResult: { status: 200, body: { id: 'x' } } });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('no-jwt');
  });

  it('returns 401-code on empty bearer', async () => {
    const { fetchImpl } = makeFetch({ userResult: { status: 200, body: { id: 'x' } } });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer ' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('no-jwt');
  });

  it('returns bad-jwt when Supabase user lookup fails (401)', async () => {
    const { fetchImpl, calls } = makeFetch({
      userResult: { status: 401, body: { msg: 'invalid' } },
    });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer forged' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-jwt');
    // CRITICAL: no DELETEs fired on forged token.
    expect(calls.filter((c) => c.url.includes('/rest/v1/'))).toEqual([]);
    expect(calls.filter((c) => c.url.includes('/auth/v1/admin'))).toEqual([]);
  });

  it('returns bad-jwt when Supabase returns body with no id', async () => {
    const { fetchImpl } = makeFetch({ userResult: { status: 200, body: { id: '' } } });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer weird' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-jwt');
  });
});

describe('runAccountDelete · confirm token', () => {
  it('returns bad-confirm without { confirm: "DELETE" }', async () => {
    const { fetchImpl, calls } = makeFetch({ userResult: { status: 200, body: { id: 'u-1' } } });
    const r = await runAccountDelete(
      postReq({ confirm: 'delete' /* wrong case */ }, { authorization: 'Bearer good' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-confirm');
    // No DELETEs fired without correct confirm.
    expect(calls.filter((c) => c.url.includes('/rest/v1/'))).toEqual([]);
    expect(calls.filter((c) => c.url.includes('/auth/v1/admin'))).toEqual([]);
    // Note: the verify call also did NOT fire — confirm token is checked
    // before user lookup to avoid a probe-by-confirm attack.
    expect(calls.filter((c) => c.url.endsWith('/auth/v1/user'))).toEqual([]);
  });

  it('returns bad-json on malformed body', async () => {
    const { fetchImpl } = makeFetch({ userResult: { status: 200, body: { id: 'u-1' } } });
    const req = new Request('https://worker.test/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
      body: '{not-json',
    });
    const r = await runAccountDelete(req, ENV, { fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-json');
  });
});

describe('runAccountDelete · config + cascade failures', () => {
  it('returns config-missing when SUPABASE_URL absent', async () => {
    const { fetchImpl } = makeFetch({ userResult: { status: 200, body: { id: 'x' } } });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer ok' }),
      { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: 'sr' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('config-missing');
  });

  it('returns config-missing when service-role absent', async () => {
    const { fetchImpl } = makeFetch({ userResult: { status: 200, body: { id: 'x' } } });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer ok' }),
      { SUPABASE_URL: 'https://supa', SUPABASE_SERVICE_ROLE_KEY: '' },
      { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('config-missing');
  });

  it('mid-cascade failure → cascade-failed with partial, auth.users NEVER deleted', async () => {
    const { fetchImpl, calls } = makeFetch({
      userResult: { status: 200, body: { id: 'u-1' } },
      tableResults: {
        encrypted_state: { status: 200, body: [{ id: 'a' }] },
        // finance_records is 2nd in USER_SCOPED_TABLES; simulate a 500 here.
        finance_records: { status: 500, body: { msg: 'db down' } },
      },
    });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('cascade-failed');
    expect(r.partial?.failed_table).toBe('finance_records');
    expect(r.partial?.deleted_tables).toEqual(['encrypted_state']);
    expect(r.partial?.deleted_rows.encrypted_state).toBe(1);
    expect(r.partial?.auth_user_deleted).toBe(false);
    // CRITICAL: admin user delete did NOT fire.
    expect(calls.find((c) => c.url.includes('/auth/v1/admin/users/'))).toBeUndefined();
  });

  it('auth-delete failure → cascade preserved, auth_user_deleted=false', async () => {
    const { fetchImpl, calls } = makeFetch({
      userResult: { status: 200, body: { id: 'u-1' } },
      tableResults: Object.fromEntries(
        USER_SCOPED_TABLES.map((t) => [t.table, { status: 200, body: [{ id: 'x' }] }]),
      ),
      adminDeleteResult: { status: 500, body: { msg: 'gotrue 5xx' } },
    });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV, { fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('auth-delete-failed');
    expect(r.partial?.deleted_tables).toEqual(USER_SCOPED_TABLES.map((t) => t.table));
    expect(r.partial?.auth_user_deleted).toBe(false);
    // admin call was attempted (just failed).
    expect(calls.find((c) => c.url.includes('/auth/v1/admin/users/'))).toBeDefined();
  });
});

describe('runAccountDelete · request body never leaks service-role', () => {
  it('does not echo service-role secret back to caller in any response field', async () => {
    const { fetchImpl } = makeFetch({
      userResult: { status: 200, body: { id: 'u-1' } },
      tableResults: Object.fromEntries(
        USER_SCOPED_TABLES.map((t) => [t.table, { status: 200, body: [] }]),
      ),
    });
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV, { fetchImpl },
    );
    const serialised = JSON.stringify(r);
    expect(serialised).not.toContain('sr-secret');
  });
});
