/**
 * @ollie/auth · Pattern A · zero-knowledge assertion (Sprint 5 · F1)
 *
 * Spies on EVERY supabase-js call argument and FAILS if the raw user
 * passphrase appears anywhere — string, nested object, header, body,
 * any depth. If this test ever goes red, the constitutional
 * zero-knowledge invariant is broken and shipping is blocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createAuthClient } from '../src/index';
import type { OllieAPI } from '@ollie/api';

/** Deep search: does ANY string value in this tree contain the needle? */
function containsString(node: unknown, needle: string, seen = new WeakSet<object>()): boolean {
  if (node == null) return false;
  if (typeof node === 'string') return node.includes(needle);
  if (typeof node !== 'object') return false;
  if (seen.has(node as object)) return false;
  seen.add(node as object);
  if (Array.isArray(node)) {
    for (const item of node) if (containsString(item, needle, seen)) return true;
    return false;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (containsString(v, needle, seen)) return true;
  }
  return false;
}

interface CapturedCall {
  method: string;
  args: unknown[];
}

function makeSpyingSupabaseApi(captured: CapturedCall[], opts: { userId?: string; access_token?: string; refresh_token?: string } = {}): OllieAPI {
  const userId = opts.userId ?? 'user-zk';
  const session = { access_token: opts.access_token ?? 'tok', refresh_token: opts.refresh_token ?? 'ref' };

  function record(method: string, args: unknown[]): void {
    captured.push({ method, args });
  }

  return {
    request: vi.fn((...args: unknown[]) => {
      record('request', args);
      return Promise.resolve({ ok: false, error: { code: 'http', status: 500, message: 'unused' } });
    }) as unknown as OllieAPI['request'],
    anthropic: {
      proxyUrl: null,
      route: vi.fn((...args: unknown[]) => {
        record('anthropic.route', args);
        return Promise.resolve({ ok: false, error: { code: 'http', status: 500, message: 'unused' } });
      }) as unknown as OllieAPI['anthropic']['route'],
    },
    supabase: {
      url: 'https://x.supabase.co',
      anonKey: 'anon',
      rest: {
        get: vi.fn((...args: unknown[]) => {
          record('rest.get', args);
          return Promise.resolve({ ok: true, status: 200, data: [] });
        }) as unknown as OllieAPI['supabase']['rest']['get'],
        upsert: vi.fn((...args: unknown[]) => {
          record('rest.upsert', args);
          return Promise.resolve({ ok: true, status: 201, data: args[1] });
        }) as unknown as OllieAPI['supabase']['rest']['upsert'],
        delete: vi.fn((...args: unknown[]) => {
          record('rest.delete', args);
          return Promise.resolve({ ok: true, status: 200, data: null });
        }) as unknown as OllieAPI['supabase']['rest']['delete'],
      },
      auth: {
        signUp: vi.fn((...args: unknown[]) => {
          record('auth.signUp', args);
          return Promise.resolve({ ok: true, status: 200, data: { user: { id: userId }, session } });
        }) as unknown as OllieAPI['supabase']['auth']['signUp'],
        signInWithPassword: vi.fn((...args: unknown[]) => {
          record('auth.signInWithPassword', args);
          return Promise.resolve({ ok: true, status: 200, data: { user: { id: userId }, session } });
        }) as unknown as OllieAPI['supabase']['auth']['signInWithPassword'],
        refresh: vi.fn((...args: unknown[]) => {
          record('auth.refresh', args);
          return Promise.resolve({ ok: false, error: { code: 'http', status: 500, message: 'unused' } });
        }) as unknown as OllieAPI['supabase']['auth']['refresh'],
        signOut: vi.fn((...args: unknown[]) => {
          record('auth.signOut', args);
          return Promise.resolve({ ok: true, status: 200, data: null });
        }) as unknown as OllieAPI['supabase']['auth']['signOut'],
      },
    },
  };
}

let captured: CapturedCall[];
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  captured = [];
  store = createStore(createMemoryAdapter());
});

const PASSPHRASE = 'serra-loves-burhan-and-eggs-2026';

function assertNoPassphraseLeak(needle: string): void {
  for (const call of captured) {
    const leaked = containsString(call.args, needle);
    if (leaked) {
      throw new Error(
        `ZERO-KNOWLEDGE VIOLATION: passphrase string "${needle}" appeared in ${call.method} args. ` +
        `args: ${JSON.stringify(call.args)}`,
      );
    }
  }
}

describe('auth · zero-knowledge invariant', () => {
  it('signUp: passphrase NEVER appears in any supabase call argument', async () => {
    const auth = createAuthClient({ store, api: makeSpyingSupabaseApi(captured) });
    const r = await auth.signUp({
      email: 'serra@example.com',
      passphrase: PASSPHRASE,
      passphraseConfirm: PASSPHRASE,
      acknowledged_unrecoverable: true,
    });
    expect(r.ok).toBe(true);
    expect(captured.length).toBeGreaterThan(0);
    assertNoPassphraseLeak(PASSPHRASE);
  });

  it('signIn: passphrase NEVER appears in any supabase call argument', async () => {
    const auth = createAuthClient({ store, api: makeSpyingSupabaseApi(captured) });
    await auth.signUp({
      email: 'serra@example.com',
      passphrase: PASSPHRASE,
      passphraseConfirm: PASSPHRASE,
      acknowledged_unrecoverable: true,
    });
    await auth.signOut();
    captured = []; // only inspect signIn-time calls
    // re-bind the spy array in a new api so we capture only fresh calls
    const auth2 = createAuthClient({ store, api: makeSpyingSupabaseApi(captured) });
    const r = await auth2.signIn({ email: 'serra@example.com', passphrase: PASSPHRASE });
    expect(r.ok).toBe(true);
    assertNoPassphraseLeak(PASSPHRASE);
  });

  it('signIn with wrong passphrase: NO supabase call is made (decrypt-fail short-circuits)', async () => {
    const auth = createAuthClient({ store, api: makeSpyingSupabaseApi(captured) });
    await auth.signUp({
      email: 'serra@example.com',
      passphrase: PASSPHRASE,
      passphraseConfirm: PASSPHRASE,
      acknowledged_unrecoverable: true,
    });
    await auth.signOut();
    captured = [];
    const auth2 = createAuthClient({ store, api: makeSpyingSupabaseApi(captured) });
    const r = await auth2.signIn({
      email: 'serra@example.com',
      passphrase: 'wrong-wrong-wrong-wrong-wrong',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
    // Critical: NO supabase auth call happened. Wrong passphrase is
    // detected purely by local AES-GCM decrypt failure.
    const authCalls = captured.filter((c) => c.method.startsWith('auth.'));
    expect(authCalls.length).toBe(0);
  });
});
