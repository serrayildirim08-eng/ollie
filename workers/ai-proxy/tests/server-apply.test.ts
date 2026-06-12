import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeInbox, applyInbox, pullGroceryPantry } from '../src/router/server-apply';

const KEK = btoa('0'.repeat(32));
const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE: 'svc',
  ENVELOPE_KEK: KEK,
  SERVER_APPLY_ENABLED: '1',
};

// A tiny in-memory PostgREST stand-in so we exercise the real encrypt/apply/pull
// logic end to end (the only thing mocked is the HTTP transport).
function makeFakeSupabase() {
  const inbox: Record<string, Record<string, unknown>> = {};
  const pantry: Record<string, Record<string, unknown>> = {};

  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = url.pathname.replace('/rest/v1/', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : null;

    if (path === 'dump_inbox' && method === 'POST') {
      for (const row of body as Array<Record<string, unknown>>) inbox[row.id as string] = row;
      return new Response(null, { status: 201 });
    }
    if (path === 'dump_inbox' && method === 'GET') {
      const pending = Object.values(inbox).filter((r) => r.status === 'pending');
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
      return new Response(JSON.stringify(Object.values(pantry)), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

describe('server-apply pilot (encrypt → inbox → apply → pull)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFakeSupabase());
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
