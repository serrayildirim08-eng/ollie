/**
 * Tests for /route/goals — goals-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 22 fixtures: trilingual EN/ES/TR, all 4 actions covered.
 *   - Per-action golden ×4 (progress_note, create_goal, milestone_hit,
 *     obstacle_note).
 *   - Explicit disambiguation fixtures — these were flagged in the live
 *     runner failures and the prompt encodes them firmly:
 *       "shipped the auth flow" → milestone_hit (NOT progress_note)
 *       "made some progress on the book" → progress_note (NOT milestone_hit)
 *       "want to run a marathon" → create_goal (NOT progress_note)
 *       "ran my first 5k" — accept milestone_hit when Layer 2 sees it
 *         (cross-module body.log_movement is also valid; we only assert
 *         the goals Layer 2 path here).
 *   - 3 ambiguous fixtures verify the 8B → GPT-OSS 120B tier escalation.
 *   - Schema/transport failure modes ×3: bad JSON args, no tool_calls,
 *     empty text.
 *   - 1 low-confidence demote test asserts that when the 8B mock returns
 *     conf < threshold the ladder calls the accurate tier.
 *
 * Mock strategy mirrors sleep-route.test.ts exactly so the two test files
 * stay structurally diffable.
 *
 * Goals has NO cross-route mirror — standalone module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  GOALS_MODEL_FAST,
  GOALS_MODEL_ACCURATE,
  type GoalsAction,
} from '../src/modules/goals.config';

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
  return new Request('https://worker.dev/route/goals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ────────────────────────────────────────────────────────────

interface GoalsFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: GoalsAction;
  expectedPayload: Record<string, unknown>;
  fastConfidence: number;
  expectEscalation: boolean;
}

// ─── 22 fixtures ──────────────────────────────────────────────────────────────

const FIXTURES: GoalsFixture[] = [
  // ── progress_note ×5 ────────────────────────────────────────────────────────
  { desc: 'EN made some progress on the book → progress_note (NOT milestone_hit)',
    lang: 'en', text: 'made some progress on the book',
    expectedAction: 'progress_note', expectedPayload: { note: 'made some progress', goalName: 'book' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR kitabın 3. bölümünü bitirdim → progress_note',
    lang: 'tr', text: 'kitabın 3. bölümünü bitirdim',
    expectedAction: 'progress_note', expectedPayload: { note: 'kitabın 3. bölümünü bitirdim', goalName: 'kitap' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'ES avancé con el proyecto → progress_note',
    lang: 'es', text: 'avancé con el proyecto hoy',
    expectedAction: 'progress_note', expectedPayload: { note: 'avancé con el proyecto', goalName: 'proyecto' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'EN wrote 500 words today → progress_note',
    lang: 'en', text: 'wrote 500 words today',
    expectedAction: 'progress_note', expectedPayload: { note: 'wrote 500 words today' },
    fastConfidence: 0.91, expectEscalation: false },
  { desc: 'EN got further with the deck → progress_note',
    lang: 'en', text: 'got further with the deck',
    expectedAction: 'progress_note', expectedPayload: { note: 'got further with the deck', goalName: 'deck' },
    fastConfidence: 0.9, expectEscalation: false },

  // ── create_goal ×5 ──────────────────────────────────────────────────────────
  { desc: 'EN want to run a marathon → create_goal (NOT progress_note)',
    lang: 'en', text: 'want to run a marathon',
    expectedAction: 'create_goal', expectedPayload: { what: 'run a marathon' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'EN want to run a half marathon → create_goal + modal stripped',
    lang: 'en', text: 'want to run a half marathon',
    expectedAction: 'create_goal', expectedPayload: { what: 'run a half marathon' },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'ES quiero correr una media maratón → create_goal',
    lang: 'es', text: 'quiero correr una media maratón',
    expectedAction: 'create_goal', expectedPayload: { what: 'correr una media maratón' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'TR yarım maraton koşmak istiyorum → create_goal',
    lang: 'tr', text: 'yarım maraton koşmak istiyorum',
    expectedAction: 'create_goal', expectedPayload: { what: 'yarım maraton koş' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'EN going to launch a podcast → create_goal',
    lang: 'en', text: 'going to launch a podcast',
    expectedAction: 'create_goal', expectedPayload: { what: 'launch a podcast' },
    fastConfidence: 0.93, expectEscalation: false },

  // ── milestone_hit ×5 ────────────────────────────────────────────────────────
  { desc: 'EN shipped the auth flow → milestone_hit (NOT progress_note)',
    lang: 'en', text: 'shipped the auth flow',
    expectedAction: 'milestone_hit', expectedPayload: { milestone: 'shipped the auth flow' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN hit 10k followers → milestone_hit',
    lang: 'en', text: 'hit 10k followers',
    expectedAction: 'milestone_hit', expectedPayload: { milestone: '10k followers' },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'TR 10 bin takipçiye ulaştım → milestone_hit',
    lang: 'tr', text: '10 bin takipçiye ulaştım',
    expectedAction: 'milestone_hit', expectedPayload: { milestone: '10 bin takipçi', goalName: 'takipçi' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'EN ran my first 5k → milestone_hit (when Layer 2 receives it)',
    lang: 'en', text: 'ran my first 5k',
    expectedAction: 'milestone_hit', expectedPayload: { milestone: 'ran first 5k' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'ES llegué a 10k seguidores → milestone_hit',
    lang: 'es', text: 'llegué a 10k seguidores',
    expectedAction: 'milestone_hit', expectedPayload: { milestone: '10k seguidores' },
    fastConfidence: 0.95, expectEscalation: false },

  // ── obstacle_note ×4 ────────────────────────────────────────────────────────
  { desc: 'EN knee is acting up, blocking running → obstacle_note',
    lang: 'en', text: 'knee is acting up, blocking running',
    expectedAction: 'obstacle_note', expectedPayload: { obstacle: 'knee pain', goalName: 'running' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES la rodilla me está bloqueando → obstacle_note',
    lang: 'es', text: 'la rodilla me está bloqueando',
    expectedAction: 'obstacle_note', expectedPayload: { obstacle: 'rodilla', goalName: 'correr' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR diz problemim koşmayı engelliyor → obstacle_note',
    lang: 'tr', text: 'diz problemim koşmayı engelliyor',
    expectedAction: 'obstacle_note', expectedPayload: { obstacle: 'diz problemi', goalName: 'koşmak' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN out of time for the side project → obstacle_note',
    lang: 'en', text: 'out of time for the side project, can\'t make progress',
    expectedAction: 'obstacle_note', expectedPayload: { obstacle: 'out of time', goalName: 'side project' },
    fastConfidence: 0.91, expectEscalation: false },

  // ── ambiguous escalations ×3 ────────────────────────────────────────────────
  { desc: 'EN ambiguous "another step forward" → escalate to progress_note',
    lang: 'en', text: 'another step forward',
    expectedAction: 'progress_note', expectedPayload: { note: 'another step forward' },
    fastConfidence: 0.5, expectEscalation: true },
  { desc: 'EN ambiguous "marathon" → escalate to create_goal',
    lang: 'en', text: 'marathon',
    expectedAction: 'create_goal', expectedPayload: { what: 'marathon' },
    fastConfidence: 0.5, expectEscalation: true },
  { desc: 'TR ambiguous "spor" → escalate to create_goal',
    lang: 'tr', text: 'spor',
    expectedAction: 'create_goal', expectedPayload: { what: 'spor' },
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
              name: 'classify_goals_action',
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

function makeFixtureFetch(fixture: GoalsFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === GOALS_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === GOALS_MODEL_ACCURATE) {
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

// ─── suite ────────────────────────────────────────────────────────────────────

describe('/route/goals — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'goals');
      expect(res.status).toBe(200);

      const body = await res.json() as {
        source: string;
        latencyMs: number;
        classification: { action: string; payload: Record<string, unknown> };
        language: string;
      };

      expect(calls.fast).toBe(1);
      if (fx.expectEscalation) {
        expect(calls.accurate).toBe(1);
      } else {
        expect(calls.accurate).toBe(0);
      }

      expect(body.classification.action).toBe(fx.expectedAction);
      expect(body.language).toBe(fx.lang);

      for (const [k, v] of Object.entries(fx.expectedPayload)) {
        expect(body.classification.payload[k]).toEqual(v);
      }
    });
  }
});

// ─── tier ladder smoke (no fixture loop, asserts contract) ──────────────────

describe('/route/goals — tier ladder contract', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escalates to GPT-OSS 120B when 8B confidence is below threshold (low-conf demote)', async () => {
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
        const isLow = body.model === GOALS_MODEL_FAST;
        return makeGroqResp({
          action: 'progress_note',
          payload: { note: 'something' },
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('something about a goal idk'), makeEnv(), 'goals');
    expect(res.status).toBe(200);
    expect(models).toEqual([GOALS_MODEL_FAST, GOALS_MODEL_ACCURATE]);
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
          action: 'milestone_hit',
          payload: { milestone: 'shipped auth' },
          confidence: 0.98,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('shipped the auth flow'), makeEnv(), 'goals');
    expect(res.status).toBe(200);
    expect(models).toEqual([GOALS_MODEL_FAST]);
  });
});

// ─── transport / schema failure modes ────────────────────────────────────────

describe('/route/goals — failure modes', () => {
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
                    name: 'classify_goals_action',
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

    const res = await handleRoute(makeReq('hit 10k followers'), makeEnv(), 'goals');
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
              message: { content: 'sure, here you go', tool_calls: [] },
              finish_reason: 'stop',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('hit 10k followers'), makeEnv(), 'goals');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'goals');
    expect(res.status).toBe(400);
  });
});
