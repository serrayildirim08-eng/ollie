/**
 * /route/chores + /route/mood — Layer 2 re-route smoke (S2 · fix 4).
 *
 * Layer 1 can route a fragment to `chores` or `mood`, but those modules had no
 * Layer-2 config registered in route.ts, so a re-route through /route/:module
 * returned 404 `unknown_module`. These tests assert the route now RESOLVES
 * (cache-miss → Groq tool-call → classification), proving the configs are wired
 * into MODULE_CONFIGS + MODULE_TIERS. Mock strategy mirrors habits-route.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRoute, type RouteEnv } from '../src/router/route';
import { CHORES_MODEL_FAST } from '../src/modules/chores.config';
import { MOOD_MODEL_FAST } from '../src/modules/mood.config';

function makeEnv(): RouteEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    VOYAGE_API_KEY: 'voy-test-key',
    GROQ_API_KEY: 'groq-test-key',
    T0_JWT_ENFORCED: '0',
  };
}

function makeReq(module: string, text: string): Request {
  return new Request(`https://worker.dev/route/${module}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

function makeGroqResp(fnName: string, args: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: fnName, arguments: JSON.stringify(args) } }],
        },
        finish_reason: 'tool_calls',
      }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

interface Case {
  module: 'chores' | 'mood';
  fnName: string;
  fastModel: string;
  text: string;
  args: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    module: 'chores',
    fnName: 'classify_chores_action',
    fastModel: CHORES_MODEL_FAST,
    text: 'cleaned the kitchen',
    args: { action: 'chore_done', payload: { chore: 'clean the kitchen' }, confidence: 0.95, language: 'en' },
  },
  {
    module: 'mood',
    fnName: 'classify_mood_action',
    fastModel: MOOD_MODEL_FAST,
    text: 'feeling really anxious',
    args: { action: 'log_mood', payload: { label: 'anxious', valence: 'neg' }, confidence: 0.95, language: 'en' },
  },
];

describe('/route/:module resolves for chores + mood (fix 4)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  for (const c of CASES) {
    it(`/route/${c.module} returns 200 with classification (not 404)`, async () => {
      fetchSpy.mockImplementation((async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('voyageai.com')) {
          return new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (u.includes('routing_cache_lookup')) {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u.includes('api.groq.com')) {
          const body = JSON.parse((init?.body as string) ?? '{}') as { model?: string };
          expect(body.model).toBe(c.fastModel); // tier ladder wired
          return makeGroqResp(c.fnName, c.args);
        }
        if (u.includes('routing_cache')) {
          return new Response('', { status: 201 });
        }
        return new Response('not found', { status: 404 });
      }) as never);

      const res = await handleRoute(makeReq(c.module, c.text), makeEnv(), c.module);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { source: string; classification: Record<string, unknown> };
      expect(json.source).toBe('groq_miss');
      expect(json.classification).toMatchObject(c.args);
    });
  }

  it('an unregistered module still 404s (control)', async () => {
    const res = await handleRoute(makeReq('not_a_module', 'x'), makeEnv(), 'not_a_module');
    expect(res.status).toBe(404);
  });
});
