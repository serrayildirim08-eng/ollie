/**
 * Tests for /route/sleep — sleep-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 24 fixtures: 8 EN, 8 ES, 8 TR covering all 4 sleep actions.
 *   - 4 ambiguous fixtures verify the 8B → GPT-OSS 120B tier escalation
 *     kicks in when the cheap model returns confidence < 0.7.
 *   - Cross-route mirror: log_insomnia with `med_taken` preserves the hint
 *     key in the returned payload so the native handler can mirror to
 *     medication.log_dose downstream.
 *   - PII passthrough: sleep meds (melatonin/ambien/trazodone/mirtazapine/
 *     doxepin) must NOT be scrubbed before reaching the classifier — the
 *     worker-local scrubber has no medical category (src/pii.ts header).
 *   - Schema/transport failure modes: bad JSON arg + tool_calls missing.
 *
 * Mock strategy:
 *   The shared `route.ts` handler calls Voyage → Supabase cache → Groq.
 *   We mock Voyage (always OK, deterministic 1024-d vector), the Supabase
 *   RPC (always cache miss so we always exercise Groq), and the Groq
 *   endpoint. The Groq mock keys off the `model` field in the request
 *   body so we can simulate per-tier behavior:
 *     - "llama-3.1-8b-instant"     → fast tier reply (per-fixture confidence)
 *     - "openai/gpt-oss-120b"      → accurate tier reply (always high conf)
 *   For the 4 ambiguous fixtures the 8B mock returns confidence 0.5,
 *   triggering escalation; the test asserts BOTH model ids were called.
 *
 *   Pattern mirrors body-route.test.ts exactly so the two test files stay
 *   structurally diffable — anything that fixes both modules in lockstep
 *   should land identical patches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  SLEEP_MODEL_FAST,
  SLEEP_MODEL_ACCURATE,
  type SleepAction,
} from '../src/modules/sleep.config';
import { scrubPII } from '../src/pii';

// ─── env stub ─────────────────────────────────────────────────────────────────

function makeEnv(): RouteEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    VOYAGE_API_KEY: 'voy-test-key',
    GROQ_API_KEY: 'groq-test-key',
    T0_JWT_ENFORCED: '0', // dev/open default (sleep L2 route runs in test/open mode)
  };
}

function makeReq(text: string): Request {
  return new Request('https://worker.dev/route/sleep', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ───────────────────────────────────────────────────────────

interface SleepFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: SleepAction;
  expectedPayload: Record<string, unknown>;
  /** Confidence the 8B mock should return for this fixture. */
  fastConfidence: number;
  /** True when we expect the tier ladder to escalate to GPT-OSS 120B. */
  expectEscalation: boolean;
}

// ─── 24 fixtures ──────────────────────────────────────────────────────────────
// 8 EN, 8 ES, 8 TR. All 4 actions covered at least 4x across languages.
// 4 fixtures intentionally ambiguous (fastConfidence: 0.5) to exercise escalation.

const FIXTURES: SleepFixture[] = [
  // ── EN (8) ──────────────────────────────────────────────────────────────────
  { desc: 'EN slept 11-7 well → log_sleep + bedtime/wake/quality',
    lang: 'en', text: 'slept 11-7 well',
    expectedAction: 'log_sleep', expectedPayload: { bedtime: '23:00', wake: '07:00', quality: 4 },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'EN slept 7 hours → log_sleep + hours only',
    lang: 'en', text: 'slept 7 hours',
    expectedAction: 'log_sleep', expectedPayload: { hours: 7 },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'EN read before bed → wind_down_note',
    lang: 'en', text: 'read for 20 min before bed',
    expectedAction: 'wind_down_note', expectedPayload: { note: 'read for 20 min before bed' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'EN dreamt flying → dream_log',
    lang: 'en', text: 'dreamt I was flying',
    expectedAction: 'dream_log', expectedPayload: { text: 'I was flying' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN couldnt sleep 2h → log_insomnia + duration',
    lang: 'en', text: "couldn't sleep, lay there 2 hours",
    expectedAction: 'log_insomnia', expectedPayload: { duration_attempted_min: 120 },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN couldnt sleep + melatonin (cross-route hint) → log_insomnia + med_taken',
    lang: 'en', text: "couldn't sleep so took 5mg melatonin",
    expectedAction: 'log_insomnia', expectedPayload: { med_taken: 'melatonin', med_dose: '5mg' },
    fastConfidence: 0.95, expectEscalation: false },
  // Ambiguous: "rough night" — needs escalation
  { desc: 'EN ambiguous "rough night" → escalate to log_insomnia',
    lang: 'en', text: 'rough night',
    expectedAction: 'log_insomnia', expectedPayload: {},
    fastConfidence: 0.5, expectEscalation: true },
  // Ambiguous: weird dream w/o content — needs escalation
  { desc: 'EN ambiguous "had a weird dream" → escalate to dream_log',
    lang: 'en', text: 'had a weird dream',
    expectedAction: 'dream_log', expectedPayload: { text: 'weird dream' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── ES (8) ──────────────────────────────────────────────────────────────────
  { desc: 'ES dormí 6 horas → log_sleep + hours',
    lang: 'es', text: 'dormí 6 horas',
    expectedAction: 'log_sleep', expectedPayload: { hours: 6 },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES dormí bien → log_sleep + quality',
    lang: 'es', text: 'dormí bien 8 horas',
    expectedAction: 'log_sleep', expectedPayload: { hours: 8, quality: 4 },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES manzanilla antes de dormir → wind_down_note',
    lang: 'es', text: 'me tomé una manzanilla antes de dormir',
    expectedAction: 'wind_down_note', expectedPayload: { note: 'me tomé una manzanilla antes de dormir' },
    fastConfidence: 0.9, expectEscalation: false },
  { desc: 'ES soñé que volaba → dream_log',
    lang: 'es', text: 'soñé que volaba',
    expectedAction: 'dream_log', expectedPayload: { text: 'volaba' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES no podía dormir → log_insomnia',
    lang: 'es', text: 'no podía dormir, llevaba 90 minutos despierta',
    expectedAction: 'log_insomnia', expectedPayload: { duration_attempted_min: 90 },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'ES insomnio + melatonina (cross-route hint) → log_insomnia + med_taken',
    lang: 'es', text: 'no podía dormir, tomé melatonina',
    expectedAction: 'log_insomnia', expectedPayload: { med_taken: 'melatonin' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'ES tuve un sueño raro → dream_log',
    lang: 'es', text: 'tuve un sueño muy raro con mi abuela',
    expectedAction: 'dream_log', expectedPayload: { text: 'muy raro con mi abuela' },
    fastConfidence: 0.88, expectEscalation: false },
  // Ambiguous: ES "mala noche"
  { desc: 'ES ambiguous "mala noche" → escalate to log_insomnia',
    lang: 'es', text: 'mala noche',
    expectedAction: 'log_insomnia', expectedPayload: {},
    fastConfidence: 0.5, expectEscalation: true },

  // ── TR (8) ──────────────────────────────────────────────────────────────────
  { desc: 'TR 8 saat uyudum iyi → log_sleep + hours + quality',
    lang: 'tr', text: '8 saat uyudum iyi',
    expectedAction: 'log_sleep', expectedPayload: { hours: 8, quality: 4 },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR 5 saat uyudum → log_sleep + hours',
    lang: 'tr', text: '5 saat uyudum',
    expectedAction: 'log_sleep', expectedPayload: { hours: 5 },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR yatmadan önce kitap okudum → wind_down_note',
    lang: 'tr', text: 'yatmadan önce 20 dakika kitap okudum',
    expectedAction: 'wind_down_note', expectedPayload: { note: 'yatmadan önce 20 dakika kitap okudum' },
    fastConfidence: 0.91, expectEscalation: false },
  { desc: 'TR rüyamda uçtum → dream_log',
    lang: 'tr', text: 'rüyamda uçtuğumu gördüm',
    expectedAction: 'dream_log', expectedPayload: { text: 'uçtuğumu gördüm' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'TR uyuyamadım → log_insomnia + duration',
    lang: 'tr', text: 'uyuyamadım 2 saat boyunca yattım',
    expectedAction: 'log_insomnia', expectedPayload: { duration_attempted_min: 120 },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'TR uyuyamadım + melatonin (cross-route hint) → log_insomnia + med_taken + dose',
    lang: 'tr', text: 'uyuyamadım, 5mg melatonin aldım',
    expectedAction: 'log_insomnia', expectedPayload: { med_taken: 'melatonin', med_dose: '5mg' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR gece 3 kez uyandım → log_insomnia + woke_count',
    lang: 'tr', text: 'gece 3 kez uyandım',
    expectedAction: 'log_insomnia', expectedPayload: { woke_count: 3 },
    fastConfidence: 0.9, expectEscalation: false },
  // Ambiguous: TR "berbat bir gece"
  { desc: 'TR ambiguous "berbat bir gece" → escalate to log_insomnia',
    lang: 'tr', text: 'berbat bir gece',
    expectedAction: 'log_insomnia', expectedPayload: {},
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
              name: 'classify_sleep_action',
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
 *   - 8B model id              → returns the fixture's fastConfidence + fast payload.
 *   - GPT-OSS 120B model id    → always returns confidence 0.95 + canonical payload.
 * When the fixture is not ambiguous the accurate branch should never be hit;
 * the test asserts that separately.
 */
function makeFixtureFetch(fixture: SleepFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === SLEEP_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === SLEEP_MODEL_ACCURATE) {
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

describe('/route/sleep — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'sleep');
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

describe('/route/sleep — tier ladder contract', () => {
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
        // Fast tier returns LOW confidence so ladder must escalate.
        const isLow = body.model === SLEEP_MODEL_FAST;
        return makeGroqResp({
          action: 'log_insomnia',
          payload: {},
          confidence: isLow ? 0.4 : 0.92,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('something about sleep idk'), makeEnv(), 'sleep');
    expect(res.status).toBe(200);
    expect(models).toEqual([SLEEP_MODEL_FAST, SLEEP_MODEL_ACCURATE]);
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
          action: 'log_sleep',
          payload: { hours: 8 },
          confidence: 0.98,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('slept 8 hours'), makeEnv(), 'sleep');
    expect(res.status).toBe(200);
    expect(models).toEqual([SLEEP_MODEL_FAST]);
  });
});

// ─── cross-route mirror payload contract ─────────────────────────────────────
//
// The native sleep handler mirrors `log_insomnia.med_taken` (+ optional
// `med_dose`) into a `medication.log_dose` call (see
// apps/native/src/modules/sleep/handler.ts). Layer 2 must therefore
// preserve those hint keys verbatim in the returned payload — losing
// them silently would break the cross-module surface without any error
// signal. This test asserts the route does NOT strip the hint.

describe('/route/sleep — cross-route mirror hint preservation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves med_taken + med_dose on log_insomnia payload', async () => {
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
          action: 'log_insomnia',
          payload: { med_taken: 'melatonin', med_dose: '5mg' },
          confidence: 0.95,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(
      makeReq("couldn't sleep so took 5mg melatonin"),
      makeEnv(),
      'sleep',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      classification: { action: string; payload: Record<string, unknown> };
    };
    expect(body.classification.action).toBe('log_insomnia');
    expect(body.classification.payload.med_taken).toBe('melatonin');
    expect(body.classification.payload.med_dose).toBe('5mg');
  });

  it('worker PII scrubber does NOT strip sleep meds before classification', () => {
    // Belt-and-suspenders: verify in-band that the worker-local scrubber
    // leaves melatonin/ambien/trazodone/mirtazapine/doxepin untouched. If
    // a future scrubber adds a medical category this test catches it.
    const meds = ['melatonin', 'ambien', 'trazodone', 'mirtazapine', 'doxepin'];
    for (const med of meds) {
      const phrase = `couldn't sleep so took 5mg ${med}`;
      const { scrubbed } = scrubPII(phrase);
      expect(scrubbed).toContain(med);
    }
  });
});

// ─── transport / schema failure modes ────────────────────────────────────────

describe('/route/sleep — failure modes', () => {
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
                    name: 'classify_sleep_action',
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

    const res = await handleRoute(makeReq('slept 8 hours'), makeEnv(), 'sleep');
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

    const res = await handleRoute(makeReq('slept 8 hours'), makeEnv(), 'sleep');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/sleep', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'sleep');
    expect(res.status).toBe(400);
  });
});
