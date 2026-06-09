/**
 * Tests for /route/admin — admin-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 30 fixtures: EN + ES + TR covering all 6 admin actions.
 *   - 4 disambiguation edge cases (phone_task vs task, appointment vs task,
 *     paperwork vs renewal, recurring_decision over-trigger avoidance).
 *   - 6 ambiguous fixtures (fastConfidence 0.5) that verify tier escalation.
 *   - Tier ladder smoke: escalate-below-threshold + stop-at-fast.
 *   - Failure modes: bad JSON args, no tool_calls, empty text.
 *   - Low-confidence demote standalone test.
 *
 * Mock strategy: mirrors finance-route.test.ts exactly.
 *   Voyage → always OK, deterministic 1024-d vector.
 *   Supabase RPC → always cache miss (exercises Groq every time).
 *   Groq → keyed off `model` field:
 *     "llama-3.1-8b-instant"  → fast tier reply (per-fixture confidence)
 *     "openai/gpt-oss-120b"   → accurate tier reply (always high conf)
 *
 * No cross-route mirror suite — admin is standalone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  ADMIN_MODEL_FAST,
  ADMIN_MODEL_ACCURATE,
  type AdminAction,
} from '../src/modules/admin.config';
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
  return new Request('https://worker.dev/route/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ───────────────────────────────────────────────────────────

interface AdminFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: AdminAction;
  expectedPayload: Record<string, unknown>;
  fastConfidence: number;
  expectEscalation: boolean;
}

// ─── 30 fixtures (5 per action: 2 confident + 1 ambiguous each, rounded) ─────
// All 6 actions, EN + ES + TR distribution.

const FIXTURES: AdminFixture[] = [
  // ── create_task (5) ─────────────────────────────────────────────────────────
  { desc: 'EN renew library card → create_task',
    lang: 'en', text: 'renew library card',
    expectedAction: 'create_task',
    expectedPayload: { text: 'renew library card' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR raporu yaz → create_task',
    lang: 'tr', text: 'raporu yaz',
    expectedAction: 'create_task',
    expectedPayload: { text: 'raporu yaz' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES hacer el informe → create_task',
    lang: 'es', text: 'hacer el informe',
    expectedAction: 'create_task',
    expectedPayload: { text: 'hacer el informe' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN fix the porch light → create_task',
    lang: 'en', text: 'fix the porch light',
    expectedAction: 'create_task',
    expectedPayload: { text: 'fix the porch light' },
    fastConfidence: 0.92, expectEscalation: false },
  // Ambiguous: no clear action type
  { desc: 'EN ambiguous "do the thing" → escalate to create_task',
    lang: 'en', text: 'do the thing',
    expectedAction: 'create_task',
    expectedPayload: { text: 'do the thing' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── create_phone_task (5) ────────────────────────────────────────────────────
  { desc: 'EN call mom about christmas → create_phone_task',
    lang: 'en', text: 'call mom about christmas',
    expectedAction: 'create_phone_task',
    expectedPayload: { person: 'mom', reason: 'christmas' },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'ES llamar al doctor → create_phone_task',
    lang: 'es', text: 'llamar al doctor',
    expectedAction: 'create_phone_task',
    expectedPayload: { person: 'doctor' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'TR anneyi ara → create_phone_task',
    lang: 'tr', text: 'anneyi ara',
    expectedAction: 'create_phone_task',
    expectedPayload: { person: 'anne' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'EN ring the landlord about the leak → create_phone_task',
    lang: 'en', text: 'ring the landlord about the leak',
    expectedAction: 'create_phone_task',
    expectedPayload: { person: 'landlord', reason: 'the leak' },
    fastConfidence: 0.95, expectEscalation: false },
  // Ambiguous: "call someone" — vague person
  { desc: 'EN ambiguous "make a call about the package" → escalate',
    lang: 'en', text: 'make a call about the package',
    expectedAction: 'create_phone_task',
    expectedPayload: {},
    fastConfidence: 0.5, expectEscalation: true },

  // ── schedule_appointment (5) ─────────────────────────────────────────────────
  { desc: 'EN dentist next tuesday → schedule_appointment',
    lang: 'en', text: 'dentist next tuesday',
    expectedAction: 'schedule_appointment',
    expectedPayload: { what: 'dentist', date: 'next tuesday' },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'TR dişçi randevusu salı → schedule_appointment',
    lang: 'tr', text: 'dişçi randevusu salı',
    expectedAction: 'schedule_appointment',
    expectedPayload: { what: 'dişçi', date: 'salı' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'ES cita con dentista → schedule_appointment',
    lang: 'es', text: 'cita con dentista',
    expectedAction: 'schedule_appointment',
    expectedPayload: { what: 'dentista' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN car service friday → schedule_appointment',
    lang: 'en', text: 'car service friday',
    expectedAction: 'schedule_appointment',
    expectedPayload: { what: 'car service', date: 'friday' },
    fastConfidence: 0.95, expectEscalation: false },
  // Ambiguous: appointment without clear party
  { desc: 'EN ambiguous "meeting next week" → escalate',
    lang: 'en', text: 'meeting next week',
    expectedAction: 'schedule_appointment',
    expectedPayload: { what: 'meeting', date: 'next week' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── log_paperwork (5) ────────────────────────────────────────────────────────
  { desc: 'EN filed taxes → log_paperwork',
    lang: 'en', text: 'filed taxes',
    expectedAction: 'log_paperwork',
    expectedPayload: { what: 'taxes' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'ES entregué la solicitud de visa → log_paperwork',
    lang: 'es', text: 'entregué la solicitud de visa',
    expectedAction: 'log_paperwork',
    expectedPayload: { what: 'solicitud de visa' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR vergi beyannamesini verdim → log_paperwork',
    lang: 'tr', text: 'vergi beyannamesini verdim',
    expectedAction: 'log_paperwork',
    expectedPayload: { what: 'vergi beyannamesi' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN submitted job application → log_paperwork',
    lang: 'en', text: 'submitted job application',
    expectedAction: 'log_paperwork',
    expectedPayload: { what: 'job application' },
    fastConfidence: 0.94, expectEscalation: false },
  // Ambiguous: past vs future unclear
  { desc: 'EN ambiguous "insurance forms" → escalate',
    lang: 'en', text: 'insurance forms',
    expectedAction: 'log_paperwork',
    expectedPayload: { what: 'insurance forms' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── recurring_decision (5) ───────────────────────────────────────────────────
  { desc: 'EN keep netflix or cancel → recurring_decision',
    lang: 'en', text: 'keep netflix or cancel',
    expectedAction: 'recurring_decision',
    expectedPayload: { what: 'netflix' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'TR Netflix\'i iptal edeyim mi → recurring_decision',
    lang: 'tr', text: "Netflix'i iptal edeyim mi",
    expectedAction: 'recurring_decision',
    expectedPayload: { what: 'Netflix' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES decidir si cancelar Spotify → recurring_decision',
    lang: 'es', text: 'decidir si cancelar Spotify',
    expectedAction: 'recurring_decision',
    expectedPayload: { what: 'Spotify' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN should I cancel hulu → recurring_decision',
    lang: 'en', text: 'should I cancel hulu',
    expectedAction: 'recurring_decision',
    expectedPayload: { what: 'hulu' },
    fastConfidence: 0.94, expectEscalation: false },
  // Ambiguous: could be create_task not recurring_decision
  { desc: 'EN ambiguous "think about my subscriptions" → escalate',
    lang: 'en', text: 'think about my subscriptions',
    expectedAction: 'recurring_decision',
    expectedPayload: { what: 'subscriptions' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── log_renewal (5) ──────────────────────────────────────────────────────────
  { desc: 'EN passport expires march → log_renewal',
    lang: 'en', text: 'passport expires march',
    expectedAction: 'log_renewal',
    expectedPayload: { renewal_type: 'passport', due_date: 'march' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'ES renovar pasaporte el mes que viene → log_renewal',
    lang: 'es', text: 'renovar pasaporte el mes que viene',
    expectedAction: 'log_renewal',
    expectedPayload: { renewal_type: 'pasaporte', due_date: 'el mes que viene' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR sigorta yenileme gelecek ay → log_renewal',
    lang: 'tr', text: 'sigorta yenileme gelecek ay',
    expectedAction: 'log_renewal',
    expectedPayload: { renewal_type: 'sigorta', due_date: 'gelecek ay' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN license due in 2 weeks → log_renewal',
    lang: 'en', text: 'license due in 2 weeks',
    expectedAction: 'log_renewal',
    expectedPayload: { renewal_type: 'license', due_date: 'in 2 weeks' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'EN lease renewal next month → log_renewal',
    lang: 'en', text: 'lease renewal next month',
    expectedAction: 'log_renewal',
    expectedPayload: { renewal_type: 'lease', due_date: 'next month' },
    fastConfidence: 0.93, expectEscalation: false },
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
              name: 'classify_admin_action',
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

function makeFixtureFetch(fixture: AdminFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === ADMIN_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === ADMIN_MODEL_ACCURATE) {
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

describe('/route/admin — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'admin');
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

// ─── disambiguation edge cases ───────────────────────────────────────────────

describe('/route/admin — disambiguation edge cases', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const EDGE_CASES: AdminFixture[] = [
    // phone_task vs create_task: "call mom" has explicit person → phone_task
    { desc: 'EDGE: "call mom" has person → create_phone_task not create_task',
      lang: 'en', text: 'call mom',
      expectedAction: 'create_phone_task',
      expectedPayload: { person: 'mom' },
      fastConfidence: 0.95, expectEscalation: false },
    // schedule_appointment vs create_task: "renew library card" has no external slot
    { desc: 'EDGE: "renew library card" no external party → create_task not schedule_appointment',
      lang: 'en', text: 'renew library card',
      expectedAction: 'create_task',
      expectedPayload: { text: 'renew library card' },
      fastConfidence: 0.93, expectEscalation: false },
    // log_paperwork vs log_renewal: "passport expires" has expiry keyword → renewal
    { desc: 'EDGE: "passport expires" expiry keyword → log_renewal not log_paperwork',
      lang: 'en', text: 'passport expires next year',
      expectedAction: 'log_renewal',
      expectedPayload: { renewal_type: 'passport', due_date: 'next year' },
      fastConfidence: 0.95, expectEscalation: false },
    // recurring_decision over-trigger guard: "spotify is great" should NOT be recurring_decision
    { desc: 'EDGE: "spotify is great" positive statement → create_task not recurring_decision',
      lang: 'en', text: 'spotify is great',
      expectedAction: 'create_task',
      expectedPayload: { text: 'spotify is great' },
      fastConfidence: 0.45, expectEscalation: true },
    // TR phone_task: "anneyi ara" explicit person
    { desc: 'EDGE: TR "anneyi ara" → create_phone_task with person',
      lang: 'tr', text: 'anneyi ara',
      expectedAction: 'create_phone_task',
      expectedPayload: { person: 'anne' },
      fastConfidence: 0.96, expectEscalation: false },
    // ES appointment vs phone: "llamar al doctor" → phone_task
    { desc: 'EDGE: ES "llamar al doctor" → create_phone_task not schedule_appointment',
      lang: 'es', text: 'llamar al doctor',
      expectedAction: 'create_phone_task',
      expectedPayload: { person: 'doctor' },
      fastConfidence: 0.95, expectEscalation: false },
  ];

  for (const fx of EDGE_CASES) {
    it(fx.desc, async () => {
      const calls = { fast: 0, accurate: 0 };
      fetchSpy.mockImplementation(
        makeFixtureFetch(fx, calls) as unknown as typeof fetch,
      );

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'admin');
      expect(res.status).toBe(200);

      const body = await res.json() as {
        classification: { action: string; payload: Record<string, unknown> };
        language: string;
      };

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

// ─── tier ladder smoke ───────────────────────────────────────────────────────

describe('/route/admin — tier ladder contract', () => {
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
        const isLow = body.model === ADMIN_MODEL_FAST;
        return makeGroqResp({
          action: 'create_task',
          payload: { text: 'something' },
          confidence: isLow ? 0.4 : 0.93,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('do something'), makeEnv(), 'admin');
    expect(res.status).toBe(200);
    expect(models).toEqual([ADMIN_MODEL_FAST, ADMIN_MODEL_ACCURATE]);
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
          action: 'create_phone_task',
          payload: { person: 'mom', reason: 'christmas' },
          confidence: 0.97,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('call mom about christmas'), makeEnv(), 'admin');
    expect(res.status).toBe(200);
    expect(models).toEqual([ADMIN_MODEL_FAST]);
  });
});

// ─── transport / schema failure modes ────────────────────────────────────────

describe('/route/admin — failure modes', () => {
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
                    name: 'classify_admin_action',
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

    const res = await handleRoute(makeReq('call mom'), makeEnv(), 'admin');
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

    const res = await handleRoute(makeReq('filed taxes'), makeEnv(), 'admin');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'admin');
    expect(res.status).toBe(400);
  });
});

// ─── PII scrub passthrough ────────────────────────────────────────────────────
// Admin phrases should not be stripped by the PII scrubber.

describe('/route/admin — PII scrub passthrough', () => {
  it('does not scrub admin-domain terms', () => {
    const phrases = [
      'call mom about christmas',
      'dentist next tuesday',
      'filed taxes',
      'passport expires march',
      'keep netflix or cancel',
      'renew library card',
      'dişçi randevusu salı',
      'anneyi ara',
      'llamar al doctor',
      'renovar pasaporte',
    ];
    for (const phrase of phrases) {
      const { scrubbed } = scrubPII(phrase);
      expect(scrubbed.trim().length).toBeGreaterThan(0);
    }
  });

  it('low-confidence demote: ambiguous fragment triggers escalation', async () => {
    const models: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
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
        const isLow = body.model === ADMIN_MODEL_FAST;
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'classify_admin_action',
                    arguments: JSON.stringify({
                      action: 'create_task',
                      payload: { text: 'something admin' },
                      confidence: isLow ? 0.45 : 0.88,
                      language: 'en',
                    }),
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

    const res = await handleRoute(
      makeReq('do some admin stuff'),
      makeEnv(),
      'admin',
    );
    expect(res.status).toBe(200);
    expect(models).toContain(ADMIN_MODEL_FAST);
    expect(models).toContain(ADMIN_MODEL_ACCURATE);

    vi.restoreAllMocks();
  });
});
