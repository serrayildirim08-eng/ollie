/**
 * @ollie/auth · S4 — secret leakage in error logs.
 *
 * `uploadProfileToSupabase`'s catch used to `console.warn(..., err)` with
 * the RAW error object. That object can carry the failed fetch Request
 * (with `Authorization: Bearer <jwt>`) or the profile body
 * (`encrypted_server_pw`). Those would land in console / Sentry
 * breadcrumbs.
 *
 * These tests prove:
 *   1. `safeErrSummary` never echoes secret-shaped fields.
 *   2. A failing profile upload during signUp logs only a safe summary —
 *      no JWT, no ciphertext — and never passes a raw object to console.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createAuthClient, safeErrSummary } from '../src/index';
import type { OllieAPI } from '@ollie/api';

describe('auth · S4 · safeErrSummary', () => {
  it('keeps only message + status/code — drops every other field', () => {
    const leaky = {
      name: 'SupabaseError',
      message: 'upsert rejected',
      status: 409,
      code: 'PGRST301',
      // secret-bearing fields that MUST NOT appear in the summary:
      config: { headers: { Authorization: 'Bearer eyJSECRETJWT' } },
      request: { body: '{"encrypted_server_pw":"CIPHERTEXT_SECRET"}' },
      response: { data: 'leak-me' },
    };
    const summary = safeErrSummary(leaky);
    expect(summary).toContain('upsert rejected');
    expect(summary).toContain('status=409');
    expect(summary).toContain('code=PGRST301');
    // No secret material.
    expect(summary).not.toContain('Bearer');
    expect(summary).not.toContain('eyJSECRETJWT');
    expect(summary).not.toContain('encrypted_server_pw');
    expect(summary).not.toContain('CIPHERTEXT_SECRET');
    expect(summary).not.toContain('leak-me');
  });

  it('handles a thrown string, null, and non-error values without leaking', () => {
    expect(safeErrSummary('plain error')).toBe('plain error');
    expect(safeErrSummary(null)).toBe('unknown error');
    expect(safeErrSummary(42)).toBe('non-error thrown value');
  });

  it('truncates an over-long message', () => {
    const long = 'x'.repeat(5000);
    expect(safeErrSummary(new Error(long)).length).toBeLessThan(300);
  });

  it('a real Error object yields just its message', () => {
    const summary = safeErrSummary(new Error('boom'));
    expect(summary).toBe('boom');
  });
});

describe('auth · S4 · profile upload failure logs no secrets', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeApiWithFailingUpsert(): OllieAPI {
    return {
      request: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropic: { proxyUrl: null, route: vi.fn() as any },
      supabase: {
        url: 'https://x.supabase.co',
        anonKey: 'anon',
        rest: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          get: vi.fn(async () => ({ ok: true, status: 200, data: [] })) as any,
          // upsert throws a leaky error object — exactly the S4 hazard.
          upsert: vi.fn(async () => {
            throw {
              name: 'FetchError',
              message: 'network unreachable',
              status: 503,
              config: { headers: { Authorization: 'Bearer eyJLEAKEDJWT' } },
              body: '{"encrypted_server_pw":"SECRET_CIPHERTEXT"}',
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete: vi.fn() as any,
        },
        /* eslint-disable @typescript-eslint/no-explicit-any */
        auth: {
          signUp: vi.fn(async (_e: string, _p: string) => ({
            ok: true,
            status: 200,
            data: { user: { id: 'user-1' }, session: { access_token: 'a', refresh_token: 'r' } },
          })) as any,
          signInWithPassword: vi.fn() as any,
          refresh: vi.fn() as any,
          signOut: vi.fn() as any,
        },
        /* eslint-enable @typescript-eslint/no-explicit-any */
      },
    };
  }

  it('signUp with a failing upsert logs only a safe summary — no JWT, no ciphertext', async () => {
    const auth = createAuthClient({ store, api: makeApiWithFailingUpsert(), now: () => 1000 });
    const r = await auth.signUp({
      email: 'serra@example.com',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: true,
    });
    // signUp itself still succeeds — the profile upload is best-effort.
    expect(r.ok).toBe(true);

    // Let the fire-and-forget uploadProfileToSupabase settle.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((res) => setTimeout(res, 0));

    expect(warnSpy).toHaveBeenCalled();
    // Inspect EVERY argument of EVERY console.warn call.
    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        // No raw object should ever be passed — only strings.
        expect(typeof arg).toBe('string');
        const s = String(arg);
        expect(s).not.toContain('Bearer');
        expect(s).not.toContain('eyJLEAKEDJWT');
        expect(s).not.toContain('encrypted_server_pw');
        expect(s).not.toContain('SECRET_CIPHERTEXT');
      }
    }
    // The safe summary still carries diagnostic value.
    const flattened = warnSpy.mock.calls.flat().join(' ');
    expect(flattened).toContain('network unreachable');
  });
});
