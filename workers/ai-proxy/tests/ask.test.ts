/**
 * Ask Ollie · question detection.
 *
 * Unit: what findQuestions keeps from a model answer (and what it refuses).
 * Route: in a mixed dump, the question never reaches the embedding cache, the classifier or the
 * inbox, and comes back in `questions`; the log part is routed exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/clerk-verify', () => ({ verifyClerkJwt: vi.fn(async () => 'user_ask_test') }));

import { findQuestions } from '../src/router/ask';
import { handleDumpRoute, type DumpRouteEnv } from '../src/router/dump';
import type { VectorizeIndex } from '../src/router/vectorize';

const fetchSpy = vi.spyOn(globalThis, 'fetch');
const groqAnswer = (content: unknown) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
/** The system prompt of a Groq request, to tell the ask call from the classifier. */
async function systemPromptOf(init?: RequestInit): Promise<string> {
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] };
  return body.messages?.find((m) => m.role === 'system')?.content ?? '';
}
const isAskCall = (system: string) => system.includes('QUESTION about what the person already told Ollie');

afterEach(() => {
  fetchSpy.mockReset();
});

describe('findQuestions', () => {
  const run = async (modelAnswer: unknown, fragments: string[]) => {
    fetchSpy.mockImplementation(async () => groqAnswer(modelAnswer));
    return findQuestions(fragments, { groq: 'test-key' });
  };

  it('keeps questions with their query and leaves logs out', async () => {
    const questions = await run(
      {
        fragments: [
          { i: 0, kind: 'log' },
          {
            i: 1, kind: 'question', lang: 'nl', shape: 'how_much', area: 'finance',
            filter: { merchant: 'Jumbo' }, period: 'this_month',
          },
        ],
      },
      ['paid 40 for gas', 'hoeveel heb ik deze maand bij de Jumbo uitgegeven?'],
    );
    expect(questions).toEqual([
      {
        index: 1,
        lang: 'nl',
        query: { shape: 'how_much', area: 'finance', filter: { merchant: 'Jumbo' }, period: 'this_month' },
      },
    ]);
  });

  it('turns an off-contract question into one with no query (the fallback), never a guess', async () => {
    const questions = await run(
      { fragments: [{ i: 0, kind: 'question', lang: 'en', shape: 'why', area: 'feelings' }] },
      ['am I sleeping enough?'],
    );
    expect(questions).toEqual([{ index: 0, lang: 'en', query: null }]);
  });

  it('drops unknown filters, bad statuses and periods, and marks other languages', async () => {
    const [question] = await run(
      {
        fragments: [{
          i: 0, kind: 'question', lang: 'tr', shape: 'how_many', area: 'sleep',
          filter: { status: 'terrible', item: 'x'.repeat(200), person: 'Ana', password: 'secret' },
          period: 'yesterday',
        }],
      },
      ['bu hafta kaç kötü gece geçirdim?'],
    );
    expect(question).toEqual({
      index: 0,
      lang: 'other',
      query: { shape: 'how_many', area: 'sleep', filter: { person: 'Ana' }, period: null },
    });
  });

  it('ignores indexes that are not fragments', async () => {
    const questions = await run(
      { fragments: [{ i: 5, kind: 'question', lang: 'en', shape: 'list', area: 'goals' }, { i: -1, kind: 'question' }] },
      ['one fragment'],
    );
    expect(questions).toEqual([]);
  });

  it('treats everything as a log when the model cannot be reached', async () => {
    fetchSpy.mockImplementation(async () => new Response('down', { status: 503 }));
    expect(await findQuestions(['how much did I spend?'], { groq: 'test-key' })).toEqual([]);
  });
});

describe('/route/dump with a question in it', () => {
  const vectorize: VectorizeIndex = {
    query: vi.fn(async () => ({ matches: [], count: 0 })),
    upsert: vi.fn(async () => ({ mutationId: 'm' })),
    deleteByIds: vi.fn(async () => ({ mutationId: 'd' })),
  };
  const env: DumpRouteEnv = {
    VOYAGE_API_KEY: 'voy',
    GROQ_API_KEY: 'groq',
    CLERK_ISSUER: 'https://faithful-stag-15.clerk.accounts.dev',
    VECTORIZE_INDEX: vectorize,
  };
  const embedded: string[][] = [];
  const classified: string[] = [];

  beforeEach(() => {
    embedded.length = 0;
    classified.length = 0;
    fetchSpy.mockImplementation(async (input: Request | string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes('voyageai.com')) {
        const texts = (JSON.parse(String(init?.body)) as { input: string[] }).input;
        embedded.push(texts);
        return new Response(JSON.stringify({ data: texts.map(() => ({ embedding: Array(1024).fill(0.1) })) }), {
          status: 200,
        });
      }
      if (url.includes('api.groq.com')) {
        const system = await systemPromptOf(init);
        const user = (JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }).messages.find(
          (m) => m.role === 'user',
        )?.content ?? '';
        if (isAskCall(system)) {
          // Every fragment that ends in "?" is a question in this script.
          const lines = user.split('\n');
          return groqAnswer({
            fragments: lines.map((line, i) =>
              line.trim().endsWith('?')
                ? { i, kind: 'question', lang: 'en', shape: 'how_much', area: 'finance', filter: {}, period: 'this_week' }
                : { i, kind: 'log' },
            ),
          });
        }
        classified.push(user);
        return groqAnswer({
          results: [{ module: 'grocery', action: 'pantry_add', confidence: 0.93, payload: { item: 'milk' } }],
        });
      }
      return new Response('not found', { status: 404 });
    });
  });

  const post = (text: string) =>
    handleDumpRoute(
      new Request('https://worker.dev/route/dump', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({ text, locale: 'en' }),
      }),
      env,
    );

  it('a question alone: answered by the phone, nothing embedded, cached or classified', async () => {
    const res = await post('how much did I spend this week?');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fragments: unknown[];
      questions: { text: string; lang: string; query: unknown }[];
    };
    expect(body.fragments).toEqual([]);
    expect(body.questions).toEqual([
      {
        text: 'how much did I spend this week?',
        lang: 'en',
        query: { shape: 'how_much', area: 'finance', filter: {}, period: 'this_week' },
      },
    ]);
    expect(embedded).toEqual([]);
    expect(classified).toEqual([]);
    expect(vectorize.upsert).not.toHaveBeenCalled();
  });

  it('a log alone: routed as before, no questions field', async () => {
    const res = await post('bought milk');
    const body = (await res.json()) as { fragments: { module: string }[]; questions?: unknown };
    expect(body.fragments.map((f) => f.module)).toEqual(['grocery']);
    expect(body.questions).toBeUndefined();
  });

  it('a mixed message: the log is filed, the question is answered, and only the log is embedded', async () => {
    const res = await post('bought milk and how much did I spend this week?');
    const body = (await res.json()) as {
      fragments: { module: string; text: string }[];
      questions: { text: string }[];
    };
    expect(body.fragments.map((f) => f.module)).toEqual(['grocery']);
    expect(body.questions.map((q) => q.text)).toEqual(['how much did I spend this week?']);
    expect(embedded.flat().some((t) => t.includes('how much'))).toBe(false);
    expect(classified.some((t) => t.includes('how much'))).toBe(false);
  });

  it('one fragment that is both: the log part is filed, the question answered', async () => {
    fetchSpy.mockImplementation(async (input: Request | string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes('voyageai.com')) {
        const texts = (JSON.parse(String(init?.body)) as { input: string[] }).input;
        embedded.push(texts);
        return new Response(JSON.stringify({ data: texts.map(() => ({ embedding: Array(1024).fill(0.1) })) }), { status: 200 });
      }
      const system = await systemPromptOf(init);
      if (isAskCall(system)) {
        return groqAnswer({
          fragments: [{ i: 0, kind: 'both', log: 'paid 40 for gas', lang: 'en', shape: 'how_much', area: 'finance', filter: {}, period: 'this_week' }],
        });
      }
      return groqAnswer({ results: [{ module: 'finance', action: 'log_transaction', confidence: 0.9, payload: { amount: 40 } }] });
    });
    const res = await post('paid 40 for gas, how much this week?');
    const body = (await res.json()) as { fragments: { module: string; text: string }[]; questions: { text: string }[] };
    expect(body.fragments.map((f) => [f.module, f.text])).toEqual([['finance', 'paid 40 for gas']]);
    expect(body.questions).toHaveLength(1);
    expect(embedded).toEqual([['paid 40 for gas']]);
  });
});
