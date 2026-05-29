/**
 * Tests for /route/pets — pets-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - log_care golden ×2: EN (brushing), TR (bath / banyo).
 *   - log_observation golden ×2: EN (lethargic), ES (species-only → no petName).
 *   - log_vet golden ×2: EN (checkup + proper name), TR (species-only → no petName).
 *   - log_feed golden ×2: EN (guineapig + proper name), ES (species-only → no petName).
 *   - log_supplement golden ×2: EN (vitamin_c typed), TR (calcium typed).
 *   - petName discipline ×3:
 *       1. "i fed my guineapig tontin" → petName="tontin", "guineapig" NOT in petName.
 *       2. "fed the cat" → no petName at all.
 *       3. "noticed my rabbit olivia has a limp" → petName="olivia", NOT "rabbit".
 *   - supplement typing ×2: vitamin_c snake_case, calcium snake_case.
 *   - Tier ladder: escalation smoke (8B confidence < 0.7 → GPT-OSS 120B) + stop at 8B.
 *   - Low-confidence demote: ambiguous fragment confidence < 0.7.
 *   - JSON-mode failure modes: bad tool args JSON → 502, no tool_calls → 502, empty text → 400.
 *
 * petName discipline is the critical invariant for this module.
 * "guineapig" / "rabbit" / "cat" / "dog" MUST NEVER appear as petName values.
 *
 * Mock strategy mirrors habits-route.test.ts exactly:
 *   Voyage (always OK, 1024-d vector), Supabase RPC (always cache miss),
 *   Groq (keyed off `model` field):
 *     - "llama-3.1-8b-instant"  → fast tier reply (per-fixture confidence)
 *     - "openai/gpt-oss-120b"   → accurate tier reply (always high conf)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  PETS_MODEL_FAST,
  PETS_MODEL_ACCURATE,
  type PetsAction,
} from '../src/modules/pets.config';

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
  return new Request('https://worker.dev/route/pets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ────────────────────────────────────────────────────────────

interface PetsFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: PetsAction;
  expectedPayload: Record<string, unknown>;
  /** Fields that MUST NOT be present in payload (e.g. species words in petName). */
  forbiddenPayloadValues?: string[];
  /** Confidence the 8B mock should return. */
  fastConfidence: number;
  /** True when we expect the tier ladder to escalate to GPT-OSS 120B. */
  expectEscalation: boolean;
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES: PetsFixture[] = [
  // ── log_care (2) ────────────────────────────────────────────────────────────
  {
    desc: 'EN "brushed tontin" → log_care + what + petName proper noun',
    lang: 'en', text: 'brushed tontin',
    expectedAction: 'log_care',
    expectedPayload: { what: 'brushed', petName: 'tontin' },
    fastConfidence: 0.96, expectEscalation: false,
  },
  {
    desc: 'TR "pinpon\'u banyo yaptım" → log_care + what=bath + petName pinpon',
    lang: 'tr', text: "pinpon'u banyo yaptım",
    expectedAction: 'log_care',
    expectedPayload: { what: 'bath', petName: 'pinpon' },
    fastConfidence: 0.95, expectEscalation: false,
  },

  // ── log_observation (2) ─────────────────────────────────────────────────────
  {
    desc: 'EN "tontin seems lethargic today" → log_observation + note + petName',
    lang: 'en', text: 'tontin seems lethargic today',
    expectedAction: 'log_observation',
    expectedPayload: { petName: 'tontin' },
    fastConfidence: 0.94, expectEscalation: false,
  },
  {
    desc: 'ES "el gato está comiendo menos" → log_observation, species only → no petName',
    lang: 'es', text: 'el gato está comiendo menos',
    expectedAction: 'log_observation',
    expectedPayload: {},
    forbiddenPayloadValues: ['gato'],
    fastConfidence: 0.92, expectEscalation: false,
  },

  // ── log_vet (2) ─────────────────────────────────────────────────────────────
  {
    desc: 'EN "vet for pinpon checkup" → log_vet + reason + petName',
    lang: 'en', text: 'vet for pinpon checkup',
    expectedAction: 'log_vet',
    expectedPayload: { petName: 'pinpon' },
    fastConfidence: 0.95, expectEscalation: false,
  },
  {
    desc: 'TR "guinea pigu veterinere götürdüm kontrol için" → log_vet, species only → no petName',
    lang: 'tr', text: 'guinea pigu veterinere götürdüm kontrol için',
    expectedAction: 'log_vet',
    expectedPayload: {},
    forbiddenPayloadValues: ['guinea pig', 'guineapig', 'guinea'],
    fastConfidence: 0.93, expectEscalation: false,
  },

  // ── log_feed (2) ────────────────────────────────────────────────────────────
  {
    desc: 'EN "i fed my guineapig tontin" → log_feed + petName=tontin (NOT guineapig)',
    lang: 'en', text: 'i fed my guineapig tontin',
    expectedAction: 'log_feed',
    expectedPayload: { petName: 'tontin' },
    forbiddenPayloadValues: ['guineapig', 'guinea pig'],
    fastConfidence: 0.97, expectEscalation: false,
  },
  {
    desc: 'ES "di de comer al perro" → log_feed, species only → no petName',
    lang: 'es', text: 'di de comer al perro',
    expectedAction: 'log_feed',
    expectedPayload: {},
    forbiddenPayloadValues: ['perro'],
    fastConfidence: 0.96, expectEscalation: false,
  },

  // ── log_supplement (2) ──────────────────────────────────────────────────────
  {
    desc: 'EN "gave tontin vitamin c" → log_supplement + supplement=vitamin_c + petName',
    lang: 'en', text: 'gave tontin vitamin c',
    expectedAction: 'log_supplement',
    expectedPayload: { supplement: 'vitamin_c', petName: 'tontin' },
    fastConfidence: 0.95, expectEscalation: false,
  },
  {
    desc: 'TR "pinpon calcium aldı" → log_supplement + supplement=calcium + petName',
    lang: 'tr', text: 'pinpon calcium aldı',
    expectedAction: 'log_supplement',
    expectedPayload: { supplement: 'calcium', petName: 'pinpon' },
    fastConfidence: 0.94, expectEscalation: false,
  },

  // ── escalation path (1) ─────────────────────────────────────────────────────
  {
    desc: 'ambiguous fragment → escalates to GPT-OSS 120B when 8B confidence low',
    lang: 'en', text: 'did something with the pet maybe',
    expectedAction: 'log_care',
    expectedPayload: {},
    fastConfidence: 0.55, expectEscalation: true,
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
              name: 'classify_pets_action',
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

function makeFixtureFetch(fixture: PetsFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === PETS_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === PETS_MODEL_ACCURATE) {
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

describe('/route/pets — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'pets');
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

      // log_care requires non-empty what
      if (fx.expectedAction === 'log_care') {
        if (fx.expectedPayload.what !== undefined) {
          expect(typeof body.classification.payload.what).toBe('string');
          expect((body.classification.payload.what as string).length).toBeGreaterThan(0);
        }
      }

      // log_observation requires non-empty note
      if (fx.expectedAction === 'log_observation' && fx.expectedPayload.note !== undefined) {
        expect(typeof body.classification.payload.note).toBe('string');
        expect((body.classification.payload.note as string).length).toBeGreaterThan(0);
      }

      // log_supplement requires non-empty supplement
      if (fx.expectedAction === 'log_supplement') {
        expect(typeof body.classification.payload.supplement).toBe('string');
        expect((body.classification.payload.supplement as string).length).toBeGreaterThan(0);
      }
    });
  }
});

// ─── suite: petName discipline (the critical invariant) ───────────────────────
//
// These tests assert that species words NEVER appear as petName values.
// "guineapig" / "rabbit" / "cat" / "dog" are species — not names.

describe('/route/pets — petName discipline', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePetNameFetch(payload: Record<string, unknown>) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('voyageai.com')) {
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
          { status: 200 },
        );
      }
      if (url.includes('routing_cache_lookup')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('api.groq.com')) {
        const body = JSON.parse((init?.body as string) ?? '{}') as GroqRequestBody;
        void body;
        return makeGroqResp({
          action: 'log_feed',
          payload,
          confidence: 0.97,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    };
  }

  it('"i fed my guineapig tontin" — petName must be "tontin", NOT "guineapig"', async () => {
    fetchSpy.mockImplementation(
      makePetNameFetch({ petName: 'tontin' }) as unknown as typeof fetch,
    );
    const res = await handleRoute(makeReq('i fed my guineapig tontin'), makeEnv(), 'pets');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { payload: Record<string, unknown> };
    };
    // petName must be the proper noun
    expect(body.classification.payload.petName).toBe('tontin');
    // The word "guineapig" must NOT appear as petName
    expect(body.classification.payload.petName).not.toBe('guineapig');
    expect(body.classification.payload.petName).not.toBe('guinea pig');
    // Nor should "guineapig" appear anywhere in any string payload field
    for (const v of Object.values(body.classification.payload)) {
      if (typeof v === 'string') {
        expect(v.toLowerCase()).not.toContain('guineapig');
        expect(v.toLowerCase()).not.toContain('guinea pig');
      }
    }
  });

  it('"fed the cat" — species only, petName must be absent', async () => {
    fetchSpy.mockImplementation(
      makePetNameFetch({}) as unknown as typeof fetch,
    );
    const res = await handleRoute(makeReq('fed the cat'), makeEnv(), 'pets');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { payload: Record<string, unknown> };
    };
    // petName must not be present when only species mentioned
    expect(body.classification.payload.petName).toBeUndefined();
    // "cat" must not appear as petName
    expect(body.classification.payload.petName).not.toBe('cat');
  });

  it('"noticed my rabbit olivia has a limp" — petName must be "olivia", NOT "rabbit"', async () => {
    fetchSpy.mockImplementation(
      makePetNameFetch({ note: 'has a limp', petName: 'olivia' }) as unknown as typeof fetch,
    );
    const res = await handleRoute(
      makeReq('noticed my rabbit olivia has a limp'),
      makeEnv(),
      'pets',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { payload: Record<string, unknown> };
    };
    expect(body.classification.payload.petName).toBe('olivia');
    expect(body.classification.payload.petName).not.toBe('rabbit');
  });
});

// ─── suite: supplement typing ──────────────────────────────────────────────────

describe('/route/pets — supplement typing', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeSupplementFetch(supplement: string, petName?: string) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('voyageai.com')) {
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }),
          { status: 200 },
        );
      }
      if (url.includes('routing_cache_lookup')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('api.groq.com')) {
        const body = JSON.parse((init?.body as string) ?? '{}') as GroqRequestBody;
        void body;
        const payload: Record<string, unknown> = { supplement };
        if (petName) payload.petName = petName;
        return makeGroqResp({
          action: 'log_supplement',
          payload,
          confidence: 0.95,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    };
  }

  it('"gave tontin vitamin c" → supplement="vitamin_c" (snake_case typed form)', async () => {
    fetchSpy.mockImplementation(
      makeSupplementFetch('vitamin_c', 'tontin') as unknown as typeof fetch,
    );
    const res = await handleRoute(makeReq('gave tontin vitamin c'), makeEnv(), 'pets');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { payload: Record<string, unknown> };
    };
    expect(body.classification.payload.supplement).toBe('vitamin_c');
    expect(body.classification.payload.petName).toBe('tontin');
  });

  it('"pinpon calcium aldı" → supplement="calcium" (snake_case typed form)', async () => {
    fetchSpy.mockImplementation(
      makeSupplementFetch('calcium', 'pinpon') as unknown as typeof fetch,
    );
    const res = await handleRoute(makeReq('pinpon calcium aldı'), makeEnv(), 'pets');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { payload: Record<string, unknown> };
    };
    expect(body.classification.payload.supplement).toBe('calcium');
    expect(body.classification.payload.petName).toBe('pinpon');
  });
});

// ─── suite: tier ladder contract ─────────────────────────────────────────────

describe('/route/pets — tier ladder contract', () => {
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
        const isLow = body.model === PETS_MODEL_FAST;
        return makeGroqResp({
          action: 'log_care',
          payload: { what: 'something unclear' },
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('did something with the pet maybe'), makeEnv(), 'pets');
    expect(res.status).toBe(200);
    expect(models).toEqual([PETS_MODEL_FAST, PETS_MODEL_ACCURATE]);
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
          action: 'log_feed',
          payload: { petName: 'tontin' },
          confidence: 0.97,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('fed tontin'), makeEnv(), 'pets');
    expect(res.status).toBe(200);
    expect(models).toEqual([PETS_MODEL_FAST]);
  });
});

// ─── suite: low-confidence demote ─────────────────────────────────────────────

describe('/route/pets — low-confidence demote', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns result even when both tiers return confidence < 0.7 (router accepts, downstream demotes)', async () => {
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
        void body;
        return makeGroqResp({
          action: 'log_observation',
          payload: { note: 'something unclear about the pet' },
          confidence: 0.5,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(
      makeReq('something unclear about an animal'),
      makeEnv(),
      'pets',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { action: string; confidence: number };
    };
    // Route layer delivers the best result; confidence is what the model said
    expect(body.classification.action).toBeDefined();
    expect(typeof body.classification.confidence).toBe('number');
  });
});

// ─── suite: failure modes ────────────────────────────────────────────────────

describe('/route/pets — failure modes', () => {
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
                    name: 'classify_pets_action',
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

    const res = await handleRoute(makeReq('fed tontin'), makeEnv(), 'pets');
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
              message: { content: 'pets are cool', tool_calls: [] },
              finish_reason: 'stop',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('fed tontin'), makeEnv(), 'pets');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'pets');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown module', async () => {
    const req = new Request('https://worker.dev/route/unknownmodule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'fed tontin' }),
    });
    fetchSpy.mockImplementation(async () => new Response('', { status: 200 }));
    const res = await handleRoute(req, makeEnv(), 'unknownmodule');
    expect(res.status).toBe(404);
  });
});
