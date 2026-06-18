/**
 * Audit finding #2 — the AI-cost endpoints /route/dump and /route/:module had
 * NO rate limit, so a single account could drain the Voyage + Groq/Gemini
 * budget by spamming dumps. This suite pins the per-user gate added to the
 * worker's fetch entrypoint.
 *
 * Strategy: drive the gate through the legacy KV fixed-window counter (no
 * AI_RATE_LIMITER binding present) with T0_JWT_ENFORCED='0' so the user id
 * comes straight from the `x-user-id` header — no JWKS mocking needed. The
 * gate runs BEFORE the handler, so an 11th request in the window is 429
 * before any AI work happens (we use an unknown module + empty dump body so
 * the handler itself would 404/400, never reaching an upstream AI call).
 */

import { describe, it, expect } from 'vitest';
import worker from '../src/index';

type WorkerEnv = Parameters<typeof worker.fetch>[1];

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
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
      } as unknown as KVNamespaceListResult<unknown>;
    },
  } as unknown as KVNamespace;
}

function makeEnv(): WorkerEnv {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-fake',
    CACHE_KV: makeKv(),
    RATE_KV: makeKv(),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-fake',
    SUPABASE_ANON_KEY: 'anon-fake',
    // Local-dev flag: skip Clerk JWKS verify so x-user-id is the rate key.
    T0_JWT_ENFORCED: '0',
    // No AI_RATE_LIMITER binding → exercise the deterministic KV fallback.
  } as unknown as WorkerEnv;
}

function makeReq(path: string, userId: string): Request {
  return new Request(`https://worker.dev${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
    },
    body: JSON.stringify({ text: '' }),
  });
}

const RATE_MAX = 10;

describe('audit #2 · /route/:module rate limit', () => {
  it('429s the 11th request in the window for one user', async () => {
    const env = makeEnv();
    const statuses: number[] = [];
    for (let i = 0; i < RATE_MAX + 1; i++) {
      // Unknown module so the handler short-circuits without an AI call; the
      // rate gate runs first, so the 11th call is 429 regardless.
      const resp = await worker.fetch(makeReq('/route/zzznotamodule', 'user-1'), env);
      statuses.push(resp.status);
    }
    // First 10 pass the gate (then 404 unknown_module); the 11th is rate-limited.
    expect(statuses.slice(0, RATE_MAX).every((s) => s !== 429)).toBe(true);
    expect(statuses[RATE_MAX]).toBe(429);
  });

  it('keys per user — a second user is not blocked by the first', async () => {
    const env = makeEnv();
    // Exhaust user-A's budget.
    for (let i = 0; i < RATE_MAX + 1; i++) {
      await worker.fetch(makeReq('/route/zzznotamodule', 'user-A'), env);
    }
    // user-B's first request must still pass the gate.
    const resp = await worker.fetch(makeReq('/route/zzznotamodule', 'user-B'), env);
    expect(resp.status).not.toBe(429);
  });
});

describe('audit #2 · /route/dump rate limit', () => {
  it('429s the 11th request in the window for one user', async () => {
    const env = makeEnv();
    const statuses: number[] = [];
    for (let i = 0; i < RATE_MAX + 1; i++) {
      const resp = await worker.fetch(makeReq('/route/dump', 'dumpuser-1'), env);
      statuses.push(resp.status);
    }
    expect(statuses.slice(0, RATE_MAX).every((s) => s !== 429)).toBe(true);
    expect(statuses[RATE_MAX]).toBe(429);
  });
});
