/**
 * Tests for /route/medication — medication-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 12 fixtures: 4 EN, 4 ES, 4 TR covering all 3 medication actions.
 *   - 3 ambiguous fixtures verify the 8B → GPT-OSS 120B tier escalation
 *     kicks in when the cheap model returns confidence < 0.7.
 *   - medName REQUIRED: every fixture asserts medName is present and non-empty.
 *   - PII passthrough: common drug names (Zoloft, Adderall, sertraline,
 *     metformin, ibuprofen, vitamin D, melatonin, Wellbutrin, ozempic,
 *     lisinopril) must NOT be scrubbed before reaching the classifier.
 *   - Schema/transport failure modes: bad JSON arg + tool_calls missing.
 *
 * Mock strategy mirrors sleep-route.test.ts exactly:
 *   Voyage (always OK, 1024-d vector), Supabase RPC (always cache miss),
 *   Groq (keys off `model` field):
 *     - "llama-3.1-8b-instant"  → fast tier reply (per-fixture confidence)
 *     - "openai/gpt-oss-120b"   → accurate tier reply (always high conf)
 *   Ambiguous fixtures: 8B returns confidence 0.5 → escalation asserted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  MEDICATION_MODEL_FAST,
  MEDICATION_MODEL_ACCURATE,
  type MedicationAction,
} from '../src/modules/medication.config';
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
  return new Request('https://worker.dev/route/medication', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ────────────────────────────────────────────────────────────

interface MedFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: MedicationAction;
  expectedPayload: Record<string, unknown>;
  /** Confidence the 8B mock should return. */
  fastConfidence: number;
  /** True when we expect the tier ladder to escalate to GPT-OSS 120B. */
  expectEscalation: boolean;
}

// ─── 12 fixtures (+ 3 ambiguous = 15 total) ──────────────────────────────────
// 4 EN, 4 ES, 4 TR across all 3 actions.
// 3 ambiguous fixtures (fastConfidence 0.5) exercise escalation.

const FIXTURES: MedFixture[] = [
  // ── EN (4) ──────────────────────────────────────────────────────────────────
  { desc: 'EN took 50mg sertraline → log_dose + medName + dose',
    lang: 'en', text: 'took 50mg sertraline this morning',
    expectedAction: 'log_dose', expectedPayload: { medName: 'sertraline', dose: '50mg' },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'EN forgot my Adderall → missed_dose + medName',
    lang: 'en', text: 'forgot my Adderall',
    expectedAction: 'missed_dose', expectedPayload: { medName: 'Adderall' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN sertraline making me nauseous → side_effect_note + medName + note',
    lang: 'en', text: 'sertraline making me nauseous',
    expectedAction: 'side_effect_note', expectedPayload: { medName: 'sertraline', note: 'making me nauseous' },
    fastConfidence: 0.95, expectEscalation: false },
  // Ambiguous: "took my meds" — no dose, vague medName, needs escalation
  { desc: 'EN ambiguous "took my meds" → escalate to log_dose',
    lang: 'en', text: 'took my meds',
    expectedAction: 'log_dose', expectedPayload: { medName: 'my meds' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── ES (4) ──────────────────────────────────────────────────────────────────
  { desc: 'ES tomé la metformina → log_dose + medName',
    lang: 'es', text: 'tomé la metformina esta mañana',
    expectedAction: 'log_dose', expectedPayload: { medName: 'metformina' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES se me olvidó la pastilla → missed_dose + medName',
    lang: 'es', text: 'se me olvidó la pastilla',
    expectedAction: 'missed_dose', expectedPayload: { medName: 'la pastilla' },
    fastConfidence: 0.87, expectEscalation: false },
  { desc: 'ES Ozempic me da náuseas → side_effect_note + medName + note',
    lang: 'es', text: 'Ozempic me da náuseas',
    expectedAction: 'side_effect_note', expectedPayload: { medName: 'Ozempic', note: 'me da náuseas' },
    fastConfidence: 0.93, expectEscalation: false },
  // Ambiguous: "no tomé nada" — unclear if missed or just no dose
  { desc: 'ES ambiguous "no tomé nada" → escalate to missed_dose',
    lang: 'es', text: 'no tomé nada esta mañana',
    expectedAction: 'missed_dose', expectedPayload: { medName: 'nada' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── TR (4) ──────────────────────────────────────────────────────────────────
  { desc: 'TR ilacımı aldım → log_dose + medName',
    lang: 'tr', text: 'ilacımı aldım',
    expectedAction: 'log_dose', expectedPayload: { medName: 'ilacımı' },
    fastConfidence: 0.88, expectEscalation: false },
  { desc: 'TR Wellbutrin baş ağrısı yapıyor → side_effect_note + medName + note',
    lang: 'tr', text: 'Wellbutrin bana iyi gelmiyor, baş ağrısı yapıyor',
    expectedAction: 'side_effect_note', expectedPayload: { medName: 'Wellbutrin', note: 'baş ağrısı yapıyor' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR Adderall almayı unuttum → missed_dose + medName',
    lang: 'tr', text: 'Adderall almayı unuttum',
    expectedAction: 'missed_dose', expectedPayload: { medName: 'Adderall' },
    fastConfidence: 0.93, expectEscalation: false },
  // Ambiguous: "ilaç aldım ama mı?" — uncertain action
  { desc: 'TR ambiguous "vitamin D aldım mı bilmiyorum" → escalate to log_dose',
    lang: 'tr', text: 'vitamin D aldım mı bilmiyorum',
    expectedAction: 'log_dose', expectedPayload: { medName: 'vitamin D' },
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
              name: 'classify_medication_action',
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

function makeFixtureFetch(fixture: MedFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === MEDICATION_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === MEDICATION_MODEL_ACCURATE) {
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

describe('/route/medication — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'medication');
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

      // medName REQUIRED — must always be present and non-empty
      expect(typeof body.classification.payload.medName).toBe('string');
      expect((body.classification.payload.medName as string).length).toBeGreaterThan(0);

      // Key payload fields match — every expected key must be present and equal.
      for (const [k, v] of Object.entries(fx.expectedPayload)) {
        expect(body.classification.payload[k]).toEqual(v);
      }
    });
  }
});

// ─── tier ladder smoke ────────────────────────────────────────────────────────

describe('/route/medication — tier ladder contract', () => {
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
        const isLow = body.model === MEDICATION_MODEL_FAST;
        return makeGroqResp({
          action: 'log_dose',
          payload: { medName: 'something unclear' },
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('took something idk what'), makeEnv(), 'medication');
    expect(res.status).toBe(200);
    expect(models).toEqual([MEDICATION_MODEL_FAST, MEDICATION_MODEL_ACCURATE]);
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
          action: 'log_dose',
          payload: { medName: 'sertraline', dose: '50mg' },
          confidence: 0.97,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('took 50mg sertraline'), makeEnv(), 'medication');
    expect(res.status).toBe(200);
    expect(models).toEqual([MEDICATION_MODEL_FAST]);
  });
});

// ─── PII allowlist — drug names must survive scrubPII ────────────────────────
//
// Without medName surviving the scrubber, medication Layer 2 is useless.
// If a future pii.ts update adds a medical category, this test catches it.

describe('/route/medication — PII allowlist defensive', () => {
  it('common drug names survive scrubPII unchanged', () => {
    const drugs = [
      'Zoloft',
      'Adderall',
      'sertraline',
      'metformin',
      'ibuprofen',
      'vitamin D',
      'melatonin',
      'Wellbutrin',
      'ozempic',
      'lisinopril',
    ];
    for (const drug of drugs) {
      const phrase = `took my ${drug} this morning`;
      const { scrubbed } = scrubPII(phrase);
      expect(scrubbed).toContain(drug);
    }
  });
});

// ─── transport / schema failure modes ────────────────────────────────────────

describe('/route/medication — failure modes', () => {
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
                    name: 'classify_medication_action',
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

    const res = await handleRoute(makeReq('took sertraline'), makeEnv(), 'medication');
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

    const res = await handleRoute(makeReq('took sertraline'), makeEnv(), 'medication');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/medication', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'medication');
    expect(res.status).toBe(400);
  });
});
