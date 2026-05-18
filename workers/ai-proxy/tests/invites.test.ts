/**
 * Tests for invites endpoints:
 *   - generate-invite: auth required, rate limit, code shape, Supabase POST
 *   - validate-invite: not_found / used / expired / valid
 *   - claim-invite: atomic PATCH, second claim returns reason='used'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGenerateInvite,
  handleValidateInvite,
  handleClaimInvite,
  makeCode,
  checkInviteRate,
} from '../src/invites';

const SUPABASE_URL = 'https://example.supabase.co';
const SUPABASE_SERVICE_ROLE = 'service-role-fake';
const SUPABASE_ANON_KEY = 'anon-fake';

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true } as unknown as KVNamespaceListResult<unknown>;
    },
  } as unknown as KVNamespace;
}

function makeEnv() {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE,
    SUPABASE_ANON_KEY,
    INVITE_BASE_URL: 'https://ollie.app',
    RATE_KV: makeKv(),
  };
}

function makeReq(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.dev${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// Helper that returns a fetch mock with scripted responses.
function scriptFetch(handlers: Array<(url: string, init: RequestInit) => Promise<Response>>) {
  let i = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const fn = handlers[i++];
    if (!fn) throw new Error(`unexpected fetch call #${i} to ${String(input)}`);
    return fn(String(input), init ?? {});
  });
}

// ─── makeCode ─────────────────────────────────────────────────────────────────

describe('makeCode', () => {
  it('matches the olli-XXXX-YYYY pattern', () => {
    const code = makeCode();
    expect(code).toMatch(/^olli-[a-z0-9]{4}-[a-z0-9]{4}$/);
  });

  it('does NOT contain visually ambiguous chars 0/o/1/l/i in the random segments', () => {
    // The literal "olli-" prefix is exempt; only the two 4-char segments
    // are drawn from the disambiguated alphabet.
    for (let n = 0; n < 200; n++) {
      const code = makeCode();
      const [, a, b] = code.split('-');
      expect(a + b).not.toMatch(/[01loi]/);
    }
  });
});

// ─── /generate-invite ─────────────────────────────────────────────────────────

describe('handleGenerateInvite', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  it('rejects missing x-user-jwt with 401', async () => {
    const resp = await handleGenerateInvite(
      makeReq('/generate-invite', { inviter_user_hash: 'h' }),
      env,
    );
    expect(resp.status).toBe(401);
  });

  it('rejects invalid JWT with 401', async () => {
    const fetchSpy = scriptFetch([
      // /auth/v1/user → 401
      async () => new Response('', { status: 401 }),
    ]);
    const resp = await handleGenerateInvite(
      makeReq('/generate-invite', { inviter_user_hash: 'h' }, { 'x-user-jwt': 'bad' }),
      env,
    );
    expect(resp.status).toBe(401);
    fetchSpy.mockRestore();
  });

  it('rejects missing inviter_user_hash with 400', async () => {
    const fetchSpy = scriptFetch([
      async () => new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }),
    ]);
    const resp = await handleGenerateInvite(
      makeReq('/generate-invite', {}, { 'x-user-jwt': 'good' }),
      env,
    );
    expect(resp.status).toBe(400);
    fetchSpy.mockRestore();
  });

  it('returns code + share_url + expires_at on success', async () => {
    const fetchSpy = scriptFetch([
      async () => new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }),
      async (url, init) => {
        expect(url).toBe('https://example.supabase.co/rest/v1/invites');
        const body = JSON.parse(String(init.body)) as { code: string; inviter_user_hash: string };
        expect(body.code).toMatch(/^olli-[a-z0-9]{4}-[a-z0-9]{4}$/);
        expect(body.inviter_user_hash).toBe('hash-abc');
        return new Response(JSON.stringify([{ id: 1, code: body.code }]), { status: 201 });
      },
    ]);
    const resp = await handleGenerateInvite(
      makeReq('/generate-invite', { inviter_user_hash: 'hash-abc' }, { 'x-user-jwt': 'good' }),
      env,
    );
    expect(resp.status).toBe(200);
    const data = await resp.json() as { code: string; share_url: string; expires_at: string };
    expect(data.code).toMatch(/^olli-/);
    expect(data.share_url).toBe(`https://ollie.app/join/${data.code}`);
    expect(typeof data.expires_at).toBe('string');
    fetchSpy.mockRestore();
  });

  it('rate-limits after 5 invites in 24h', async () => {
    // Bump KV bucket to 5 first.
    const day = Math.floor(Date.now() / 1000 / 86400);
    await env.RATE_KV.put(`rl:invite:user-1:${day}`, '5');
    const fetchSpy = scriptFetch([
      async () => new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }),
    ]);
    const resp = await handleGenerateInvite(
      makeReq('/generate-invite', { inviter_user_hash: 'h' }, { 'x-user-jwt': 'good' }),
      env,
    );
    expect(resp.status).toBe(429);
    fetchSpy.mockRestore();
  });
});

// ─── /validate-invite ─────────────────────────────────────────────────────────

describe('handleValidateInvite', () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => { env = makeEnv(); });

  it('returns not_found when no row', async () => {
    const fetchSpy = scriptFetch([
      async () => new Response('[]', { status: 200 }),
    ]);
    const resp = await handleValidateInvite(
      makeReq('/validate-invite', { code: 'olli-abcd-efgh' }),
      env,
    );
    expect(resp.status).toBe(200);
    const data = await resp.json() as { valid: boolean; reason?: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe('not_found');
    fetchSpy.mockRestore();
  });

  it('returns reason=used when used_at is set', async () => {
    const fetchSpy = scriptFetch([
      async () => new Response(
        JSON.stringify([{ code: 'olli-abcd-efgh', used_at: '2026-05-13T00:00:00Z', expires_at: '2026-06-13T00:00:00Z' }]),
        { status: 200 },
      ),
    ]);
    const resp = await handleValidateInvite(
      makeReq('/validate-invite', { code: 'olli-abcd-efgh' }),
      env,
    );
    const data = await resp.json() as { valid: boolean; reason?: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe('used');
    fetchSpy.mockRestore();
  });

  it('returns reason=expired when expires_at is in the past', async () => {
    const fetchSpy = scriptFetch([
      async () => new Response(
        JSON.stringify([{ code: 'olli-abcd-efgh', used_at: null, expires_at: '2020-01-01T00:00:00Z' }]),
        { status: 200 },
      ),
    ]);
    const resp = await handleValidateInvite(
      makeReq('/validate-invite', { code: 'olli-abcd-efgh' }),
      env,
    );
    const data = await resp.json() as { valid: boolean; reason?: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe('expired');
    fetchSpy.mockRestore();
  });

  it('returns valid=true when unused + unexpired', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const fetchSpy = scriptFetch([
      async () => new Response(
        JSON.stringify([{ code: 'olli-abcd-efgh', used_at: null, expires_at: future }]),
        { status: 200 },
      ),
    ]);
    const resp = await handleValidateInvite(
      makeReq('/validate-invite', { code: 'olli-abcd-efgh' }),
      env,
    );
    const data = await resp.json() as { valid: boolean };
    expect(data.valid).toBe(true);
    fetchSpy.mockRestore();
  });
});

// ─── /claim-invite ────────────────────────────────────────────────────────────

describe('handleClaimInvite', () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => { env = makeEnv(); });

  it('rejects missing JWT with 401', async () => {
    const resp = await handleClaimInvite(
      makeReq('/claim-invite', { code: 'olli-abcd-efgh', invitee_user_hash: 'h' }),
      env,
    );
    expect(resp.status).toBe(401);
  });

  it('returns success=true when PATCH matches a row', async () => {
    const fetchSpy = scriptFetch([
      // auth
      async () => new Response(JSON.stringify({ id: 'user-2' }), { status: 200 }),
      // PATCH
      async (url, init) => {
        expect(url).toContain('used_at=is.null');
        expect(url).toContain('expires_at=gt.');
        expect(init.method).toBe('PATCH');
        const body = JSON.parse(String(init.body)) as { used_at: string; invitee_user_hash: string };
        expect(typeof body.used_at).toBe('string');
        expect(body.invitee_user_hash).toBe('hash-invitee');
        return new Response(JSON.stringify([{ code: 'olli-abcd-efgh' }]), { status: 200 });
      },
    ]);
    const resp = await handleClaimInvite(
      makeReq(
        '/claim-invite',
        { code: 'olli-abcd-efgh', invitee_user_hash: 'hash-invitee' },
        { 'x-user-jwt': 'good' },
      ),
      env,
    );
    const data = await resp.json() as { success: boolean };
    expect(data.success).toBe(true);
    fetchSpy.mockRestore();
  });

  it('returns reason=used on second claim', async () => {
    const fetchSpy = scriptFetch([
      // auth
      async () => new Response(JSON.stringify({ id: 'user-2' }), { status: 200 }),
      // PATCH returns empty array (no row matched the guard)
      async () => new Response('[]', { status: 200 }),
      // disambiguation lookup — row exists, used_at set
      async () => new Response(
        JSON.stringify([{ used_at: '2026-05-13T00:00:00Z', expires_at: '2026-06-13T00:00:00Z' }]),
        { status: 200 },
      ),
    ]);
    const resp = await handleClaimInvite(
      makeReq(
        '/claim-invite',
        { code: 'olli-abcd-efgh', invitee_user_hash: 'hash-invitee' },
        { 'x-user-jwt': 'good' },
      ),
      env,
    );
    const data = await resp.json() as { success: boolean; reason?: string };
    expect(data.success).toBe(false);
    expect(data.reason).toBe('used');
    fetchSpy.mockRestore();
  });

  it('returns reason=not_found when code does not exist', async () => {
    const fetchSpy = scriptFetch([
      async () => new Response(JSON.stringify({ id: 'user-2' }), { status: 200 }),
      async () => new Response('[]', { status: 200 }),
      async () => new Response('[]', { status: 200 }),
    ]);
    const resp = await handleClaimInvite(
      makeReq(
        '/claim-invite',
        { code: 'olli-zzzz-zzzz', invitee_user_hash: 'h' },
        { 'x-user-jwt': 'good' },
      ),
      env,
    );
    const data = await resp.json() as { success: boolean; reason?: string };
    expect(data.success).toBe(false);
    expect(data.reason).toBe('not_found');
    fetchSpy.mockRestore();
  });
});

// ─── S8 · PostgREST error bodies must not leak to the caller ──────────────────

describe('invites · S8 · upstream error bodies are not disclosed', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  // A realistic PostgREST error — it discloses table + constraint names.
  const POSTGREST_ERR = JSON.stringify({
    code: '42501',
    details: null,
    hint: null,
    message: 'permission denied for table invites',
  });

  it('generate-invite: a non-409 Supabase error returns a GENERIC code, no detail', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = scriptFetch([
      async () => new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }),
      // Supabase POST fails with a PostgREST 500 body.
      async () => new Response(POSTGREST_ERR, { status: 500 }),
    ]);
    const resp = await handleGenerateInvite(
      makeReq('/generate-invite', { inviter_user_hash: 'h' }, { 'x-user-jwt': 'good' }),
      env,
    );
    expect(resp.status).toBe(502);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.error).toBe('supabase_error');
    expect(typeof body.request_id).toBe('string');
    // The PostgREST schema detail must NOT reach the caller.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('permission denied');
    expect(serialized).not.toContain('invites');
    expect(serialized).not.toContain('42501');
    expect(body.detail).toBeUndefined();

    // ...but the full detail IS logged server-side, with the request id.
    const logLine = errSpy.mock.calls.flat().map(String).join(' ');
    expect(logLine).toContain('permission denied for table invites');
    expect(logLine).toContain(String(body.request_id));

    fetchSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('claim-invite: a Supabase error returns a GENERIC code, no detail', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = scriptFetch([
      async () => new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }),
      // PATCH fails with a PostgREST error body.
      async () => new Response(POSTGREST_ERR, { status: 500 }),
    ]);
    const resp = await handleClaimInvite(
      makeReq(
        '/claim-invite',
        { code: 'olli-abcd-efgh', invitee_user_hash: 'h' },
        { 'x-user-jwt': 'good' },
      ),
      env,
    );
    expect(resp.status).toBe(502);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.error).toBe('supabase_error');
    expect(typeof body.request_id).toBe('string');
    expect(JSON.stringify(body)).not.toContain('permission denied');
    expect(body.detail).toBeUndefined();
    fetchSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── checkInviteRate ──────────────────────────────────────────────────────────

describe('checkInviteRate', () => {
  it('allows up to 5 in the same 24h window', async () => {
    const kv = makeKv();
    for (let i = 0; i < 5; i++) {
      expect(await checkInviteRate(kv, 'user-x')).toBe(true);
    }
    expect(await checkInviteRate(kv, 'user-x')).toBe(false);
  });

  it('keeps separate buckets per user', async () => {
    const kv = makeKv();
    for (let i = 0; i < 5; i++) await checkInviteRate(kv, 'user-a');
    expect(await checkInviteRate(kv, 'user-a')).toBe(false);
    expect(await checkInviteRate(kv, 'user-b')).toBe(true);
  });
});
