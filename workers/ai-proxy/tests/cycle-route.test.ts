/**
 * Tests for /route/cycle — cycle-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 20 fixtures: EN + ES + TR covering all 4 cycle actions.
 *   - 3 ambiguous fixtures verify the 8B → GPT-OSS 120B tier escalation
 *     kicks in when the cheap model returns confidence < 0.7.
 *   - PII passthrough: cycle symptom terms (cramps, bloating, mood swings)
 *     must NOT be scrubbed before reaching the classifier — the worker-local
 *     scrubber has no medical category (src/pii.ts header).
 *   - Schema/transport failure modes: bad JSON arg + tool_calls missing + empty text.
 *
 * Mock strategy: mirrors sleep-route.test.ts exactly.
 *   Voyage → always OK, deterministic 1024-d vector.
 *   Supabase RPC → always cache miss (exercises Groq every time).
 *   Groq → keyed off `model` field:
 *     "llama-3.1-8b-instant"  → fast tier reply (per-fixture confidence)
 *     "openai/gpt-oss-120b"   → accurate tier reply (always high conf)
 *   Ambiguous fixtures have fastConfidence: 0.5, triggering escalation;
 *   test asserts BOTH model ids were called.
 *
 * No cross-route mirror suite — cycle is standalone Layer 2 (no secondary dispatch).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  CYCLE_MODEL_FAST,
  CYCLE_MODEL_ACCURATE,
  type CycleAction,
} from '../src/modules/cycle.config';
import { scrubPII } from '../src/pii';

// ─── env stub ─────────────────────────────────────────────────────────────────

function makeEnv(): RouteEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    VOYAGE_API_KEY: 'voy-test-key',
    GROQ_API_KEY: 'groq-test-key',
    T0_JWT_ENFORCED: '0',
  };
}

function makeReq(text: string): Request {
  return new Request('https://worker.dev/route/cycle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ───────────────────────────────────────────────────────────

interface CycleFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: CycleAction;
  expectedPayload: Record<string, unknown>;
  fastConfidence: number;
  expectEscalation: boolean;
}

// ─── 20 fixtures ──────────────────────────────────────────────────────────────
// All 4 actions covered. 3 ambiguous (fastConfidence 0.5) to exercise escalation.

const FIXTURES: CycleFixture[] = [
  // ── EN (7) ──────────────────────────────────────────────────────────────────
  { desc: 'EN period started → log_period_start',
    lang: 'en', text: 'period started',
    expectedAction: 'log_period_start', expectedPayload: {},
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'EN got my period today → log_period_start',
    lang: 'en', text: 'got my period today',
    expectedAction: 'log_period_start', expectedPayload: {},
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'EN period is over → log_period_end',
    lang: 'en', text: 'period is over',
    expectedAction: 'log_period_end', expectedPayload: {},
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN cramps bad rn → log_symptom cramps',
    lang: 'en', text: 'cramps bad rn',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'cramps' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'EN feeling bloated → log_symptom bloating',
    lang: 'en', text: 'feeling bloated',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'bloating' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'EN took my pill → pill_logged',
    lang: 'en', text: 'took my pill',
    expectedAction: 'pill_logged', expectedPayload: {},
    fastConfidence: 0.95, expectEscalation: false },
  // Ambiguous: "headache" in cycle context — needs escalation
  { desc: 'EN ambiguous "headache" in cycle context → escalate to log_symptom',
    lang: 'en', text: 'headache',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'headache' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── ES (7) ──────────────────────────────────────────────────────────────────
  { desc: 'ES me bajó → log_period_start',
    lang: 'es', text: 'me bajó',
    expectedAction: 'log_period_start', expectedPayload: {},
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'ES me vino la regla → log_period_start',
    lang: 'es', text: 'me vino la regla hoy',
    expectedAction: 'log_period_start', expectedPayload: {},
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES se me fue la regla → log_period_end',
    lang: 'es', text: 'se me fue la regla',
    expectedAction: 'log_period_end', expectedPayload: {},
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES tengo calambres → log_symptom cramps',
    lang: 'es', text: 'tengo calambres hoy',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'cramps' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES me siento hinchada → log_symptom bloating',
    lang: 'es', text: 'me siento hinchada',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'bloating' },
    fastConfidence: 0.91, expectEscalation: false },
  { desc: 'ES tomé la pastilla → pill_logged',
    lang: 'es', text: 'tomé la pastilla',
    expectedAction: 'pill_logged', expectedPayload: {},
    fastConfidence: 0.96, expectEscalation: false },
  // Ambiguous: "me siento rara" — needs escalation
  { desc: 'ES ambiguous "me siento rara" → escalate to log_symptom',
    lang: 'es', text: 'me siento rara hoy',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'feeling off' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── TR (6) ──────────────────────────────────────────────────────────────────
  { desc: 'TR regl başladı → log_period_start',
    lang: 'tr', text: 'regl başladı',
    expectedAction: 'log_period_start', expectedPayload: {},
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'TR regl bitti → log_period_end',
    lang: 'tr', text: 'regl bitti',
    expectedAction: 'log_period_end', expectedPayload: {},
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'TR kramp girdim → log_symptom cramps',
    lang: 'tr', text: 'kramp girdim',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'cramps' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR şişkinlik var → log_symptom bloating',
    lang: 'tr', text: 'şişkinlik var bugün',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'bloating' },
    fastConfidence: 0.91, expectEscalation: false },
  { desc: 'TR hapı aldım → pill_logged',
    lang: 'tr', text: 'hapı aldım',
    expectedAction: 'pill_logged', expectedPayload: {},
    fastConfidence: 0.94, expectEscalation: false },
  // Ambiguous: "ruh halim çok kötü" — mood swing, needs escalation
  { desc: 'TR ambiguous "ruh halim çok kötü" → escalate to log_symptom mood swings',
    lang: 'tr', text: 'ruh halim çok kötü',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'mood swings' },
    fastConfidence: 0.5, expectEscalation: true },
];

// ─── mock helpers ─────────────────────────────────────────────────────────────

interface GroqRequestBody {
  model?: string;
  messages: Array<{ role: string; content: string }>;
}

function makeGroqResp(args: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'classify_cycle_action',
              arguments: JSON.stringify(args),
            },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function makeFixtureFetch(fixture: CycleFixture, calls: { fast: number; accurate: number }) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('voyageai.com')) {
      return new Response(
        JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('routing_cache_lookup')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('api.groq.com')) {
      const body = JSON.parse((init?.body as string) ?? '{}') as GroqRequestBody;
      if (body.model === CYCLE_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === CYCLE_MODEL_ACCURATE) {
        calls.accurate++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: 0.95,
          language: fixture.lang,
        });
      }
      return new Response('unexpected model', { status: 500 });
    }
    if (url.includes('routing_cache')) {
      return new Response('', { status: 201 });
    }
    return new Response('not found', { status: 404 });
  };
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('/route/cycle — Layer 2 fixtures', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const fx of FIXTURES) {
    it(fx.desc, async () => {
      const calls = { fast: 0, accurate: 0 };
      fetchSpy.mockImplementation(
        makeFixtureFetch(fx, calls) as unknown as typeof fetch,
      );

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'cycle');
      expect(res.status).toBe(200);

      const body = await res.json() as {
        source: string;
        latencyMs: number;
        classification: { action: string; payload: Record<string, unknown> };
        language: string;
      };

      // Tier ladder assertions
      expect(calls.fast).toBe(1);
      if (fx.expectEscalation) {
        expect(calls.accurate).toBe(1);
      } else {
        expect(calls.accurate).toBe(0);
      }

      // Action correctness
      expect(body.classification.action).toBe(fx.expectedAction);
      expect(body.language).toBe(fx.lang);

      // Key payload fields match
      for (const [k, v] of Object.entries(fx.expectedPayload)) {
        expect(body.classification.payload[k]).toEqual(v);
      }
    });
  }
});

// ─── tier ladder smoke ───────────────────────────────────────────────────────

describe('/route/cycle — tier ladder contract', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escalates to GPT-OSS 120B when 8B confidence is below threshold', async () => {
    const models: string[] = [];
    fetchSpy.mockImplementation(async (url, init) => {
      if (typeof url === 'string' && url.includes('voyageai.com')) {
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
          { status: 200 },
        );
      }
      if (typeof url === 'string' && url.includes('routing_cache_lookup')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === 'string' && url.includes('api.groq.com')) {
        const body = JSON.parse((init?.body as string) ?? '{}') as GroqRequestBody;
        if (body.model) models.push(body.model);
        const isLow = body.model === CYCLE_MODEL_FAST;
        return makeGroqResp({
          action: 'log_symptom',
          payload: { symptom: 'cramps' },
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('something cycle-ish'), makeEnv(), 'cycle');
    expect(res.status).toBe(200);
    expect(models).toEqual([CYCLE_MODEL_FAST, CYCLE_MODEL_ACCURATE]);
  });

  it('stops at 8B when confidence already above threshold', async () => {
    const models: string[] = [];
    fetchSpy.mockImplementation(async (url, init) => {
      if (typeof url === 'string' && url.includes('voyageai.com')) {
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
          { status: 200 },
        );
      }
      if (typeof url === 'string' && url.includes('routing_cache_lookup')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === 'string' && url.includes('api.groq.com')) {
        const body = JSON.parse((init?.body as string) ?? '{}') as GroqRequestBody;
        if (body.model) models.push(body.model);
        return makeGroqResp({
          action: 'log_period_start',
          payload: {},
          confidence: 0.97,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('period started'), makeEnv(), 'cycle');
    expect(res.status).toBe(200);
    expect(models).toEqual([CYCLE_MODEL_FAST]);
  });
});

// ─── transport / schema failure modes ────────────────────────────────────────

describe('/route/cycle — failure modes', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 502 when Groq returns malformed tool args JSON', async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('voyageai.com')) {
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
          { status: 200 },
        );
      }
      if (typeof url === 'string' && url.includes('routing_cache_lookup')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === 'string' && url.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'classify_cycle_action',
                    arguments: '{not valid json',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('period started'), makeEnv(), 'cycle');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('returns 502 when Groq returns no tool_calls at all', async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('voyageai.com')) {
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
          { status: 200 },
        );
      }
      if (typeof url === 'string' && url.includes('routing_cache_lookup')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === 'string' && url.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({
            choices: [{
              message: { content: 'here you go', tool_calls: [] },
              finish_reason: 'stop',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('period started'), makeEnv(), 'cycle');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/cycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'cycle');
    expect(res.status).toBe(400);
  });
});

// ─── PII passthrough ─────────────────────────────────────────────────────────
// Belt-and-suspenders: verify cycle symptom terms are NOT scrubbed by the
// worker-local PII scrubber before reaching the classifier.

describe('/route/cycle — PII passthrough', () => {
  it('does not scrub cycle symptom terms', () => {
    const terms = ['cramps', 'bloating', 'mood swings', 'spotting', 'breast tenderness'];
    for (const term of terms) {
      const phrase = `I have ${term} today`;
      const { scrubbed } = scrubPII(phrase);
      expect(scrubbed).toContain(term);
    }
  });
});
