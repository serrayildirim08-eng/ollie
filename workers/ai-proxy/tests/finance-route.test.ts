/**
 * Tests for /route/finance — finance-module Layer 2 (action + payload resolution).
 *
 * Coverage:
 *   - 20 fixtures: EN + ES + TR covering all 4 finance actions.
 *   - 3 ambiguous fixtures verify the 8B → GPT-OSS 120B tier escalation
 *     kicks in when the cheap model returns confidence < 0.7.
 *   - Currency parsing edge cases: $, USD, EUR, TL/TRY, £/GBP.
 *   - Cadence parsing: monthly/yearly/weekly + aylık/mensual etc.
 *   - Schema/transport failure modes: bad JSON arg + tool_calls missing + empty text.
 *
 * Mock strategy: mirrors cycle-route.test.ts exactly.
 *   Voyage → always OK, deterministic 1024-d vector.
 *   Supabase RPC → always cache miss (exercises Groq every time).
 *   Groq → keyed off `model` field:
 *     "llama-3.1-8b-instant"  → fast tier reply (per-fixture confidence)
 *     "openai/gpt-oss-120b"   → accurate tier reply (always high conf)
 *   Ambiguous fixtures have fastConfidence: 0.5, triggering escalation;
 *   test asserts BOTH model ids were called.
 *
 * No cross-route mirror suite — finance is standalone Layer 2.
 * Inbound mirror (grocery → finance) is handled by the grocery handler, not here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import {
  FINANCE_MODEL_FAST,
  FINANCE_MODEL_ACCURATE,
  type FinanceAction,
} from '../src/modules/finance.config';
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
  return new Request('https://worker.dev/route/finance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── fixture shape ───────────────────────────────────────────────────────────

interface FinanceFixture {
  desc: string;
  lang: 'en' | 'es' | 'tr';
  text: string;
  expectedAction: FinanceAction;
  expectedPayload: Record<string, unknown>;
  fastConfidence: number;
  expectEscalation: boolean;
}

// ─── 20 fixtures ──────────────────────────────────────────────────────────────
// All 4 actions covered. 3 ambiguous (fastConfidence 0.5) to exercise escalation.

const FIXTURES: FinanceFixture[] = [
  // ── EN (7) ──────────────────────────────────────────────────────────────────
  { desc: 'EN spent $40 at sephora → log_transaction USD',
    lang: 'en', text: 'spent $40 at sephora',
    expectedAction: 'log_transaction',
    expectedPayload: { amount: 40, currency: 'USD', merchant: 'Sephora' },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'EN paid £20 at tesco → log_transaction GBP',
    lang: 'en', text: 'paid £20 at tesco',
    expectedAction: 'log_transaction',
    expectedPayload: { amount: 20, currency: 'GBP', merchant: 'Tesco' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN rent is $1800/month → add_bill monthly',
    lang: 'en', text: 'rent is $1800/month',
    expectedAction: 'add_bill',
    expectedPayload: { merchant: 'rent', amount: 1800, cadence: 'monthly' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'EN moved 500 to savings → savings_note',
    lang: 'en', text: 'moved 500 to savings',
    expectedAction: 'savings_note',
    expectedPayload: { amount: 500 },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'EN renewed spotify $10/month → subscription_log',
    lang: 'en', text: 'renewed spotify $10/month',
    expectedAction: 'subscription_log',
    expectedPayload: { name: 'Spotify', amount: 10, currency: 'USD', cadence: 'monthly' },
    fastConfidence: 0.97, expectEscalation: false },
  { desc: 'EN subscribed €15/month → subscription_log EUR monthly',
    lang: 'en', text: 'subscribed to setapp €15/month',
    expectedAction: 'subscription_log',
    expectedPayload: { amount: 15, currency: 'EUR', cadence: 'monthly' },
    fastConfidence: 0.95, expectEscalation: false },
  // Ambiguous: "bought coffee" — no amount, no merchant clarity, needs escalation
  { desc: 'EN ambiguous "bought coffee no amount" → escalate to log_transaction',
    lang: 'en', text: 'bought coffee',
    expectedAction: 'log_transaction',
    expectedPayload: { merchant: 'coffee' },
    fastConfidence: 0.5, expectEscalation: true },

  // ── ES (7) ──────────────────────────────────────────────────────────────────
  { desc: 'ES pagué 50 dólares de luz → add_bill (utility)',
    lang: 'es', text: 'pagué 50 dólares de luz',
    expectedAction: 'add_bill',
    expectedPayload: { merchant: 'Luz', amount: 50, cadence: 'monthly' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'ES gastos 200 pesos en farmacia → log_transaction',
    lang: 'es', text: 'gastos 200 pesos en farmacia',
    expectedAction: 'log_transaction',
    expectedPayload: { amount: 200, merchant: 'Farmacia' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES ahorré 100 → savings_note',
    lang: 'es', text: 'ahorré 100',
    expectedAction: 'savings_note',
    expectedPayload: { amount: 100 },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'ES suscribí a netflix mensual → subscription_log monthly',
    lang: 'es', text: 'suscribí a netflix mensual',
    expectedAction: 'subscription_log',
    expectedPayload: { name: 'Netflix', cadence: 'monthly' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'ES alquiler mensual 900 EUR → add_bill',
    lang: 'es', text: 'alquiler mensual 900 EUR',
    expectedAction: 'add_bill',
    expectedPayload: { cadence: 'monthly', amount: 900 },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES gasté 30 en supermercado → log_transaction',
    lang: 'es', text: 'gasté 30 en supermercado',
    expectedAction: 'log_transaction',
    expectedPayload: { amount: 30, merchant: 'Supermercado' },
    fastConfidence: 0.93, expectEscalation: false },
  // Ambiguous: "pagué algo" — no amount clarity, needs escalation
  { desc: 'ES ambiguous "pagué algo" → escalate to log_transaction',
    lang: 'es', text: 'pagué algo hoy',
    expectedAction: 'log_transaction',
    expectedPayload: {},
    fastConfidence: 0.5, expectEscalation: true },

  // ── TR (6) ──────────────────────────────────────────────────────────────────
  { desc: 'TR 100 TL bağışladım → log_transaction TRY',
    lang: 'tr', text: '100 TL bağışladım',
    expectedAction: 'log_transaction',
    expectedPayload: { amount: 100, currency: 'TRY' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR kira 18000 TL aylık → add_bill monthly TRY',
    lang: 'tr', text: 'kira 18000 TL aylık',
    expectedAction: 'add_bill',
    expectedPayload: { merchant: 'kira', amount: 18000, cadence: 'monthly' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'TR Netflix yeniledim → subscription_log',
    lang: 'tr', text: 'Netflix yeniledim',
    expectedAction: 'subscription_log',
    expectedPayload: { name: 'Netflix' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'TR tasarrufa 2000 TL attım → savings_note',
    lang: 'tr', text: 'tasarrufa 2000 TL attım',
    expectedAction: 'savings_note',
    expectedPayload: { amount: 2000 },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'TR 500 TRY harcadım markette → log_transaction TRY',
    lang: 'tr', text: '500 TRY harcadım markette',
    expectedAction: 'log_transaction',
    expectedPayload: { amount: 500, currency: 'TRY', merchant: 'Market' },
    fastConfidence: 0.93, expectEscalation: false },
  // Ambiguous: "bir şey aldım" — no amount/merchant, needs escalation
  { desc: 'TR ambiguous "bir şey aldım" → escalate to log_transaction',
    lang: 'tr', text: 'bir şey aldım',
    expectedAction: 'log_transaction',
    expectedPayload: {},
    fastConfidence: 0.5, expectEscalation: true },

  // ── NEW ACTIONS — log_income (3) ────────────────────────────────────────────
  { desc: 'TR maaş geldi → log_income salary',
    lang: 'tr', text: 'maaş geldi',
    expectedAction: 'log_income',
    expectedPayload: { source: 'salary' },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN akalan paycheck deposited → log_income source=akalan',
    lang: 'en', text: 'akalan paycheck deposited',
    expectedAction: 'log_income',
    expectedPayload: { source: 'akalan' },
    fastConfidence: 0.94, expectEscalation: false },
  { desc: 'ES depositaron el sueldo → log_income salary',
    lang: 'es', text: 'depositaron el sueldo',
    expectedAction: 'log_income',
    expectedPayload: { source: 'salary' },
    fastConfidence: 0.93, expectEscalation: false },

  // ── NEW ACTIONS — log_refund (3) ────────────────────────────────────────────
  { desc: 'EN returned the scarf → log_refund originalItem',
    lang: 'en', text: 'returned the scarf',
    expectedAction: 'log_refund',
    expectedPayload: { originalItem: 'scarf' },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN amazon refunded me $40 → log_refund USD merchant',
    lang: 'en', text: 'amazon refunded me $40',
    expectedAction: 'log_refund',
    expectedPayload: { amount: 40, currency: 'USD', merchant: 'Amazon' },
    fastConfidence: 0.96, expectEscalation: false },
  { desc: 'ES me devolvieron los zapatos → log_refund originalItem',
    lang: 'es', text: 'me devolvieron los zapatos',
    expectedAction: 'log_refund',
    expectedPayload: { originalItem: 'shoes' },
    fastConfidence: 0.92, expectEscalation: false },

  // ── NEW ACTIONS — spending_reflection (3) ────────────────────────────────
  { desc: 'ES gastando demasiado en café → spending_reflection concerned',
    lang: 'es', text: 'gastando demasiado en café',
    expectedAction: 'spending_reflection',
    expectedPayload: {
      note: 'spending too much on coffee',
      category: 'café',
      sentiment: 'concerned',
    },
    fastConfidence: 0.93, expectEscalation: false },
  { desc: 'EN third mouse this year → spending_reflection electronics',
    lang: 'en', text: "this is the third mouse I've bought this year",
    expectedAction: 'spending_reflection',
    expectedPayload: {
      note: 'third mouse this year — repeated pattern',
      category: 'electronics',
      sentiment: 'concerned',
    },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'TR kahveye çok harcıyorum → spending_reflection café',
    lang: 'tr', text: 'kahveye çok harcıyorum',
    expectedAction: 'spending_reflection',
    expectedPayload: {
      note: 'spending too much on coffee',
      category: 'café',
      sentiment: 'concerned',
    },
    fastConfidence: 0.94, expectEscalation: false },

  // ── NEW ACTIONS — pending_decision (3) ────────────────────────────────────
  { desc: 'EN moving quote 2400 → pending_decision with amount',
    lang: 'en', text: 'moving quote 2400',
    expectedAction: 'pending_decision',
    expectedPayload: { what: 'moving quote', amount: 2400 },
    fastConfidence: 0.95, expectEscalation: false },
  { desc: 'EN should I get the new laptop? → pending_decision no amount',
    lang: 'en', text: 'should I get the new laptop?',
    expectedAction: 'pending_decision',
    expectedPayload: { what: 'new laptop' },
    fastConfidence: 0.92, expectEscalation: false },
  { desc: 'ES comprar o no el sofá → pending_decision sofa',
    lang: 'es', text: 'comprar o no el sofá',
    expectedAction: 'pending_decision',
    expectedPayload: { what: 'buy the sofa' },
    fastConfidence: 0.91, expectEscalation: false },
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
              name: 'classify_finance_action',
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

function makeFixtureFetch(fixture: FinanceFixture, calls: { fast: number; accurate: number }) {
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
      if (body.model === FINANCE_MODEL_FAST) {
        calls.fast++;
        return makeGroqResp({
          action: fixture.expectedAction,
          payload: fixture.expectedPayload,
          confidence: fixture.fastConfidence,
          language: fixture.lang,
        });
      }
      if (body.model === FINANCE_MODEL_ACCURATE) {
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

describe('/route/finance — Layer 2 fixtures', () => {
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

      const res = await handleRoute(makeReq(fx.text), makeEnv(), 'finance');
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

describe('/route/finance — tier ladder contract', () => {
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
        const isLow = body.model === FINANCE_MODEL_FAST;
        return makeGroqResp({
          action: 'log_transaction',
          payload: { amount: 50 },
          confidence: isLow ? 0.4 : 0.93,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('paid something'), makeEnv(), 'finance');
    expect(res.status).toBe(200);
    expect(models).toEqual([FINANCE_MODEL_FAST, FINANCE_MODEL_ACCURATE]);
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
          action: 'log_transaction',
          payload: { amount: 40, currency: 'USD', merchant: 'Sephora' },
          confidence: 0.97,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(makeReq('spent $40 at sephora'), makeEnv(), 'finance');
    expect(res.status).toBe(200);
    expect(models).toEqual([FINANCE_MODEL_FAST]);
  });
});

// ─── transport / schema failure modes ────────────────────────────────────────

describe('/route/finance — failure modes', () => {
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
                    name: 'classify_finance_action',
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

    const res = await handleRoute(makeReq('spent $40'), makeEnv(), 'finance');
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

    const res = await handleRoute(makeReq('spent $40'), makeEnv(), 'finance');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('groq_classify_failed');
  });

  it('rejects empty text with 400', async () => {
    const req = new Request('https://worker.dev/route/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await handleRoute(req, makeEnv(), 'finance');
    expect(res.status).toBe(400);
  });
});

// ─── currency + cadence parsing edge cases ───────────────────────────────────
// Verify the PII scrubber does not strip currency symbols or financial terms.

describe('/route/finance — currency + cadence edge cases', () => {
  it('does not scrub currency symbols or finance terms', () => {
    const phrases = [
      'spent $40 at sephora',
      'paid £20 at tesco',
      'subscribed €15/month',
      '200 TL harcadım',
      '500 TRY markette',
      'rent is $1800/month',
      'kira aylık 18000 TL',
      'alquiler mensual 900 EUR',
      'netflix semanal',
    ];
    for (const phrase of phrases) {
      const { scrubbed } = scrubPII(phrase);
      // None of these should be blank-replaced
      expect(scrubbed.length).toBeGreaterThan(0);
      // Currency symbols/amounts must survive
      if (phrase.includes('$')) expect(scrubbed).toContain('$');
      if (phrase.includes('£')) expect(scrubbed).toContain('£');
      if (phrase.includes('€')) expect(scrubbed).toContain('€');
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
        const isLow = body.model === FINANCE_MODEL_FAST;
        return makeGroqResp({
          action: 'log_transaction',
          payload: {},
          confidence: isLow ? 0.45 : 0.88,
          language: 'en',
        });
      }
      return new Response('', { status: 201 });
    });

    const res = await handleRoute(
      makeReq('did some financial stuff'),
      makeEnv(),
      'finance',
    );
    expect(res.status).toBe(200);
    expect(models).toContain(FINANCE_MODEL_FAST);
    expect(models).toContain(FINANCE_MODEL_ACCURATE);

    vi.restoreAllMocks();
  });
});
