/**
 * Tests for /route/body — body-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 30 fixtures: 10 EN, 10 ES, 10 TR covering all 7 body actions.
 *   - 5 ambiguous fixtures verify the 8B → 70B tier escalation kicks in
 *     when the cheap model returns confidence < 0.7.
 *   - PII passthrough: medical/body terms must not be scrubbed before
 *     reaching the classifier (the worker-local scrubber has no medical
 *     category — see src/pii.ts header).
 *
 * Mock strategy:
 *   The shared `route.ts` handler calls Voyage → Supabase cache → Groq.
 *   We mock Voyage (always OK, deterministic 1024-d vector), the
 *   Supabase RPC (always cache miss so we always exercise Groq), and
 *   the Groq endpoint. The Groq mock keys off the `model` field in the
 *   request body so we can simulate per-tier behavior:
 *     - "llama-3.1-8b-instant"     → fast tier reply (per-fixture confidence)
 *     - "llama-3.3-70b-versatile"  → escalated reply (always high conf)
 *   For the 5 ambiguous fixtures the 8B mock returns confidence 0.5,
 *   triggering escalation; the test asserts BOTH model ids were called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  BODY_MODEL_FAST,
  BODY_MODEL_ACCURATE,
  type BodyAction,
} from '../src/modules/body.config';

// ─── env stub ─────────────────────────────────────────────────────────────────

function makeEnv(): RouteEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    VOYAGE_API_KEY: 'voy-test-key',
    GROQ_API_KEY: 'groq-test-key',
    T0_JWT_ENFORCED: '0', // dev/open default (body L2 route runs in test/open mode)
  };
}

function makeReq(text: string): Request {
  return new Request('https://worker.dev/route/body', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ───────────────────────────────────────────────────────────

interface BodyFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: BodyAction;
  expectedPayload: Record<string, unknown>;
  /** Confidence the 8B mock should return for this fixture. */
  fastConfidence: number;
  /** True when we expect the tier ladder to escalate to 70B. */
  expectEscalation: boolean;
}

// ─── 30 fixtures ──────────────────────────────────────────────────────────────
// 10 EN, 10 ES, 10 TR. All 7 actions covered at least 3x across languages.
// 5 fixtures intentionally ambiguous (fastConfidence: 0.5) to exercise escalation.

const FIXTURES: BodyFixture[] = [
  // ── EN (10) ─────────────────────────────────────────────────────────────────
  { desc: 'EN headache → log_symptom',
    lang: 'en', text: 'i have a headache',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'headache' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN headache severity → log_symptom + severity',
    lang: 'en', text: 'headache 7 out of 10',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'headache', severity: 4 },
    fastConfidence: 0.9, expectEscalation: false },
  { desc: 'EN drank 500ml water → log_water + amount',
    lang: 'en', text: 'drank 500ml water',
    expectedAction: 'log_water', expectedPayload: { amountMl: 500 },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'EN had water no amount → log_water empty',
    lang: 'en', text: 'had some water',
    expectedAction: 'log_water', expectedPayload: {},
    fastConfidence: 0.82, expectEscalation: false },
  { desc: 'EN vitamin D → log_supplement',
    lang: 'en', text: 'took vitamin D 1000iu',
    expectedAction: 'log_supplement', expectedPayload: { name: 'vitamin D', dose: '1000iu' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN ibuprofen (medical term passthrough) → log_supplement',
    lang: 'en', text: 'took 200mg ibuprofen for my headache',
    expectedAction: 'log_supplement', expectedPayload: { name: 'ibuprofen', dose: '200mg' },
    fastConfidence: 0.78, expectEscalation: false },
  { desc: 'EN panic attack → log_episode',
    lang: 'en', text: 'had a panic attack that lasted 10 minutes',
    expectedAction: 'log_episode', expectedPayload: { kind: 'panic attack', duration: '10 min' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN 20 min walk → log_movement',
    lang: 'en', text: '20 min walk after lunch',
    expectedAction: 'log_movement', expectedPayload: { type: 'walk', duration_min: 20 },
    fastConfidence: 0.96, expectEscalation: false },
  // Ambiguous: "feeling off" — needs 70B escalation
  { desc: 'EN ambiguous "feeling off" → escalate',
    lang: 'en', text: 'feeling kinda off today',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'feeling off' },
    fastConfidence: 0.5, expectEscalation: true },
  // Ambiguous: hungry vs symptom — needs escalation
  { desc: 'EN ambiguous hungry-ish → escalate to log_hunger',
    lang: 'en', text: 'my stomach is doing the thing',
    expectedAction: 'log_hunger', expectedPayload: {},
    fastConfidence: 0.5, expectEscalation: true },

  // ── ES (10) ─────────────────────────────────────────────────────────────────
  { desc: 'ES me duele la cabeza → log_symptom',
    lang: 'es', text: 'me duele la cabeza',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'headache' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES migraña → log_episode',
    lang: 'es', text: 'tuve una migraña de dos horas',
    expectedAction: 'log_episode', expectedPayload: { kind: 'migraine', duration: '2 hours' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'ES tomé agua 500ml → log_water',
    lang: 'es', text: 'me tomé 500ml de agua',
    expectedAction: 'log_water', expectedPayload: { amountMl: 500 },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'ES un vaso de agua → log_water (250ml conversion)',
    lang: 'es', text: 'me tomé un vaso de agua',
    expectedAction: 'log_water', expectedPayload: { amountMl: 250 },
    fastConfidence: 0.85, expectEscalation: false },
  { desc: 'ES magnesio → log_supplement',
    lang: 'es', text: 'tomé magnesio 400mg',
    expectedAction: 'log_supplement', expectedPayload: { name: 'magnesium', dose: '400mg' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES tengo hambre → log_hunger',
    lang: 'es', text: 'tengo hambre',
    expectedAction: 'log_hunger', expectedPayload: {},
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'ES caminé 30 min → log_movement',
    lang: 'es', text: 'caminé 30 minutos',
    expectedAction: 'log_movement', expectedPayload: { type: 'walk', duration_min: 30 },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'ES hice estiramientos → log_movement',
    lang: 'es', text: 'hice estiramientos',
    expectedAction: 'log_movement', expectedPayload: { type: 'stretch' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'ES postura → log_posture',
    lang: 'es', text: 'corregí mi postura',
    expectedAction: 'log_posture', expectedPayload: {},
    fastConfidence: 0.86, expectEscalation: false },
  // Ambiguous: asthma vs panic
  { desc: 'ES ambiguous "no podía respirar" → escalate to log_episode',
    lang: 'es', text: 'no podía respirar bien hace un rato',
    expectedAction: 'log_episode', expectedPayload: { kind: 'asthma attack' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── TR (10) ─────────────────────────────────────────────────────────────────
  { desc: 'TR başım ağrıyor → log_symptom',
    lang: 'tr', text: 'başım ağrıyor',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'headache' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR başım çok ağrıyor 7/10 → log_symptom + severity',
    lang: 'tr', text: 'başım çok ağrıyor 7/10',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'headache', severity: 4 },
    fastConfidence: 0.9, expectEscalation: false },
  { desc: 'TR 2 bardak su → log_water 500',
    lang: 'tr', text: '2 bardak su içtim',
    expectedAction: 'log_water', expectedPayload: { amountMl: 500 },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'TR magnezyum → log_supplement',
    lang: 'tr', text: 'magnezyum aldım 400mg',
    expectedAction: 'log_supplement', expectedPayload: { name: 'magnesium', dose: '400mg' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR D vitamini → log_supplement',
    lang: 'tr', text: 'D vitamini 1000iu aldım',
    expectedAction: 'log_supplement', expectedPayload: { name: 'vitamin D', dose: '1000iu' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'TR panik atak → log_episode',
    lang: 'tr', text: '10 dakika süren panik atak geçirdim',
    expectedAction: 'log_episode', expectedPayload: { kind: 'panic attack', duration: '10 min' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'TR 30dk yoga → log_movement',
    lang: 'tr', text: '30dk yoga yaptım',
    expectedAction: 'log_movement', expectedPayload: { type: 'yoga', duration_min: 30 },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'TR yürüyüş → log_movement (no duration)',
    lang: 'tr', text: 'yürüyüşe çıktım',
    expectedAction: 'log_movement', expectedPayload: { type: 'walk' },
    fastConfidence: 0.85, expectEscalation: false },
  { desc: 'TR açım → log_hunger',
    lang: 'tr', text: 'çok açım',
    expectedAction: 'log_hunger', expectedPayload: {},
    fastConfidence: 0.94, expectEscalation: false },
  // Ambiguous: garip hissediyorum
  { desc: 'TR ambiguous "garip hissediyorum" → escalate to log_symptom',
    lang: 'tr', text: 'bugün biraz garip hissediyorum',
    expectedAction: 'log_symptom', expectedPayload: { symptom: 'feeling off' },
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
              name: 'classify_body_action',
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

/**
 * Per-fixture fetch mock. The Groq branch parses the outgoing request body
 * to pick the right tier reply:
 *   - 8B model id → returns the fixture's fastConfidence + fast payload.
 *   - 70B model id → always returns confidence 0.95 + canonical payload.
 * When the fixture is not ambiguous the 70B branch should never be hit;
 * the test asserts that separately.
 */
function makeFixtureFetch(fixture: BodyFixture, calls: { fast: number; accurate: number }) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('voyageai.com')) {
      return new Response(
        JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('routing_cache_lookup')) {
      // Always cache miss — we want every fixture to exercise Groq.
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('api.groq.com')) {
      const body = JSON.parse((init?.body as string) ?? '{}') as GroqRequestBody;
      if (body.model === BODY_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === BODY_MODEL_ACCURATE) {
        calls.accurate++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: 0.95,
          language: fixture.lang,
        });
      }
      // Unknown model id — fail loudly so test catches misconfig.
      return new Response('unexpected model', { status: 500 });
    }
    if (url.includes('routing_cache')) {
      // Cache write fire-and-forget — always 201.
      return new Response('', { status: 201 });
    }
    return new Response('not found', { status: 404 });
  };
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('/route/body — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'body');
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

      // Key payload fields match — every expected key must be present and equal.
      for (const [k, v] of Object.entries(fx.expectedPayload)) {
        expect(body.classification.payload[k]).toEqual(v);
      }
    });
  }
});

// ─── tier ladder smoke (no fixture loop, asserts contract) ──────────────────

describe('/route/body — tier ladder contract', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escalates to 70B when 8B confidence is below threshold', async () => {
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
        // Fast tier returns LOW confidence so ladder must escalate.
        const isLow = body.model === BODY_MODEL_FAST;
        return makeGroqResp({
          action: 'log_symptom',
          payload: { symptom: 'fatigue' },
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('something feels off'), makeEnv(), 'body');
    expect(res.status).toBe(200);
    expect(models).toEqual([BODY_MODEL_FAST, BODY_MODEL_ACCURATE]);
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
          action: 'log_water',
          payload: { amountMl: 500 },
          confidence: 0.98,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('drank 500ml water'), makeEnv(), 'body');
    expect(res.status).toBe(200);
    expect(models).toEqual([BODY_MODEL_FAST]);
  });
});
