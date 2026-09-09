import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeInbox, applyInbox, pullGroceryPantry } from '../src/router/server-apply';
import { envelopeEncrypt } from '../src/crypto/envelope';

const KEK = btoa('0'.repeat(32));
const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE: 'svc',
  ENVELOPE_KEK: KEK,
  SERVER_APPLY_ENABLED: '1',
};

// A tiny in-memory PostgREST stand-in so we exercise the real encrypt/apply/pull
// logic end to end (the only thing mocked is the HTTP transport).
//
// Returns both the fetch impl AND the backing stores + a capture of every
// dump_inbox POST body, so tests can assert on the rows that were actually
// written (security PK shape) or corrupt a stored row (resilience).
function makeFakeSupabase() {
  const inbox: Record<string, Record<string, unknown>> = {};
  const pantry: Record<string, Record<string, unknown>> = {};
  // Every batch POSTed to dump_inbox, in order, so a test can inspect the
  // server-derived `id` of each row.
  const inboxPosts: Array<Array<Record<string, unknown>>> = [];

  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = url.pathname.replace('/rest/v1/', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : null;

    if (path === 'dump_inbox' && method === 'POST') {
      inboxPosts.push(body as Array<Record<string, unknown>>);
      for (const row of body as Array<Record<string, unknown>>) inbox[row.id as string] = row;
      return new Response(null, { status: 201 });
    }
    if (path === 'dump_inbox' && method === 'GET') {
      // Honour the user_id=eq.<id> filter so cross-user rows don't leak.
      const userFilter = url.searchParams.get('user_id')?.replace('eq.', '');
      const pending = Object.values(inbox).filter(
        (r) => r.status === 'pending' && (!userFilter || r.user_id === userFilter),
      );
      return new Response(JSON.stringify(pending), { status: 200 });
    }
    if (path === 'dump_inbox' && method === 'PATCH') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id && inbox[id]) Object.assign(inbox[id], body);
      return new Response(null, { status: 204 });
    }
    if (path === 'grocery_pantry' && method === 'POST') {
      for (const row of body as Array<Record<string, unknown>>) {
        pantry[`${row.user_id}:${row.id}`] = row;
      }
      return new Response(null, { status: 201 });
    }
    if (path === 'grocery_pantry' && method === 'GET') {
      const userFilter = url.searchParams.get('user_id')?.replace('eq.', '');
      const rows = Object.values(pantry).filter((r) => !userFilter || r.user_id === userFilter);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  return { fetchImpl, inbox, pantry, inboxPosts };
}

describe('server-apply pilot (encrypt → inbox → apply → pull)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFakeSupabase().fetchImpl);
  });

  it('round-trips a grocery dump through inbox → apply → pull, encrypted throughout', async () => {
    const userId = 'user-1';
    await writeInbox(ENV, userId, 'dump-abc', [
      { module: 'grocery', payload: { action: 'pantry_add', item: 'süt' } },
    ]);

    const applied = await applyInbox(ENV, userId);
    expect(applied.applied).toBe(1);

    const rows = await pullGroceryPantry(ENV, userId, null);
    expect(rows.length).toBe(1);
    expect(rows[0]?.payload.item).toBe('süt');
    expect(rows[0]?.deleted).toBe(false);
  });

  it('is idempotent: re-applying the same inbox does not double-apply', async () => {
    const userId = 'user-2';
    await writeInbox(ENV, userId, 'dump-xyz', [
      { module: 'grocery', payload: { action: 'pantry_add', item: 'eggs' } },
    ]);
    await applyInbox(ENV, userId); // first apply
    const second = await applyInbox(ENV, userId); // nothing pending now
    expect(second.applied).toBe(0);

    const rows = await pullGroceryPantry(ENV, userId, null);
    expect(rows.length).toBe(1); // not duplicated
  });

  it('is a no-op when the flag is off', async () => {
    const off = { ...ENV, SERVER_APPLY_ENABLED: '0' };
    await writeInbox(off, 'u', 'd', [{ module: 'grocery', payload: { item: 'x' } }]);
    const rows = await pullGroceryPantry(off, 'u', null);
    expect(rows.length).toBe(0);
  });
});

// ─── SECURITY: userId-namespaced inbox PK (cross-user collision unforgeable) ───
//
// writeInbox derives the dump_inbox row id as `${userId}:${dumpId}:${i}`. The
// fix that ships in this branch: the verified-JWT userId is part of the PK, so a
// client-chosen dumpId alone can NOT collide with — and via the on_conflict=id
// merge, overwrite — another user's inbox row. These tests inspect the rows that
// were actually POSTed to dump_inbox.
describe('server-apply · userId-namespaced inbox PK (security)', () => {
  it('prefixes each inbox row id with the authenticated userId', async () => {
    const fake = makeFakeSupabase();
    vi.stubGlobal('fetch', fake.fetchImpl);

    await writeInbox(ENV, 'user-A', 'dump-shared', [
      { module: 'grocery', payload: { action: 'pantry_add', item: 'milk' } },
      { module: 'grocery', payload: { action: 'pantry_add', item: 'eggs' } },
    ]);

    expect(fake.inboxPosts).toHaveLength(1);
    const rows = fake.inboxPosts[0];
    expect(rows).toHaveLength(2);
    // PK = `${userId}:${dumpId}:${i}` — userId is the unforgeable prefix.
    expect(rows[0].id).toBe('user-A:dump-shared:0');
    expect(rows[1].id).toBe('user-A:dump-shared:1');
    // The row also carries the verified user_id (used for the RLS-bypass scope).
    expect(rows[0].user_id).toBe('user-A');
  });

  it('two users with the SAME dumpId produce DIFFERENT ids (no collision)', async () => {
    const fake = makeFakeSupabase();
    vi.stubGlobal('fetch', fake.fetchImpl);

    const sameDumpId = 'dump-collide';
    await writeInbox(ENV, 'user-A', sameDumpId, [
      { module: 'grocery', payload: { action: 'pantry_add', item: 'milk' } },
    ]);
    await writeInbox(ENV, 'user-B', sameDumpId, [
      { module: 'grocery', payload: { action: 'pantry_add', item: 'milk' } },
    ]);

    const idA = fake.inboxPosts[0][0].id as string;
    const idB = fake.inboxPosts[1][0].id as string;
    expect(idA).toBe('user-A:dump-collide:0');
    expect(idB).toBe('user-B:dump-collide:0');
    // The whole point: identical client dumpId, distinct PKs → user-B can never
    // overwrite user-A's row via the on_conflict=id merge.
    expect(idA).not.toBe(idB);

    // And both rows coexist in the store (B did not clobber A).
    expect(fake.inbox[idA]).toBeDefined();
    expect(fake.inbox[idB]).toBeDefined();
    expect(Object.keys(fake.inbox)).toHaveLength(2);
  });
});

// ─── per-row resilience: one undecryptable pantry row must not fail the pull ───
//
// pullGroceryPantry wraps each row's envelopeDecrypt in try/catch and skips a
// row that fails, surfacing a console.warn instead of throwing. We force the
// failure by corrupting one stored row's ciphertext (AES-GCM auth-tag mismatch).
describe('server-apply · pullGroceryPantry per-row resilience', () => {
  it('skips an undecryptable row and still returns the healthy ones', async () => {
    const fake = makeFakeSupabase();
    vi.stubGlobal('fetch', fake.fetchImpl);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const userId = 'user-resilient';
    // Seed two healthy, properly-encrypted pantry rows directly in the store.
    const good1 = await envelopeEncrypt(KEK, { item: 'milk', action: 'pantry_add' });
    const good2 = await envelopeEncrypt(KEK, { item: 'eggs', action: 'pantry_add' });
    fake.pantry[`${userId}:id-good-1`] = {
      id: 'id-good-1',
      user_id: userId,
      ...good1,
      updated_at: '2026-06-01T00:00:00.000Z',
      deleted: false,
    };
    fake.pantry[`${userId}:id-bad`] = {
      id: 'id-bad',
      user_id: userId,
      ...good2,
      // Corrupt the ciphertext so AES-GCM decrypt throws (auth-tag mismatch).
      ciphertext: btoa('this-is-not-valid-ciphertext-at-all'),
      updated_at: '2026-06-01T00:00:01.000Z',
      deleted: false,
    };

    const rows = await pullGroceryPantry(ENV, userId, null);

    // The bad row was skipped, the good one survived — no throw.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('id-good-1');
    expect(rows[0].payload.item).toBe('milk');
    // The skip was surfaced (dead-letter visibility), not swallowed silently.
    expect(warn).toHaveBeenCalled();
    const warnedAboutBad = warn.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('id-bad')),
    );
    expect(warnedAboutBad).toBe(true);

    warn.mockRestore();
  });
});
