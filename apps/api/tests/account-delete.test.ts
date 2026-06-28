/**
 * apps/api · /account/delete worker — v2 tests
 *
 * The headline test SEEDS rows in EVERY user-scoped table (an in-memory fake
 * PostgREST) and ASSERTS the user's rows are gone (count → 0) after delete —
 * the opposite of the rejected v1 test, which asserted the core data tables
 * were skipped. Both the clerk-identity (live) and legacy supabase-uuid paths
 * are covered, plus the loud-fail guards (salt-missing, identity-config-missing)
 * that prevent a fake "your data is deleted" success.
 */

import { describe, it, expect } from 'vitest';
import {
  runAccountDelete,
  deriveUserHash,
  isUuid,
  USER_SCOPED_TABLES,
  type AccountDeleteEnv,
  type VerifiedIdentity,
} from '../src/account-delete';

const SALT = 'test-salt-value';
const ENV: AccountDeleteEnv = {
  SUPABASE_URL: 'https://supa.test',
  SUPABASE_SERVICE_ROLE_KEY: 'sr-secret',
  SUPABASE_ANON_KEY: 'anon-key',
  CLERK_ISSUER: 'https://clerk.test',
  CLERK_SECRET_KEY: 'sk_test_xxx',
  USER_HASH_SALT: SALT,
};

const CLERK_ID = 'user_2abcDEF';
const SUPA_UUID = '11111111-2222-3333-4444-555555555555';

interface CallLog {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * In-memory PostgREST + identity-delete fake.
 *
 * The DB is `Map<table, Row[]>`. Each row is keyed only by the identity
 * column(s) relevant to that table — enough to make DELETE-by-filter faithful.
 * DELETE removes matching rows and returns them (representation) so the handler
 * can count. After the run, tests inspect the remaining rows per table.
 */
class FakeDb {
  rows = new Map<string, Array<Record<string, string>>>();
  calls: CallLog[] = [];
  identityDeleteStatus = 204;
  /** Per-table forced HTTP status (to simulate a mid-cascade failure). */
  forceStatus: Record<string, number> = {};

  seed(table: string, list: Array<Record<string, string>>): void {
    this.rows.set(table, [...(this.rows.get(table) ?? []), ...list]);
  }

  remaining(table: string): number {
    return (this.rows.get(table) ?? []).length;
  }

  get fetchImpl(): typeof fetch {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers: Record<string, string> = {};
      const initHeaders = init?.headers as Record<string, string> | undefined;
      if (initHeaders) for (const [k, v] of Object.entries(initHeaders)) headers[k.toLowerCase()] = v;
      this.calls.push({ method: init?.method ?? 'GET', url: u, headers });

      // identity delete (Clerk or Supabase admin)
      if (u.includes('api.clerk.com/v1/users/') || u.includes('/auth/v1/admin/users/')) {
        return new Response(null, { status: this.identityDeleteStatus });
      }

      // table delete
      const m = u.match(/\/rest\/v1\/([^?]+)\?(.+)$/);
      if (m && (init?.method ?? '') === 'DELETE') {
        const table = m[1];
        const query = m[2];
        if (this.forceStatus[table]) {
          return new Response(JSON.stringify({ msg: 'forced' }), { status: this.forceStatus[table] });
        }
        const match = this.matcher(query);
        const all = this.rows.get(table) ?? [];
        const kept = all.filter((r) => !match(r));
        const removed = all.filter((r) => match(r));
        this.rows.set(table, kept);
        return new Response(JSON.stringify(removed), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
  }

  /** Parse a PostgREST filter into a row predicate. */
  private matcher(query: string): (row: Record<string, string>) => boolean {
    const decoded = decodeURIComponent(query);
    // or=(a.eq.X,b.eq.X)
    const orMatch = decoded.match(/^or=\((.+)\)$/);
    if (orMatch) {
      const clauses = orMatch[1].split(',').map((c) => {
        const [col, , val] = c.split('.');
        return { col, val };
      });
      return (row) => clauses.some((cl) => row[cl.col] === cl.val);
    }
    // col=eq.X
    const eqMatch = decoded.match(/^([^=]+)=eq\.(.+)$/);
    if (eqMatch) {
      const col = eqMatch[1];
      const val = eqMatch[2];
      return (row) => row[col] === val;
    }
    return () => false;
  }
}

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://worker.test/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Seed exactly the user's rows in every covered table. Returns expected counts. */
async function seedAllTables(
  db: FakeDb,
  userId: string,
  includeLegacyUuid: boolean,
): Promise<Record<string, number>> {
  const hash = await deriveUserHash(userId, SALT);
  const expected: Record<string, number> = {};
  for (const t of USER_SCOPED_TABLES) {
    if (t.key === 'legacy-uuid' && !includeLegacyUuid) continue;
    const value = t.key === 'hash' ? hash : userId;
    // seed 2 of the user's rows + 1 other user's row (must survive)
    const mine = [0, 1].map(() => {
      const row: Record<string, string> = {};
      row[t.columns[0]] = value;
      return row;
    });
    const other: Record<string, string> = {};
    other[t.columns[0]] = t.key === 'hash' ? 'someone-else-hash' : 'user_other';
    db.seed(t.table, [...mine, other]);
    expected[t.table] = 2;
  }
  return expected;
}

describe('runAccountDelete · seeds + erases EVERY user table (clerk identity)', () => {
  it('deletes the user rows from all clerk + hash tables and leaves other users intact', async () => {
    const db = new FakeDb();
    const expected = await seedAllTables(db, CLERK_ID, /* includeLegacyUuid */ false);

    const verifyIdentity = async (): Promise<VerifiedIdentity | null> => ({
      userId: CLERK_ID,
      identity: 'clerk',
    });

    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity).toBe('clerk');
    expect(r.user_id).toBe(CLERK_ID);

    // Every clerk + hash table was deleted from, with the seeded count.
    for (const t of USER_SCOPED_TABLES) {
      if (t.key === 'legacy-uuid') {
        // profiles: transparently skipped for a clerk identity, NOT claimed.
        expect(r.deleted_tables).not.toContain(t.table);
        expect(r.skipped_tables[t.table]).toBeTruthy();
        continue;
      }
      expect(r.deleted_tables).toContain(t.table);
      expect(r.deleted_rows[t.table]).toBe(expected[t.table]);
      // CRITICAL: the user's rows are gone…
      const other = t.columns[0];
      const remaining = (db.rows.get(t.table) ?? []);
      const userValue = t.key === 'hash' ? undefined : CLERK_ID;
      expect(remaining.filter((row) => row[other] === userValue).length).toBe(0);
      // …and exactly the other user's 1 row survives.
      expect(remaining.length).toBe(1);
    }

    // hash tables: confirm the user's hash rows are gone (recompute the hash).
    const hash = await deriveUserHash(CLERK_ID, SALT);
    for (const t of USER_SCOPED_TABLES.filter((x) => x.key === 'hash')) {
      const remaining = db.rows.get(t.table) ?? [];
      expect(remaining.some((row) => t.columns.some((c) => row[c] === hash))).toBe(false);
    }

    // Identity deleted LAST via Clerk.
    expect(r.auth_user_deleted).toBe(true);
    const identityIdx = db.calls.findIndex((c) => c.url.includes('api.clerk.com/v1/users/'));
    expect(identityIdx).toBe(db.calls.length - 1);
    expect(db.calls[identityIdx].headers.authorization).toBe('Bearer sk_test_xxx');
    expect(db.calls[identityIdx].url).toContain(encodeURIComponent(CLERK_ID));

    // Every data DELETE used service-role, never leaked elsewhere.
    const tableCalls = db.calls.filter((c) => c.url.includes('/rest/v1/'));
    expect(tableCalls.length).toBe(USER_SCOPED_TABLES.length - 1); // minus profiles (skipped)
    for (const c of tableCalls) {
      expect(c.method).toBe('DELETE');
      expect(c.headers.authorization).toBe('Bearer sr-secret');
      expect(c.headers.apikey).toBe('sr-secret');
    }
  });
});

describe('runAccountDelete · legacy supabase-uuid identity also erases profiles', () => {
  it('deletes from every table INCLUDING profiles when the identity is a uuid', async () => {
    const db = new FakeDb();
    await seedAllTables(db, SUPA_UUID, /* includeLegacyUuid */ true);
    expect(isUuid(SUPA_UUID)).toBe(true);

    const verifyIdentity = async (): Promise<VerifiedIdentity | null> => ({
      userId: SUPA_UUID,
      identity: 'supabase',
    });

    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity).toBe('supabase');
    // profiles WAS deleted for the uuid identity.
    expect(r.deleted_tables).toContain('profiles');
    expect(r.deleted_rows.profiles).toBe(2);
    expect(db.remaining('profiles')).toBe(1); // other user survives

    // ALL tables now have zero of this user's rows.
    for (const t of USER_SCOPED_TABLES) {
      const remaining = db.rows.get(t.table) ?? [];
      const userValue =
        t.key === 'hash' ? await deriveUserHash(SUPA_UUID, SALT) : SUPA_UUID;
      expect(remaining.some((row) => t.columns.some((c) => row[c] === userValue))).toBe(false);
    }

    // Identity removed via GoTrue admin (uuid path), LAST.
    const idx = db.calls.findIndex((c) => c.url.includes('/auth/v1/admin/users/'));
    expect(idx).toBe(db.calls.length - 1);
    expect(db.calls.some((c) => c.url.includes('api.clerk.com'))).toBe(false);
  });
});

describe('runAccountDelete · two-sided tables match either column', () => {
  it('erases partner_pairs / invites rows where the user is on EITHER side', async () => {
    const db = new FakeDb();
    const hash = await deriveUserHash(CLERK_ID, SALT);
    // user on the "hi" side of a pair, and the "invitee" side of an invite
    db.seed('partner_pairs', [{ user_lo: 'user_other', user_hi: CLERK_ID }]);
    db.seed('invites', [{ inviter_user_hash: 'someone-else-hash', invitee_user_hash: hash }]);
    // plus the user on the "lo"/"inviter" side
    db.seed('partner_pairs', [{ user_lo: CLERK_ID, user_hi: 'user_other2' }]);
    db.seed('invites', [{ inviter_user_hash: hash, invitee_user_hash: 'someone-else-hash2' }]);

    const verifyIdentity = async (): Promise<VerifiedIdentity | null> => ({
      userId: CLERK_ID,
      identity: 'clerk',
    });

    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deleted_rows.partner_pairs).toBe(2);
    expect(r.deleted_rows.invites).toBe(2);
    expect(db.remaining('partner_pairs')).toBe(0);
    expect(db.remaining('invites')).toBe(0);
  });
});

describe('runAccountDelete · loud-fail guards (no fake success)', () => {
  it('refuses (salt-missing) when USER_HASH_SALT is unset — would miss hash tables', async () => {
    const db = new FakeDb();
    await seedAllTables(db, CLERK_ID, false);
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      { ...ENV, USER_HASH_SALT: undefined },
      { fetchImpl: db.fetchImpl, verifyIdentity: async () => ({ userId: CLERK_ID, identity: 'clerk' }) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('salt-missing');
    // CRITICAL: nothing was deleted.
    expect(db.calls.filter((c) => c.url.includes('/rest/v1/'))).toEqual([]);
  });

  it('refuses (identity-config-missing) when a clerk user arrives but CLERK_SECRET_KEY is unset', async () => {
    const db = new FakeDb();
    await seedAllTables(db, CLERK_ID, false);
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      { ...ENV, CLERK_SECRET_KEY: undefined },
      { fetchImpl: db.fetchImpl, verifyIdentity: async () => ({ userId: CLERK_ID, identity: 'clerk' }) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('identity-config-missing');
    // CRITICAL: no data deleted before we knew we could remove the login.
    expect(db.calls.filter((c) => c.url.includes('/rest/v1/'))).toEqual([]);
  });
});

describe('runAccountDelete · auth + confirm guards', () => {
  it('401-code on missing Authorization header', async () => {
    const db = new FakeDb();
    const r = await runAccountDelete(postReq({ confirm: 'DELETE' }), ENV, {
      fetchImpl: db.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no-jwt');
  });

  it('401-code on empty bearer', async () => {
    const db = new FakeDb();
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer ' }),
      ENV,
      { fetchImpl: db.fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no-jwt');
  });

  it('bad-jwt when neither Clerk nor Supabase verifies the token (no deletes)', async () => {
    const db = new FakeDb();
    await seedAllTables(db, CLERK_ID, false);
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer forged' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity: async () => null },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-jwt');
    expect(db.calls.filter((c) => c.url.includes('/rest/v1/'))).toEqual([]);
  });

  it('bad-confirm without { confirm: "DELETE" } (no verify, no deletes)', async () => {
    const db = new FakeDb();
    let verifyCalled = false;
    const r = await runAccountDelete(
      postReq({ confirm: 'delete' }, { authorization: 'Bearer good' }),
      ENV,
      {
        fetchImpl: db.fetchImpl,
        verifyIdentity: async () => {
          verifyCalled = true;
          return { userId: CLERK_ID, identity: 'clerk' };
        },
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-confirm');
    expect(verifyCalled).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it('bad-json on malformed body', async () => {
    const db = new FakeDb();
    const req = new Request('https://worker.test/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
      body: '{not-json',
    });
    const r = await runAccountDelete(req, ENV, { fetchImpl: db.fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad-json');
  });

  it('config-missing when SUPABASE_URL absent', async () => {
    const db = new FakeDb();
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer ok' }),
      { ...ENV, SUPABASE_URL: '' },
      { fetchImpl: db.fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('config-missing');
  });
});

describe('runAccountDelete · cascade + identity failures', () => {
  it('mid-cascade failure → cascade-failed with partial, identity NOT deleted', async () => {
    const db = new FakeDb();
    await seedAllTables(db, CLERK_ID, false);
    // first table in the list will hard-fail
    const firstTable = USER_SCOPED_TABLES[0].table;
    db.forceStatus[firstTable] = 500;

    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity: async () => ({ userId: CLERK_ID, identity: 'clerk' }) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('cascade-failed');
    expect(r.partial?.failed_table).toBe(firstTable);
    expect(r.partial?.auth_user_deleted).toBe(false);
    // identity delete never fired
    expect(db.calls.some((c) => c.url.includes('api.clerk.com'))).toBe(false);
  });

  it('identity delete failure → auth-delete-failed, data already erased', async () => {
    const db = new FakeDb();
    await seedAllTables(db, CLERK_ID, false);
    db.identityDeleteStatus = 500;

    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity: async () => ({ userId: CLERK_ID, identity: 'clerk' }) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('auth-delete-failed');
    expect(r.partial?.auth_user_deleted).toBe(false);
    expect(db.calls.some((c) => c.url.includes('api.clerk.com'))).toBe(true);
  });

  it('404 from identity delete is treated as idempotent success', async () => {
    const db = new FakeDb();
    await seedAllTables(db, CLERK_ID, false);
    db.identityDeleteStatus = 404;
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity: async () => ({ userId: CLERK_ID, identity: 'clerk' }) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.auth_user_deleted).toBe(true);
  });
});

describe('runAccountDelete · never leaks service-role', () => {
  it('does not echo the service-role secret in any response field', async () => {
    const db = new FakeDb();
    await seedAllTables(db, CLERK_ID, false);
    const r = await runAccountDelete(
      postReq({ confirm: 'DELETE' }, { authorization: 'Bearer good' }),
      ENV,
      { fetchImpl: db.fetchImpl, verifyIdentity: async () => ({ userId: CLERK_ID, identity: 'clerk' }) },
    );
    expect(JSON.stringify(r)).not.toContain('sr-secret');
  });
});

describe('isUuid', () => {
  it('distinguishes Clerk ids from Supabase uuids', () => {
    expect(isUuid(SUPA_UUID)).toBe(true);
    expect(isUuid(CLERK_ID)).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
