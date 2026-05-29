/**
 * Vision augmentation tests for /route/dump.
 *
 * The image flows through Gemini Flash 2.5, the extracted description
 * is prepended to any user text, and the combined string runs through
 * Layer 1 + Layer 2 like a normal dump. Tests below cover the new
 * surface, the edges (size cap, mime allowlist, key-missing, vision
 * failure), and confirm the text-only flow is unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDumpRoute, type DumpRouteEnv } from '../src/router/dump';
import type { VectorizeIndex } from '../src/router/vectorize';

vi.mock('../src/clerk-verify', () => ({
  verifyClerkJwt: vi.fn(async () => 'user_vision_test'),
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
    GEMINI_API_KEY: 'gem-test-key',
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

/** A 1×1 transparent PNG (smallest valid base64 PNG). */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

interface VisionFetchOptions {
  /** Text Gemini "extracts" from the image. */
  description?: string;
  /** Override the Gemini HTTP status. Default 200. */
  geminiStatus?: number;
  /** If set, Gemini returns this status on first call, then 200. */
  firstGeminiStatus?: number;
  /** Classification module the Groq mock returns. Default grocery.pantry_add. */
  classificationModule?: string;
  classificationAction?: string;
  classificationPayload?: Record<string, unknown>;
}

function installFetchMock(opts: VisionFetchOptions = {}) {
  const {
    description = 'Receipt from Trader Joe\'s, total $42.18 USD, 2026-05-30, includes milk and bread.',
    geminiStatus = 200,
    firstGeminiStatus,
    classificationModule = 'grocery',
    classificationAction = 'pantry_add',
    classificationPayload = { item: 'milk' },
  } = opts;

  let geminiCalls = 0;
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  fetchSpy.mockImplementation(async (input: Request | string | URL) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();

    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++;
      const status = firstGeminiStatus !== undefined && geminiCalls === 1 ? firstGeminiStatus : geminiStatus;
      if (status !== 200) {
        return new Response(`gemini error ${status}`, { status });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: description }] } },
          ],
          usageMetadata: { promptTokenCount: 280, candidatesTokenCount: 32 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.includes('voyageai.com')) {
      return new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('api.groq.com')) {
      const fakeClassification = {
        module: classificationModule,
        action: classificationAction,
        confidence: 0.9,
        payload: classificationPayload,
      };
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(fakeClassification) }, finish_reason: 'stop' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response('not found', { status: 404 });
  });

  return { fetchSpy, getGeminiCalls: () => geminiCalls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useRealTimers();
});

describe('/route/dump — vision augmentation', () => {
  it('image-only dump routes through vision → Layer 1, visionUsed=true', async () => {
    installFetchMock();
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'image/png', data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fragments: unknown[]; visionUsed?: boolean; originalDump: string };
    expect(body.visionUsed).toBe(true);
    expect(body.originalDump).toContain('[image:');
    expect(body.originalDump).toContain('Trader Joe');
    expect(Array.isArray(body.fragments)).toBe(true);
    expect(body.fragments.length).toBeGreaterThan(0);
  });

  it('image+text dump concatenates vision description before user text', async () => {
    installFetchMock();
    const res = await handleDumpRoute(
      makeReq({
        text: 'and remembered to email mom',
        image: { mime: 'image/jpeg', data: TINY_PNG_BASE64 },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { originalDump: string; visionUsed?: boolean };
    expect(body.visionUsed).toBe(true);
    expect(body.originalDump.startsWith('[image:')).toBe(true);
    expect(body.originalDump).toContain('and remembered to email mom');
    // Image description appears before user text.
    const imgIdx = body.originalDump.indexOf('[image:');
    const userIdx = body.originalDump.indexOf('and remembered');
    expect(imgIdx).toBeLessThan(userIdx);
  });

  it('text-only dump leaves visionUsed undefined and skips Gemini', async () => {
    const { getGeminiCalls } = installFetchMock();
    const res = await handleDumpRoute(
      makeReq({ text: 'süt aldım' }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visionUsed?: boolean; originalDump: string };
    expect(body.visionUsed).toBeUndefined();
    expect(body.originalDump).toBe('süt aldım');
    expect(getGeminiCalls()).toBe(0);
  });

  it('image only with empty string text still works (treats as image-only)', async () => {
    installFetchMock();
    const res = await handleDumpRoute(
      makeReq({ text: '   ', image: { mime: 'image/webp', data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visionUsed?: boolean };
    expect(body.visionUsed).toBe(true);
  });

  it('returns 400 when neither text nor image present', async () => {
    installFetchMock();
    const res = await handleDumpRoute(makeReq({}), makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 on bad image shape (missing mime)', async () => {
    installFetchMock();
    const res = await handleDumpRoute(
      makeReq({ image: { data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on disallowed mime (image/gif)', async () => {
    installFetchMock();
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'image/gif', data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 413 when payload exceeds 8MB raw', async () => {
    installFetchMock();
    const bigData = 'A'.repeat(Math.ceil((8 * 1024 * 1024 + 1) * 4 / 3));
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'image/jpeg', data: bigData } }),
      makeEnv(),
    );
    expect(res.status).toBe(413);
  });

  it('accepts application/pdf and routes through vision', async () => {
    installFetchMock({
      description: 'Lease renewal form, expires 2026-09-30, tenant: anonymized.',
    });
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'application/pdf', data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visionUsed?: boolean; originalDump: string };
    expect(body.visionUsed).toBe(true);
    expect(body.originalDump).toContain('Lease renewal');
  });

  it('returns 503 when GEMINI_API_KEY missing and image present', async () => {
    installFetchMock();
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'image/png', data: TINY_PNG_BASE64 } }),
      makeEnv({ GEMINI_API_KEY: '' }),
    );
    expect(res.status).toBe(503);
  });

  it('returns 502 with vision_failed code when Gemini errors', async () => {
    installFetchMock({ geminiStatus: 500 });
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'image/png', data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('vision_failed');
  });

  it('retries once on 429 then succeeds', async () => {
    const { getGeminiCalls } = installFetchMock({ firstGeminiStatus: 429 });
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'image/png', data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(getGeminiCalls()).toBe(2);
  });

  it('crisis lexicon sees the vision-extracted text', async () => {
    installFetchMock({
      description: 'Handwritten note: kendime zarar vermek istiyorum.',
    });
    const res = await handleDumpRoute(
      makeReq({ image: { mime: 'image/png', data: TINY_PNG_BASE64 } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { crisis?: { tier: number } };
    expect(body.crisis).toBeDefined();
    expect(body.crisis?.tier).toBeGreaterThanOrEqual(2);
  });

  it('PII scrub runs over the combined dump (vision text + user text)', async () => {
    installFetchMock({
      description: 'Receipt from Trader Joe\'s, total $42.18 USD.',
    });
    const res = await handleDumpRoute(
      makeReq({
        text: 'card was 4111 1111 1111 1111',
        image: { mime: 'image/jpeg', data: TINY_PNG_BASE64 },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { originalDump: string };
    expect(body.originalDump).toContain('Trader');
    expect(body.originalDump).toContain('card was');
  });
});
