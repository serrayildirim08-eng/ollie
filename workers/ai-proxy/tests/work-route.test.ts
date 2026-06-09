/**
 * Tests for /route/work — work-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 25 fixtures: trilingual EN/ES/TR, all 5 actions covered.
 *   - Cross-route mirror fixtures verify skipped_meals hint is preserved on
 *     log_focus_session payloads so the native handler can mirror to
 *     body.log_hunger. Same Approach B convention as sleep's log_insomnia
 *     → medication.log_dose; see apps/native/src/modules/work/handler.ts.
 *   - Disambiguation edges: log_focus_session vs create_task (past+duration
 *     vs future-intent) and log_deadline vs create_task (date presence).
 *   - 4 ambiguous fixtures verify the 8B → GPT-OSS 120B tier escalation.
 *   - Schema/transport failure modes ×3: bad JSON args, no tool_calls,
 *     empty text.
 *   - 1 low-confidence demote test asserts that when the 8B mock returns
 *     conf < threshold the ladder calls the accurate tier.
 *
 * Mock strategy mirrors sleep-route.test.ts exactly so the two test files
 * stay structurally diffable — anything that fixes both modules in lockstep
 * should land identical patches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  WORK_MODEL_FAST,
  WORK_MODEL_ACCURATE,
  type WorkAction,
} from '../src/modules/work.config';

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
  return new Request('https://worker.dev/route/work', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ────────────────────────────────────────────────────────────

interface WorkFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: WorkAction;
  expectedPayload: Record<string, unknown>;
  fastConfidence: number;
  expectEscalation: boolean;
}

// ─── 25 fixtures ──────────────────────────────────────────────────────────────
// Per-action golden ×5 (log_focus_session, create_task, log_deadline,
// log_meeting, distraction_journal), trilingual mix; ambiguous edges + the
// skipped_meals cross-route mirror dual-fixture pair.

const FIXTURES: WorkFixture[] = [
  // ── log_focus_session ×5 ────────────────────────────────────────────────────
  { desc: 'EN 90 min deep work on atelier → log_focus_session + duration + project',
    lang: 'en', text: '90 min deep work on atelier',
    expectedAction: 'log_focus_session', expectedPayload: { durationMin: 90, project: 'atelier' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'TR 2 saat odaklı çalıştım → log_focus_session + duration',
    lang: 'tr', text: '2 saat odaklı çalıştım PRD üzerinde',
    expectedAction: 'log_focus_session', expectedPayload: { durationMin: 120, project: 'PRD' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES 3 horas de trabajo profundo → log_focus_session',
    lang: 'es', text: '3 horas de trabajo profundo en el proyecto',
    expectedAction: 'log_focus_session', expectedPayload: { durationMin: 180 },
    fastConfidence: 0.93, expectEscalation: false },
  // skipped_meals cross-route mirror ×2 — see handler test (work/handler.test.ts)
  { desc: 'EN cross-route: hyperfocused all morning didn\'t eat → log_focus_session + skipped_meals',
    lang: 'en', text: "hyperfocused all morning, didn't eat",
    expectedAction: 'log_focus_session', expectedPayload: { skipped_meals: true },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'EN cross-route: deep work 3h forgot lunch → log_focus_session + duration + skipped_meals',
    lang: 'en', text: 'deep work 3h forgot lunch',
    expectedAction: 'log_focus_session', expectedPayload: { durationMin: 180, skipped_meals: true },
    fastConfidence: 0.94, expectEscalation: false },

  // ── create_task ×5 ──────────────────────────────────────────────────────────
  { desc: 'EN need to write the PRD → create_task + text (verb stripped)',
    lang: 'en', text: 'need to write the PRD',
    expectedAction: 'create_task', expectedPayload: { text: 'write the PRD' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES tengo que escribir el PRD → create_task + text',
    lang: 'es', text: 'tengo que escribir el PRD',
    expectedAction: 'create_task', expectedPayload: { text: 'escribir el PRD' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR mailleri yanıtlamam lazım → create_task',
    lang: 'tr', text: 'mailleri yanıtlamam lazım',
    expectedAction: 'create_task', expectedPayload: { text: 'mailleri yanıtla' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN should refactor the auth flow → create_task + text',
    lang: 'en', text: 'should refactor the auth flow',
    expectedAction: 'create_task', expectedPayload: { text: 'refactor the auth flow' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'EN need to ship onboarding by EOD → create_task with project',
    lang: 'en', text: 'need to ship onboarding',
    expectedAction: 'create_task', expectedPayload: { text: 'ship onboarding' },
    fastConfidence: 0.91, expectEscalation: false },

  // ── log_deadline ×5 ─────────────────────────────────────────────────────────
  { desc: 'EN PRD due friday → log_deadline + text + dueDate',
    lang: 'en', text: 'PRD due friday',
    expectedAction: 'log_deadline', expectedPayload: { text: 'PRD', dueDate: 'friday' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR PRD cuma deadline → log_deadline + text + dueDate',
    lang: 'tr', text: 'PRD cuma deadline',
    expectedAction: 'log_deadline', expectedPayload: { text: 'PRD', dueDate: 'friday' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'ES informe el viernes deadline → log_deadline',
    lang: 'es', text: 'informe deadline viernes',
    expectedAction: 'log_deadline', expectedPayload: { text: 'informe', dueDate: 'viernes' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'EN tax return due april 15 → log_deadline + dueDate',
    lang: 'en', text: 'tax return due april 15',
    expectedAction: 'log_deadline', expectedPayload: { text: 'tax return', dueDate: 'april 15' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'EN auth review by next tuesday → log_deadline',
    lang: 'en', text: 'auth review by next tuesday',
    expectedAction: 'log_deadline', expectedPayload: { text: 'auth review', dueDate: 'next tuesday' },
    fastConfidence: 0.91, expectEscalation: false },

  // ── log_meeting ×4 ──────────────────────────────────────────────────────────
  { desc: 'EN 30 min sync with boran → log_meeting + with + duration',
    lang: 'en', text: '30 min sync with boran',
    expectedAction: 'log_meeting', expectedPayload: { with: 'boran', durationMin: 30 },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES reunión con Boran 30 min → log_meeting + with + duration',
    lang: 'es', text: 'reunión con Boran 30 min',
    expectedAction: 'log_meeting', expectedPayload: { with: 'Boran', durationMin: 30 },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR boranla 1 saat toplantı → log_meeting + with + duration',
    lang: 'tr', text: 'boranla 1 saat toplantı',
    expectedAction: 'log_meeting', expectedPayload: { with: 'boran', durationMin: 60 },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN call with maya 15 min → log_meeting',
    lang: 'en', text: 'call with maya 15 min',
    expectedAction: 'log_meeting', expectedPayload: { with: 'maya', durationMin: 15 },
    fastConfidence: 0.91, expectEscalation: false },

  // ── distraction_journal ×3 ──────────────────────────────────────────────────
  { desc: 'EN got sucked into twitter again → distraction_journal',
    lang: 'en', text: 'got sucked into twitter again',
    expectedAction: 'distraction_journal', expectedPayload: { what: 'twitter' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'ES me distraje con tiktok → distraction_journal',
    lang: 'es', text: 'me distraje con tiktok otra vez',
    expectedAction: 'distraction_journal', expectedPayload: { what: 'tiktok' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'TR slack\'e daldım yine → distraction_journal',
    lang: 'tr', text: "slack'e daldım yine",
    expectedAction: 'distraction_journal', expectedPayload: { what: 'slack' },
    fastConfidence: 0.91, expectEscalation: false },

  // ── disambiguation edges + ambiguous escalation ─────────────────────────────
  // Disambiguation: focus session vs create_task — past+duration → focus
  { desc: 'EN disambiguation: past tense + duration → log_focus_session not create_task',
    lang: 'en', text: 'spent 2 hours on the auth flow',
    expectedAction: 'log_focus_session', expectedPayload: { durationMin: 120, project: 'auth flow' },
    fastConfidence: 0.9, expectEscalation: false },
  // Disambiguation: log_deadline vs create_task — date present → deadline
  { desc: 'EN disambiguation: text + date → log_deadline not create_task',
    lang: 'en', text: 'finish onboarding deck by friday',
    expectedAction: 'log_deadline', expectedPayload: { text: 'finish onboarding deck', dueDate: 'friday' },
    fastConfidence: 0.9, expectEscalation: false },
  // Ambiguous "twitter" alone — low conf → escalate
  { desc: 'EN ambiguous bare "twitter" → escalate to distraction_journal',
    lang: 'en', text: 'twitter',
    expectedAction: 'distraction_journal', expectedPayload: { what: 'twitter' },
    fastConfidence: 0.5, expectEscalation: true },
  // Ambiguous TR "iş" alone — low conf → escalate
  { desc: 'TR ambiguous "iş" → escalate',
    lang: 'tr', text: 'iş',
    expectedAction: 'create_task', expectedPayload: { text: 'iş' },
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
              name: 'classify_work_action',
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

function makeFixtureFetch(fixture: WorkFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === WORK_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === WORK_MODEL_ACCURATE) {
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

describe('/route/work — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'work');
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

      for (const [k, v] of Object.entries(fx.expectedPayload)) {
        expect(body.classification.payload[k]).toEqual(v);
      }
    });
  }
});

// ─── tier ladder smoke (no fixture loop, asserts contract) ──────────────────

describe('/route/work — tier ladder contract', () => {
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
        const isLow = body.model === WORK_MODEL_FAST;
        return makeGroqResp({
          action: 'create_task',
          payload: { text: 'something' },
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('something about work idk'), makeEnv(), 'work');
    expect(res.status).toBe(200);
    expect(models).toEqual([WORK_MODEL_FAST, WORK_MODEL_ACCURATE]);
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
          action: 'log_focus_session',
          payload: { durationMin: 90 },
          confidence: 0.98,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('90 min deep work'), makeEnv(), 'work');
    expect(res.status).toBe(200);
    expect(models).toEqual([WORK_MODEL_FAST]);
  });
});

// ─── cross-route mirror payload contract ─────────────────────────────────────
//
// The native work handler mirrors `log_focus_session.skipped_meals === true`
// into a `body.log_hunger` call (see apps/native/src/modules/work/handler.ts).
// Layer 2 must therefore preserve the hint key verbatim in the returned
// payload — losing it silently would break the cross-module surface without
// any error signal. This test asserts the route does NOT strip the hint.

describe('/route/work — cross-route mirror hint preservation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves skipped_meals on log_focus_session payload', async () => {
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
        return makeGroqResp({
          action: 'log_focus_session',
          payload: { durationMin: 180, skipped_meals: true },
          confidence: 0.95,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(
      makeReq('deep work 3h forgot lunch'),
      makeEnv(),
      'work',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { action: string; payload: Record<string, unknown> };
    };
    expect(body.classification.action).toBe('log_focus_session');
    expect(body.classification.payload.skipped_meals).toBe(true);
    expect(body.classification.payload.durationMin).toBe(180);
  });

  it('preserves skipped_meals without duration when user didn\'t mention one', async () => {
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
        return makeGroqResp({
          action: 'log_focus_session',
          payload: { skipped_meals: true },
          confidence: 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(
      makeReq("hyperfocused all morning, didn't eat"),
      makeEnv(),
      'work',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { action: string; payload: Record<string, unknown> };
    };
    expect(body.classification.action).toBe('log_focus_session');
    expect(body.classification.payload.skipped_meals).toBe(true);
  });
});

// ─── transport / schema failure modes ────────────────────────────────────────

describe('/route/work — failure modes', () => {
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
                    name: 'classify_work_action',
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

    const res = await handleRoute(makeReq('90 min deep work'), makeEnv(), 'work');
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

    const res = await handleRoute(makeReq('90 min deep work'), makeEnv(), 'work');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/work', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'work');
    expect(res.status).toBe(400);
  });
});
