/**
 * Tests for POST /feed-me/:user.
 *
 * Covered:
 *   - 200: valid user-mode request returns suggestions (gemini path)
 *   - 200: valid pet-mode request, pet-feed config drives prompt
 *   - 401: T0_JWT_ENFORCED=1 with no Authorization header
 *   - 403: open-mode header user_id mismatches path
 *   - 400: empty pantry / invalid diet / count > 5
 *   - 200: cache HIT path returns cached suggestions, source='cache_hit'
 *   - 200: gemini 5xx → static_fallback (graceful, NOT 500)
 *   - 200: voyage 5xx → static_fallback (graceful)
 *   - cook signals folded into prompt (mock RPC, assert prompt contains 'loved')
 *   - excludeDishes suppressed in cache_hit post-processing
 *   - locale='tr' → Turkish dish in suggestions (mocked Gemini response)
 *   - PII scrub: MEDICATION pantry items dropped, never reach Gemini
 *
 * fetch is intercepted per-test via a small router that pattern-matches the
 * outbound URL — same shape as replenishment.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleFeedMe,
  type FeedMeEnv,
  type FeedMeResponse,
  type FeedMeRequestBody,
} from '../src/router/feed-me';

// ─── env stub ────────────────────────────────────────────────────────────────

const FAKE_USER = '11111111-2222-3333-4444-555555555555';
const OTHER_USER = '99999999-8888-7777-6666-555555555555';

function makeEnv(overrides: Partial<FeedMeEnv> = {}): FeedMeEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    VOYAGE_API_KEY: 'voyage-key',
    GEMINI_API_KEY: 'gemini-key',
    ...overrides,
  };
}

function makeReq(
  body: unknown,
  user = FAKE_USER,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://worker.dev/feed-me/${user}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': user,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Partial<FeedMeRequestBody> = {}): FeedMeRequestBody {
  return {
    pantry: ['tomato', 'onion', 'garlic', 'egg', 'feta', 'bread'],
    diet: 'vegetarian',
    locale: 'en',
    count: 3,
    ...overrides,
  };
}

// ─── fetch router ────────────────────────────────────────────────────────────

interface FetchMocks {
  voyage?: () => Response | Promise<Response>;
  cacheLookup?: () => Response | Promise<Response>;
  cookSignals?: () => Response | Promise<Response>;
  cacheUpdate?: () => Response | Promise<Response>;
  cacheWrite?: () => Response | Promise<Response>;
  gemini?: () => Response | Promise<Response>;
  /** Capture the body sent to Gemini for assertions. */
  onGemini?: (body: unknown) => void;
}

const VOYAGE_EMBED_OK = () => okJson({ data: [{ embedding: Array(1024).fill(0.01) }] });
const EMPTY_CACHE = () => okJson([]);
const EMPTY_SIGNALS = () => okJson([
  { recent: [], loved: [], rejected: [], sample_size: 0 },
]);

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function geminiOk(args: unknown): Response {
  return okJson({
    candidates: [
      {
        content: {
          parts: [
            { functionCall: { name: 'suggest_recipes', args } },
          ],
        },
      },
    ],
  });
}

function defaultGeminiArgs(language = 'en') {
  return {
    language,
    suggestions: [
      {
        dish: 'Shakshuka',
        cuisine: 'Middle Eastern',
        diet: ['vegetarian', 'mediterranean'],
        ingredients: [
          { name: 'tomato', canonical: 'tomato', have: true, qty: 4 },
          { name: 'egg', canonical: 'egg', have: true, qty: 4 },
        ],
        steps: ['Heat oil.', 'Add tomatoes.', 'Crack eggs.', 'Simmer 8 min.'],
        prepMinutes: 5,
        cookMinutes: 15,
        servings: 2,
      },
      {
        dish: 'Feta Toast',
        cuisine: 'Mediterranean',
        diet: ['vegetarian'],
        ingredients: [{ name: 'bread', canonical: 'bread', have: true }],
        steps: ['Toast bread.', 'Top with feta.', 'Drizzle olive oil.'],
        prepMinutes: 3,
        cookMinutes: 3,
        servings: 1,
      },
      {
        dish: 'Tomato Soup',
        cuisine: 'European',
        diet: ['vegetarian'],
        ingredients: [{ name: 'tomato', canonical: 'tomato', have: true }],
        steps: ['Simmer tomatoes.', 'Blend.', 'Season.'],
        prepMinutes: 5,
        cookMinutes: 20,
        servings: 3,
      },
    ],
  };
}

function installFetch(mocks: FetchMocks): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('voyageai.com')) {
      return await (mocks.voyage ?? VOYAGE_EMBED_OK)();
    }
    if (url.includes('routing_cache_lookup')) {
      return await (mocks.cacheLookup ?? EMPTY_CACHE)();
    }
    if (url.includes('feed_me_cook_signals')) {
      return await (mocks.cookSignals ?? EMPTY_SIGNALS)();
    }
    if (url.includes('routing_cache?id=eq')) {
      return await (mocks.cacheUpdate ?? (() => okJson({})))();
    }
    if (url.includes('/routing_cache')) {
      return await (mocks.cacheWrite ?? (() => okJson({})))();
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      if (mocks.onGemini) {
        try {
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          mocks.onGemini(body);
        } catch {
          // ignore — assertions can still inspect via fetchSpy
        }
      }
      return await (mocks.gemini ?? (() => geminiOk(defaultGeminiArgs())))();
    }
    return new Response('not_routed', { status: 404 });
  });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('POST /feed-me/:user', () => {
  beforeEach(() => {
    // every test gets a clean fetch spy via installFetch
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── happy path ─────────────────────────────────────────────────────────────

  it('200: valid user-mode request returns gemini suggestions', async () => {
    installFetch({});
    const res = await handleFeedMe(makeReq(validBody()), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('gemini');
    expect(body.suggestions).toHaveLength(3);
    expect(body.suggestions[0].dish).toBe('Shakshuka');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('200: pet-mode uses pet-feed prompt + species inference', async () => {
    let geminiSystemPrompt = '';
    installFetch({
      onGemini: (b) => {
        const o = b as { systemInstruction?: { parts?: Array<{ text?: string }> } };
        geminiSystemPrompt = o.systemInstruction?.parts?.[0]?.text ?? '';
      },
      gemini: () =>
        geminiOk({
          language: 'en',
          suggestions: [
            {
              dish: 'Morning Veggie Ration',
              cuisine: 'morning ration',
              diet: ['pig'],
              ingredients: [
                { name: 'romaine', canonical: 'lettuce', have: true },
                { name: 'pellets', canonical: null, have: true },
              ],
              steps: ['Measure pellets.', 'Chop romaine.', 'Combine.'],
              prepMinutes: 5,
              cookMinutes: 0,
              servings: 1,
            },
          ],
        }),
    });

    const res = await handleFeedMe(
      makeReq(
        validBody({
          feedTarget: 'pet',
          petName: 'tontin',
          pantry: ['romaine', 'pellets', 'sweet potato'],
          count: 1,
        }),
      ),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('gemini');
    expect(body.suggestions[0].diet).toContain('pig');

    // Pet prompt must be active — vet-informed marker + species line
    expect(geminiSystemPrompt).toContain('vet-informed');
    expect(geminiSystemPrompt).toContain('best-guess species: pig');
    // Hard safety rule for pigs surfaces in prompt
    expect(geminiSystemPrompt.toLowerCase()).toContain('chocolate');
  });

  // ── auth ───────────────────────────────────────────────────────────────────

  it('401: T0_JWT_ENFORCED=1 with no Authorization header', async () => {
    installFetch({});
    const req = new Request(`https://worker.dev/feed-me/${FAKE_USER}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody()),
    });
    const res = await handleFeedMe(
      req,
      makeEnv({ T0_JWT_ENFORCED: '1' }),
      FAKE_USER,
    );
    expect(res.status).toBe(401);
  });

  it('403: open-mode x-user-id mismatches path user_id', async () => {
    installFetch({});
    const res = await handleFeedMe(
      makeReq(validBody(), FAKE_USER, { 'x-user-id': OTHER_USER }),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden');
  });

  it('400: malformed path user_id (not a UUID)', async () => {
    installFetch({});
    const res = await handleFeedMe(
      new Request('https://worker.dev/feed-me/not-a-uuid', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': 'not-a-uuid' },
        body: JSON.stringify(validBody()),
      }),
      makeEnv(),
      'not-a-uuid',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_user_id');
  });

  // ── body validation ───────────────────────────────────────────────────────

  it('400: empty pantry → missing_pantry', async () => {
    installFetch({});
    const res = await handleFeedMe(
      makeReq(validBody({ pantry: [] })),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_pantry');
  });

  it('400: invalid diet enum', async () => {
    installFetch({});
    const res = await handleFeedMe(
      makeReq({ ...validBody(), diet: 'paleo' as unknown as never }),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_diet');
  });

  it('400: count > 5', async () => {
    installFetch({});
    const res = await handleFeedMe(
      makeReq(validBody({ count: 9 })),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_count');
  });

  it('400: pet mode without petName', async () => {
    installFetch({});
    const res = await handleFeedMe(
      makeReq(validBody({ feedTarget: 'pet' })),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_pet_name');
  });

  it('400: invalid locale (required field)', async () => {
    installFetch({});
    const res = await handleFeedMe(
      makeReq({ ...validBody(), locale: 'fr' as unknown as never }),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_locale');
  });

  // ── cache HIT path ─────────────────────────────────────────────────────────

  it('200: cache HIT returns cached suggestions with source=cache_hit', async () => {
    const cached = {
      suggestions: [
        {
          dish: 'Cached Shakshuka',
          cuisine: 'Cached',
          diet: ['vegetarian'],
          ingredients: [{ name: 'tomato', canonical: 'tomato', have: true }],
          steps: ['s1', 's2', 's3'],
          prepMinutes: 5,
          cookMinutes: 10,
          servings: 2,
        },
      ],
      language: 'en',
    };
    installFetch({
      cacheLookup: () =>
        okJson([{ id: 'cache-row-1', classification: cached, language: 'en' }]),
    });

    const res = await handleFeedMe(makeReq(validBody()), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('cache_hit');
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].dish).toBe('Cached Shakshuka');
  });

  it('cache HIT: excludeDishes suppress cached suggestions', async () => {
    const cached = {
      suggestions: [
        {
          dish: 'Shakshuka',
          cuisine: 'X',
          diet: ['vegetarian'],
          ingredients: [],
          steps: ['s1', 's2', 's3'],
          prepMinutes: 5,
          cookMinutes: 10,
          servings: 2,
        },
        {
          dish: 'Feta Toast',
          cuisine: 'Y',
          diet: ['vegetarian'],
          ingredients: [],
          steps: ['s1', 's2', 's3'],
          prepMinutes: 3,
          cookMinutes: 3,
          servings: 1,
        },
      ],
      language: 'en',
    };
    installFetch({
      cacheLookup: () =>
        okJson([{ id: 'cache-row-2', classification: cached, language: 'en' }]),
    });

    const res = await handleFeedMe(
      makeReq(validBody({ excludeDishes: ['Shakshuka'], count: 3 })),
      makeEnv(),
      FAKE_USER,
    );
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('cache_hit');
    expect(body.suggestions.map((s) => s.dish)).not.toContain('Shakshuka');
    expect(body.suggestions.map((s) => s.dish)).toContain('Feta Toast');
  });

  it('cache HIT: loved signals boost matching cached dish to top', async () => {
    const cached = {
      suggestions: [
        {
          dish: 'Tomato Soup',
          cuisine: 'European',
          diet: ['vegetarian'],
          ingredients: [],
          steps: ['s1', 's2', 's3'],
          prepMinutes: 5,
          cookMinutes: 20,
          servings: 3,
        },
        {
          dish: 'Shakshuka',
          cuisine: 'ME',
          diet: ['vegetarian'],
          ingredients: [],
          steps: ['s1', 's2', 's3'],
          prepMinutes: 5,
          cookMinutes: 10,
          servings: 2,
        },
      ],
      language: 'en',
    };
    installFetch({
      cacheLookup: () =>
        okJson([{ id: 'cache-row-3', classification: cached, language: 'en' }]),
      cookSignals: () =>
        okJson([
          {
            recent: [],
            loved: [{ dish: 'Shakshuka', count: 4 }],
            rejected: [],
            sample_size: 7,
          },
        ]),
    });

    const res = await handleFeedMe(
      makeReq(validBody({ count: 2 })),
      makeEnv(),
      FAKE_USER,
    );
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('cache_hit');
    expect(body.suggestions[0].dish).toBe('Shakshuka');
  });

  // ── upstream failure → static_fallback ─────────────────────────────────────

  it('gemini 5xx → static_fallback (NOT 500)', async () => {
    installFetch({
      gemini: () => new Response('gemini exploded', { status: 502 }),
    });
    const res = await handleFeedMe(makeReq(validBody()), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('static_fallback');
    expect(body.suggestions).toEqual([]);
  });

  it('voyage 5xx → static_fallback (NOT 502)', async () => {
    installFetch({
      voyage: () => new Response('voyage down', { status: 503 }),
    });
    const res = await handleFeedMe(makeReq(validBody()), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('static_fallback');
    expect(body.suggestions).toEqual([]);
  });

  // ── cook signals folded into Gemini prompt ────────────────────────────────

  it('cook signals fold into Gemini system prompt (recent/loved/rejected)', async () => {
    let systemPrompt = '';
    installFetch({
      cookSignals: () =>
        okJson([
          {
            recent: [{ dish: 'Carbonara', count: 1 }],
            loved: [{ dish: 'Shakshuka', count: 4 }],
            rejected: [{ dish: 'Liver Stew', count: 1 }],
            sample_size: 6,
          },
        ]),
      onGemini: (b) => {
        const o = b as { systemInstruction?: { parts?: Array<{ text?: string }> } };
        systemPrompt = o.systemInstruction?.parts?.[0]?.text ?? '';
      },
    });
    const res = await handleFeedMe(makeReq(validBody()), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    expect(systemPrompt).toContain('Recently cooked');
    expect(systemPrompt).toContain('Carbonara');
    expect(systemPrompt).toContain('Loved dishes');
    expect(systemPrompt).toContain('Shakshuka');
    expect(systemPrompt).toContain('Disliked dishes');
    expect(systemPrompt).toContain('Liver Stew');
  });

  it("locale='tr' yields Turkish dish names from mocked Gemini", async () => {
    installFetch({
      gemini: () =>
        geminiOk({
          language: 'tr',
          suggestions: [
            {
              dish: 'Mercimek Çorbası',
              cuisine: 'Turkish',
              diet: ['vegetarian', 'turkish'],
              ingredients: [
                { name: 'mercimek', canonical: null, have: true },
              ],
              steps: ['Soğanı kavur.', 'Mercimeği ekle.', 'Kaynat.'],
              prepMinutes: 10,
              cookMinutes: 25,
              servings: 4,
            },
            {
              dish: 'Menemen',
              cuisine: 'Turkish',
              diet: ['vegetarian', 'turkish'],
              ingredients: [{ name: 'yumurta', canonical: 'egg', have: true }],
              steps: ['Biber kavur.', 'Domates ekle.', 'Yumurta kır.'],
              prepMinutes: 5,
              cookMinutes: 12,
              servings: 2,
            },
          ],
        }),
    });
    const res = await handleFeedMe(
      makeReq(
        validBody({
          locale: 'tr',
          diet: 'turkish',
          pantry: ['mercimek', 'soğan', 'havuç', 'yumurta', 'domates'],
          count: 2,
        }),
      ),
      makeEnv(),
      FAKE_USER,
    );
    const body = (await res.json()) as FeedMeResponse;
    expect(body.source).toBe('gemini');
    const turkish = body.suggestions.find((s) => /çorba|menemen/i.test(s.dish));
    expect(turkish).toBeDefined();
  });

  // ── PII scrub: MEDICATION items dropped ────────────────────────────────────

  it('PII scrub: medication pantry item is dropped before Gemini', async () => {
    let userTurn = '';
    installFetch({
      onGemini: (b) => {
        const o = b as { contents?: Array<{ role: string; parts?: Array<{ text?: string }> }> };
        const last = o.contents?.[o.contents.length - 1];
        userTurn = last?.parts?.[0]?.text ?? '';
      },
    });
    const res = await handleFeedMe(
      makeReq(
        validBody({
          pantry: ['tomato', 'ritalin', 'feta'],
        }),
      ),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(200);
    // The actual "ritalin" token must NOT appear in the outbound prompt.
    expect(userTurn.toLowerCase()).not.toContain('ritalin');
    expect(userTurn.toLowerCase()).toContain('tomato');
    expect(userTurn.toLowerCase()).toContain('feta');
  });
});
