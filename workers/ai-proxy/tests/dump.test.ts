/**
 * Smoke test for /route/dump — the brain-dump universal router.
 *
 * One end-to-end happy path: "süt aldım" → grocery routing → pantry_add(milk).
 * Full 140-test golden suite runs separately once this baseline confirms.
 *
 * Mocks: fetch (Voyage + Groq + Clerk JWKS), Vectorize index (cache miss).
 * Clerk JWT verification is bypassed by stubbing fetch to return a valid JWKS
 * and using a hand-rolled signed token (handled by mocking verifyClerkJwt's
 * underlying jose call). For the smoke test we mock `verifyClerkJwt` directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDumpRoute, type DumpRouteEnv } from '../src/router/dump';
import type { VectorizeIndex } from '../src/router/vectorize';

// Stub the Clerk verifier so the test doesn't need a real JWKS round-trip.
vi.mock('../src/clerk-verify', () => ({
  verifyClerkJwt: vi.fn(async () => 'user_smoke_test'),
}));

function makeVectorize(): VectorizeIndex {
  return {
    query: vi.fn(async () => ({ matches: [], count: 0 })),
    upsert: vi.fn(async () => ({ mutationId: 'mut-1' })),
    deleteByIds: vi.fn(async () => ({ mutationId: 'mut-2' })),
  };
}

function makeEnv(overrides: Partial<DumpRouteEnv> = {}): DumpRouteEnv {
  return {
    VOYAGE_API_KEY: 'voy-test-key',
    GROQ_API_KEY: 'groq-test-key',
    CLERK_ISSUER: 'https://faithful-stag-15.clerk.accounts.dev',
    VECTORIZE_INDEX: makeVectorize(),
    ...overrides,
  };
}

function makeReq(body: unknown): Request {
  return new Request('https://worker.dev/route/dump', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer fake-clerk-token',
    },
    body: JSON.stringify(body),
  });
}

const fetchSpy = vi.spyOn(globalThis, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

beforeEach(() => {
  fetchSpy.mockImplementation(async (input: Request | string | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
    // Voyage embedding
    if (url.includes('voyageai.com')) {
      return new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Groq — classify endpoint (no pass-2 needed for "süt aldım" — 2 words)
    if (url.includes('api.groq.com')) {
      const fakeClassification = {
        module: 'grocery',
        action: 'pantry_add',
        confidence: 0.93,
        payload: { item: 'süt' },
      };
      // classifyBatch sends every dump (incl. single-fragment) through the
      // batched `{ results: [...] }` contract.
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ results: [fakeClassification] }) },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  });
});

describe('/route/dump — smoke', () => {
  it('"süt aldım" routes to grocery with pantry_add(item=süt), confidence ≥ 0.80, source=ai', async () => {
    const env = makeEnv();
    const res = await handleDumpRoute(makeReq({ text: 'süt aldım' }), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      schemaVersion: string;
      originalDump: string;
      dumpId: string;
      fragments: Array<{
        text: string;
        module: string;
        payload: Record<string, unknown>;
        confidence: number;
        source: string;
        needsConfirm: boolean;
        language: string;
      }>;
      summary: { moduleCount: Record<string, number>; cacheHitRate: number; aiCalls: number };
      crisis?: unknown;
    };

    expect(body.schemaVersion).toBe('1.0');
    expect(body.originalDump).toBe('süt aldım');
    expect(typeof body.dumpId).toBe('string');
    expect(body.fragments).toHaveLength(1);

    const f = body.fragments[0];
    expect(f.module).toBe('grocery');
    expect(f.payload.action).toBe('pantry_add');
    expect(f.payload.item).toBe('süt');
    expect(f.confidence).toBeGreaterThanOrEqual(0.8);
    expect(f.needsConfirm).toBe(false);
    expect(f.source).toBe('ai');
    expect(f.language).toBe('tr');

    expect(body.summary.moduleCount.grocery).toBe(1);
    expect(body.summary.cacheHitRate).toBe(0);
    expect(body.summary.aiCalls).toBe(1);
    expect(body.crisis).toBeUndefined();
  });

  it('returns 401 when authorization header missing', async () => {
    const env = makeEnv();
    const req = new Request('https://worker.dev/route/dump', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'süt aldım' }),
    });
    const res = await handleDumpRoute(req, env);
    expect(res.status).toBe(401);
  });

  it('returns 503 when CLERK_ISSUER unset', async () => {
    const env = makeEnv({ CLERK_ISSUER: undefined });
    const res = await handleDumpRoute(makeReq({ text: 'süt aldım' }), env);
    expect(res.status).toBe(503);
  });

  it('returns 400 on missing text', async () => {
    const env = makeEnv();
    const res = await handleDumpRoute(makeReq({}), env);
    expect(res.status).toBe(400);
  });

  it('injects scheduledAtMs into payload when Layer 1 emits a remindIn hint', async () => {
    const env = makeEnv();

    // Override the default fetch impl with one that returns a classification
    // carrying a remindIn hint. The worker should compute scheduledAtMs and
    // attach it to the fragment payload before returning.
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (input: Request | string | URL) => {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
      if (url.includes('voyageai.com')) {
        return new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('api.groq.com')) {
        const fakeClassification = {
          module: 'admin',
          action: 'create_phone_task',
          confidence: 0.92,
          payload: { person: 'mama', remindIn: { amount: 1, unit: 'min' } },
        };
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: JSON.stringify({ results: [fakeClassification] }) },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const before = Date.now();
    const res = await handleDumpRoute(makeReq({ text: 'remind me to call mama in 1 minute' }), env);
    const after = Date.now();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      fragments: Array<{ payload: Record<string, unknown> }>;
    };
    expect(body.fragments).toHaveLength(1);
    const remindIn = body.fragments[0].payload.remindIn as
      | { amount: number; unit: string; scheduledAtMs: number }
      | undefined;
    expect(remindIn).toBeDefined();
    expect(remindIn?.amount).toBe(1);
    expect(remindIn?.unit).toBe('min');
    // 60_000 ms after request start ± a small slack for the elapsed test.
    expect(remindIn?.scheduledAtMs).toBeGreaterThanOrEqual(before + 60_000);
    expect(remindIn?.scheduledAtMs).toBeLessThanOrEqual(after + 60_000);
  });

  it('drops a malformed remindIn (no scheduledAtMs surfaced)', async () => {
    const env = makeEnv();

    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (input: Request | string | URL) => {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
      if (url.includes('voyageai.com')) {
        return new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('api.groq.com')) {
        const fakeClassification = {
          module: 'admin',
          action: 'create_task',
          confidence: 0.92,
          // 5000-day "reminder" — sanity guard should drop the hint entirely.
          payload: { text: 'do thing', remindIn: { amount: 5000, unit: 'day' } },
        };
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: JSON.stringify({ results: [fakeClassification] }) },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const res = await handleDumpRoute(makeReq({ text: 'remind me to do thing in 5000 days' }), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      fragments: Array<{ payload: Record<string, unknown> }>;
    };
    expect(body.fragments).toHaveLength(1);
    // The primary write payload still goes through; only remindIn is dropped.
    expect(body.fragments[0].payload.text).toBe('do thing');
    expect(body.fragments[0].payload.remindIn).toBeUndefined();
  });
});
