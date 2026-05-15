/**
 * apps/web · account-boot — research pipeline boot test
 *
 * Regression guard for the Sprint B' bug: the free-text research pipeline
 * (`research:row_written` → scrub → POST /label → research_corpus) was BUILT
 * but its orchestrator was never booted, so every emit fell on the floor.
 *
 * This test asserts:
 *   1. After sign-in, `getAccount().researchOrchestrator` is a real, non-null
 *      orchestrator — i.e. it IS in the boot sequence.
 *   2. It boots with a REAL labelClient: emitting `research:row_written` with
 *      consent granted drives an actual POST to `${VITE_AI_WORKER_URL}/label`
 *      carrying PII-scrubbed text (the on-device scrubber ran).
 *   3. Sign-out tears it down.
 *
 * `@ollie/auth` + `@ollie/sync` are mocked so bootAccount() runs cheaply
 * without a Supabase backend; the orchestrator + labelClient + consent +
 * pii-scrub are all REAL so the boot wiring is exercised end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── hoisted shared state ───────────────────────────────────────────────────
// vi.mock factories run BEFORE the module body, so any mutable state they
// reference must come from vi.hoisted(). The worker URL is injected straight
// into bootAccount({ aiWorkerUrl }) below — Vite gives each module its own
// frozen import.meta.env, so stubbing the env from a test file never reaches
// account-boot.
const h = vi.hoisted(() => {
  const fakeSession = {
    user_id: 'user-abc-123',
    access_token: 'jwt-xyz',
    signed_in_at: new Date().toISOString(),
  };
  // Mutable across tests — the mocked auth client reads `authState` live.
  const authState: { session: typeof fakeSession | null; unlocked: boolean } = {
    session: null,
    unlocked: false,
  };
  return { fakeSession, authState };
});

const WORKER_URL = 'https://ai-proxy.test.workers.dev';
const { fakeSession } = h;
const fakeKey = {} as CryptoKey;

// ─── auth mock — a controllable session + the real @ollie/events bus so
//     bootAccount()'s `auth:signed_in` listener fires for real. ──────────────
vi.mock('@ollie/auth', () => ({
  createAuthClient: () => ({
    state: () => h.authState,
    encryptionKey: () => (h.authState.unlocked ? fakeKey : null),
  }),
}));

vi.mock('@ollie/sync', () => ({
  createSyncClient: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
  createFinanceSyncClient: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
}));

import * as events from '@ollie/events';
import {
  configureConsent,
  setConsent,
  _resetConsent,
  type ConsentStoreAdapter,
} from '@ollie/consent';
import { bootAccount, getAccount, _resetAccountBoot } from './account-boot';

function consentAdapter(): ConsentStoreAdapter {
  const m = new Map<string, unknown>();
  const key = (mod: string, k: string) => `${mod}.${k}`;
  return {
    get<T>(mod: string, k: string, defaultValue?: T): T {
      const v = m.get(key(mod, k));
      return (v === undefined ? (defaultValue as T) : (v as T));
    },
    set<T>(mod: string, k: string, value: T): void {
      m.set(key(mod, k), value);
    },
  };
}

/**
 * Drive the `auth:signed_in` handler to completion. The handler does
 * `void attachSync()` (fire-and-forget async), and attachSync awaits the
 * sync clients before booting the research orchestrator — so the boot
 * lands a few microtasks after the synchronous emit() returns.
 */
async function signIn(): Promise<void> {
  h.authState.session = fakeSession;
  h.authState.unlocked = true;
  events.emit('auth:signed_in', { user_id: fakeSession.user_id, ts: Date.now() });
  // Flush the attachSync() promise chain (createSyncClient.start mocks
  // resolve immediately, so a handful of microtask turns is enough).
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('account-boot · research pipeline', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetConsent();
    h.authState.session = null;
    h.authState.unlocked = false;
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ corpus_id: 'corpus-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    _resetConsent();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Drop the singleton + tear down the orchestrator's event-bus
    // subscription + 60s flush timer so nothing leaks into other tests.
    _resetAccountBoot();
  });

  it('boots the research orchestrator into the account handles after sign-in', async () => {
    bootAccount({ aiWorkerUrl: WORKER_URL });
    expect(getAccount()).not.toBeNull();
    // Pre-auth: no orchestrator (no user id for the consent gate yet).
    expect(getAccount()?.researchOrchestrator).toBeNull();

    // Simulate a completed sign-in.
    await signIn();

    expect(getAccount()?.researchOrchestrator).not.toBeNull();
  });

  it('drives a real /label POST with scrubbed text when consent is granted', async () => {
    vi.useFakeTimers();

    // Real consent layer, opted in.
    configureConsent({ store: consentAdapter() });
    await setConsent(fakeSession.user_id, { research_optin: true });

    bootAccount({ aiWorkerUrl: WORKER_URL });
    await signIn();
    expect(getAccount()?.researchOrchestrator).not.toBeNull();

    // A user writes a scrubbable row containing PII.
    events.emit('research:row_written', {
      row_id: 'bd-1',
      table: 'brain_dump_log',
      text: 'call dr smith about the invoice, email me at someone@example.com',
      locale: 'en',
      sector_hint: 'med',
      ts: Date.now(),
    });

    // Advance past the 60s batch flush window + drain the async flush.
    await vi.advanceTimersByTimeAsync(61_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/label`);
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string) as {
      scrubbed_text: string;
      sector_hint?: string;
      locale: string;
    };
    expect(body.locale).toBe('en');
    expect(body.sector_hint).toBe('med');
    // PII scrubber ran on-device: the raw email must NOT reach the worker.
    expect(body.scrubbed_text).not.toContain('someone@example.com');
    expect(body.scrubbed_text).toContain('[EMAIL]');
  });

  it('does not POST when the user has not opted in', async () => {
    vi.useFakeTimers();
    configureConsent({ store: consentAdapter() });
    await setConsent(fakeSession.user_id, { research_optin: false });

    bootAccount({ aiWorkerUrl: WORKER_URL });
    await signIn();

    events.emit('research:row_written', {
      row_id: 'bd-2',
      table: 'brain_dump_log',
      text: 'a perfectly ordinary brain dump entry with enough words',
      locale: 'en',
      ts: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(61_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
