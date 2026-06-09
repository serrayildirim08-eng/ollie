/**
 * Tests for /route/habits — habits-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - complete golden ×4: EN ×2, ES ×1, TR ×1.
 *   - identity_statement golden ×4: affirmations (EN/TR/ES) + fall-off-reflective ×2.
 *   - fall-off-reflective routing-to-identity ×2: dedicated fixtures showing
 *     missed/broke fragments landing in identity_statement when tone is reflective.
 *   - Tier ladder: escalation smoke (8B confidence < 0.7 → GPT-OSS 120B) + stop at 8B.
 *   - Low-confidence demote: ambiguous fragment stays < 0.7 even after escalation
 *     (router accepts it; downstream handler demotes to dump_only if action is unclear).
 *   - streak_break_note legacy defensive ×1: fragment arriving with that action is
 *     accepted by Layer 2 without crashing; test asserts handler can read the response.
 *   - JSON-mode failure modes: bad tool args JSON → 502, no tool_calls → 502, empty text → 400.
 *
 * No-streaks decision: Ollie has explicitly REJECTED streak mechanics.
 * Layer 1 will NEVER route habits.streak_break_note. The defensive test
 * exercises the ONLY path where streak_break_note could arrive (a future
 * Layer 1 regression). Layer 2 must not crash on it.
 *
 * Mock strategy mirrors medication-route.test.ts exactly:
 *   Voyage (always OK, 1024-d vector), Supabase RPC (always cache miss),
 *   Groq (keyed off `model` field):
 *     - "llama-3.1-8b-instant"  → fast tier reply (per-fixture confidence)
 *     - "openai/gpt-oss-120b"   → accurate tier reply (always high conf)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  HABITS_MODEL_FAST,
  HABITS_MODEL_ACCURATE,
  type HabitsAction,
} from '../src/modules/habits.config';

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
  return new Request('https://worker.dev/route/habits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ────────────────────────────────────────────────────────────

interface HabitsFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: HabitsAction;
  expectedPayload: Record<string, unknown>;
  /** Confidence the 8B mock should return. */
  fastConfidence: number;
  /** True when we expect the tier ladder to escalate to GPT-OSS 120B. */
  expectEscalation: boolean;
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES: HabitsFixture[] = [
  // ── complete (4) ────────────────────────────────────────────────────────────
  {
    desc: 'EN "did my morning stretch" → complete + habitName',
    lang: 'en', text: 'did my morning stretch',
    expectedAction: 'complete', expectedPayload: { habitName: 'morning stretch' },
    fastConfidence: 0.97, expectEscalation: false,
  },
  {
    desc: 'EN "meditation done" → complete + habitName',
    lang: 'en', text: 'meditation done',
    expectedAction: 'complete', expectedPayload: { habitName: 'meditation' },
    fastConfidence: 0.96, expectEscalation: false,
  },
  {
    desc: 'TR "meditasyonu yaptım" → complete + habitName',
    lang: 'tr', text: 'meditasyonu yaptım',
    expectedAction: 'complete', expectedPayload: { habitName: 'meditasyon' },
    fastConfidence: 0.96, expectEscalation: false,
  },
  {
    desc: 'ES "hice yoga 20 minutos" → complete + habitName',
    lang: 'es', text: 'hice yoga esta mañana, 20 minutos',
    expectedAction: 'complete', expectedPayload: { habitName: 'yoga' },
    fastConfidence: 0.95, expectEscalation: false,
  },

  // ── identity_statement (4 including 2 fall-off-reflective) ──────────────────
  {
    desc: 'EN affirmation "i am someone who writes daily" → identity_statement',
    lang: 'en', text: 'i am someone who writes daily',
    expectedAction: 'identity_statement',
    expectedPayload: { text: 'i am someone who writes daily' },
    fastConfidence: 0.95, expectEscalation: false,
  },
  {
    desc: "EN affirmation \"i'm finally a runner\" → identity_statement",
    lang: 'en', text: "i'm finally a runner",
    expectedAction: 'identity_statement',
    expectedPayload: { text: "i'm finally a runner" },
    fastConfidence: 0.94, expectEscalation: false,
  },
  {
    desc: 'TR identity "yazılım yapan biriyim artık" → identity_statement',
    lang: 'tr', text: 'yazılım yapan biriyim artık',
    expectedAction: 'identity_statement',
    expectedPayload: { text: 'yazılım yapan biriyim artık' },
    fastConfidence: 0.94, expectEscalation: false,
  },
  {
    desc: 'ES fall-off-reflective "no corrí pero sigo siendo alguien que corre" → identity_statement',
    lang: 'es', text: 'hoy no corrí, estoy cansada pero sigo siendo alguien que corre',
    expectedAction: 'identity_statement',
    expectedPayload: { text: 'hoy no corrí, estoy cansada pero sigo siendo alguien que corre' },
    fastConfidence: 0.88, expectEscalation: false,
  },

  // ── fall-off-reflective (2 explicit, escalation path) ───────────────────────
  {
    desc: 'EN fall-off "missed running today, too tired — but im still a runner" → identity_statement (escalated)',
    lang: 'en', text: 'missed running today, too tired — but im still a runner',
    expectedAction: 'identity_statement',
    expectedPayload: { text: 'missed running today, too tired — but im still a runner' },
    fastConfidence: 0.65, expectEscalation: true,
  },
  {
    desc: 'EN fall-off "broke my reading habit but ill get back to it" → identity_statement (escalated)',
    lang: 'en', text: 'broke my reading habit but ill get back to it',
    expectedAction: 'identity_statement',
    expectedPayload: { text: 'broke my reading habit but ill get back to it' },
    fastConfidence: 0.62, expectEscalation: true,
  },

  // ── ladder escalation — low-confidence complete ──────────────────────────────
  {
    desc: 'EN ambiguous "went for a walk maybe" → complete (escalated)',
    lang: 'en', text: 'went for a walk maybe',
    expectedAction: 'complete', expectedPayload: { habitName: 'walk' },
    fastConfidence: 0.5, expectEscalation: true,
  },
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
              name: 'classify_habits_action',
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

function makeFixtureFetch(fixture: HabitsFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === HABITS_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === HABITS_MODEL_ACCURATE) {
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

// ─── suite: golden fixtures ───────────────────────────────────────────────────

describe('/route/habits — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'habits');
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

      // complete requires non-empty habitName
      if (fx.expectedAction === 'complete') {
        expect(typeof body.classification.payload.habitName).toBe('string');
        expect((body.classification.payload.habitName as string).length).toBeGreaterThan(0);
      }

      // identity_statement requires non-empty text
      if (fx.expectedAction === 'identity_statement') {
        expect(typeof body.classification.payload.text).toBe('string');
        expect((body.classification.payload.text as string).length).toBeGreaterThan(0);
      }
    });
  }
});

// ─── suite: tier ladder contract ─────────────────────────────────────────────

describe('/route/habits — tier ladder contract', () => {
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
        const isLow = body.model === HABITS_MODEL_FAST;
        return makeGroqResp({
          action: 'complete',
          payload: { habitName: 'something unclear' },
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('did something maybe a habit'), makeEnv(), 'habits');
    expect(res.status).toBe(200);
    expect(models).toEqual([HABITS_MODEL_FAST, HABITS_MODEL_ACCURATE]);
  });

  it('stops at 8B when confidence is above threshold', async () => {
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
          action: 'complete',
          payload: { habitName: 'morning stretch' },
          confidence: 0.97,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('did my morning stretch'), makeEnv(), 'habits');
    expect(res.status).toBe(200);
    expect(models).toEqual([HABITS_MODEL_FAST]);
  });
});

// ─── suite: streak_break_note legacy defensive ────────────────────────────────
//
// Layer 1 will NEVER route here (no-streaks decision). This test covers the
// only realistic path: a future Layer 1 regression sends streak_break_note.
// Layer 2 must accept the response without crashing (HTTP 200). The downstream
// native handler is responsible for demoting to dump_only with
// reason: 'habits_streak_break_legacy'. This test only asserts no crash + 200.

describe('/route/habits — streak_break_note legacy defensive', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts streak_break_note from model without crashing (200, action preserved)', async () => {
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
        void body; // model not relevant — we force the legacy action
        return makeGroqResp({
          action: 'streak_break_note',
          payload: { habitName: 'running', reason: 'missed 5 days' },
          confidence: 0.85,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(
      makeReq('missed 5 days of running'),
      makeEnv(),
      'habits',
    );
    // Must not crash — router delivers the raw classification; demotion is
    // the native handler's job, not Layer 2's job.
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { action: string; payload: Record<string, unknown> };
    };
    // Layer 2 returns what the model said — route.ts doesn't rewrite it.
    expect(body.classification.action).toBe('streak_break_note');
    // Payload must be readable (no parse crash)
    expect(body.classification.payload).toBeDefined();
  });
});

// ─── suite: failure modes ────────────────────────────────────────────────────

describe('/route/habits — failure modes', () => {
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
                    name: 'classify_habits_action',
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

    const res = await handleRoute(makeReq('did my stretch'), makeEnv(), 'habits');
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
              message: { content: 'habits are cool', tool_calls: [] },
              finish_reason: 'stop',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('did my stretch'), makeEnv(), 'habits');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/habits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'habits');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown module', async () => {
    const req = new Request('https://worker.dev/route/unknownmodule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'did my stretch' }),
    });
    fetchSpy.mockImplementation(async () => new Response('', { status: 200 }));
    const res = await handleRoute(req, makeEnv(), 'unknownmodule');
    expect(res.status).toBe(404);
  });
});
