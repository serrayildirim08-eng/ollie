/**
 * feedMeMock — devtool fixtures for the Feed Me v2 surface.
 *
 * Mirrors `groceryRoutingMock.ts` in shape + install pattern. The five
 * named fixtures cover the surfaces UI design + QA need to flip between
 * without a live ai-proxy worker:
 *
 *   1. feedme_user           — user mode, 3 mediterranean suggestions
 *   2. feedme_pet_pigs       — pet mode, 3 guinea-pig meal plans
 *   3. feedme_loading        — pending state (suggestions pending for ~900ms)
 *   4. feedme_static_fallback — endpoint down, falls through to inferRecipe
 *   5. feedme_empty          — pantry too sparse, no suggestions
 *
 * Usage:
 *   • Live app: navigate with `?mock=feedme_user` (or any fixture key).
 *     `installFeedMeMockFromURL()` runs once from main.tsx; on match it
 *     primes the useFeedMe module-scope cache so the hook resolves to
 *     the fixture on next mount (no real fetch fires).
 *   • Storybook: import the record + call `seedFeedMeFixture(key, userId)`
 *     from a decorator.
 *
 * Because the hook's cache is keyed on `JSON.stringify(query)` plus the
 * userId, the seed function takes both — for the URL-installed devtool
 * we use a stable fake userId ('mock-user') and seed the canonical empty
 * query (no pantry, default diet/target). The view drives a real query
 * shortly after mount; the cache miss for that real key will re-fetch
 * (which silently fails in the mock env, falling to static fallback).
 * For QA flips we therefore also stamp the seed key with a wildcard
 * variant — see `seedFeedMeFixture`.
 */

import {
  _seedFeedMeCacheForMock,
  feedMeCacheKey,
  type RecipeSuggestion,
  type FeedMeSource,
  type FeedMeQuery,
} from '../hooks/useFeedMe';

// ─── Fixture shape ────────────────────────────────────────────────────────────

export interface FeedMeFixture {
  /** Stable key for ?mock=… and Storybook story id. */
  key: string;
  /** One-line story summary, used as the chrome banner caption. */
  label: string;
  /** The suggestion stack the hook will return. May be empty. */
  suggestions: RecipeSuggestion[];
  /** The source flag the hook will report. */
  source: FeedMeSource;
  /** Synthetic pending delay before the seed lands (loading skeleton). */
  delayMs: number;
  /** The query shape that drove the fixture — used to compute the cache key. */
  query: FeedMeQuery;
}

// ─── helpers to keep fixtures terse ──────────────────────────────────────────

function ing(
  name: string,
  have: boolean,
  canonical?: string | null,
): RecipeSuggestion['ingredients'][number] {
  return { name, canonical: canonical ?? name.toLowerCase(), have };
}

function dish(
  d: string,
  cuisine: string,
  diet: string[],
  ings: RecipeSuggestion['ingredients'],
  steps: string[],
  prep: number,
  cook: number,
  servings: number,
  reasonSuggested?: string,
): RecipeSuggestion {
  return {
    dish: d,
    cuisine,
    diet,
    ingredients: ings,
    steps,
    prepMinutes: prep,
    cookMinutes: cook,
    servings,
    ...(reasonSuggested ? { reasonSuggested } : {}),
  };
}

// ─── 5 canonical fixtures ─────────────────────────────────────────────────────

export const FEED_ME_FIXTURES: Record<string, FeedMeFixture> = {
  feedme_user: {
    key: 'feedme_user',
    label: '3 mediterranean dishes · user mode',
    source: 'gemini',
    delayMs: 0,
    query: {
      pantry: ['tomato', 'olive oil', 'garlic', 'feta', 'lemon', 'bread'],
      diet: 'mediterranean',
      feedTarget: 'user',
      count: 3,
      locale: 'en',
    },
    suggestions: [
      dish(
        'shakshuka',
        'levantine',
        ['vegetarian', 'mediterranean'],
        [
          ing('tomato', true),
          ing('olive oil', true),
          ing('garlic', true),
          ing('feta', true),
          ing('egg', false),
          ing('bell pepper', false),
        ],
        [
          'warm a wide pan, soften onion and pepper in olive oil',
          'add garlic, then crushed tomatoes — simmer 8 minutes',
          'crack the eggs in, cover, finish with feta',
        ],
        5,
        15,
        2,
        'the tomatoes and feta both turn this week',
      ),
      dish(
        'pan con tomate',
        'catalan',
        ['vegetarian', 'mediterranean'],
        [
          ing('bread', true),
          ing('tomato', true),
          ing('olive oil', true),
          ing('garlic', true),
          ing('flaky salt', false),
        ],
        [
          'toast thick slices of bread',
          'rub each with raw garlic and the cut side of a tomato',
          'finish with good olive oil and salt',
        ],
        3,
        4,
        2,
      ),
      dish(
        'lemon-garlic chickpea bowl',
        'mediterranean',
        ['vegan', 'mediterranean'],
        [
          ing('lemon', true),
          ing('garlic', true),
          ing('olive oil', true),
          ing('chickpea', false),
          ing('parsley', false),
          ing('tahini', false),
        ],
        [
          'rinse cooked chickpeas, warm with olive oil and garlic',
          'whisk tahini with lemon and a splash of water',
          'spoon chickpeas on bread, drape with sauce, top with parsley',
        ],
        5,
        10,
        2,
      ),
    ],
  },

  feedme_pet_pigs: {
    key: 'feedme_pet_pigs',
    label: '3 guinea-pig meal plans · pet mode',
    source: 'gemini',
    delayMs: 0,
    query: {
      pantry: ['hay', 'romaine', 'bell pepper', 'parsley'],
      diet: 'all',
      feedTarget: 'pet',
      petName: 'the pigs',
      count: 3,
      locale: 'en',
    },
    suggestions: [
      dish(
        'morning ration · hay + greens',
        'morning · the pigs',
        ['vegan'],
        [
          ing('hay', true, 'hay'),
          ing('romaine', true, 'romaine'),
          ing('parsley', true, 'parsley'),
          ing('pellets', false, 'pellets'),
        ],
        [
          'fill the rack with fresh hay, top to bottom',
          'chop a small fistful of romaine and a sprig of parsley',
          'measure 1 tbsp pellets per pig — no more',
        ],
        4,
        0,
        3,
        'romaine softens after 3 days — use it tonight',
      ),
      dish(
        'vitamin-C boost · bell pepper treat',
        'treat · the pigs',
        ['vegan'],
        [
          ing('bell pepper', true, 'bell pepper'),
          ing('cucumber', false, 'cucumber'),
        ],
        [
          'slice one red bell pepper into thin strips',
          'serve 2 strips per pig — once a day, no seeds',
        ],
        2,
        0,
        3,
      ),
      dish(
        'evening forage · hay night',
        'evening · the pigs',
        ['vegan'],
        [ing('hay', true, 'hay')],
        [
          'refill hay rack for the long graze overnight',
          'check water — refresh if cloudy',
        ],
        2,
        0,
        3,
      ),
    ],
  },

  feedme_loading: {
    key: 'feedme_loading',
    label: 'pending shimmer · 3-card skeleton',
    source: 'gemini',
    delayMs: 100_000, // effectively never resolves; the seed is the skeleton
    suggestions: [],
    query: {
      pantry: ['milk', 'bread', 'eggs'],
      diet: 'all',
      feedTarget: 'user',
      count: 3,
      locale: 'en',
    },
  },

  feedme_static_fallback: {
    key: 'feedme_static_fallback',
    label: 'AI offline · static inferRecipe fallback',
    source: 'static_fallback',
    delayMs: 0,
    suggestions: [],
    query: {
      pantry: ['tomato', 'egg', 'feta'],
      diet: 'all',
      feedTarget: 'user',
      count: 3,
      locale: 'en',
    },
  },

  feedme_empty: {
    key: 'feedme_empty',
    label: 'pantry too sparse · zero suggestions',
    source: 'gemini',
    delayMs: 0,
    suggestions: [],
    query: {
      pantry: [],
      diet: 'all',
      feedTarget: 'user',
      count: 3,
      locale: 'en',
    },
  },
};

export const FEED_ME_FIXTURE_KEYS = Object.keys(FEED_ME_FIXTURES);

// ─── seed driver ──────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'mock-user';

/**
 * Seed the useFeedMe module-scope cache with a fixture under the canonical
 * cache key + a few common variants so the screen can read the fixture
 * regardless of whether the view drove the exact query the fixture
 * declared. This is intentional: the devtool wants the screen to show
 * the fixture even when the live store has a different pantry shape.
 */
export function seedFeedMeFixture(key: string, userId = MOCK_USER_ID): boolean {
  const fix = FEED_ME_FIXTURES[key];
  if (!fix) return false;
  // Canonical seed (matches the fixture's own declared query).
  _seedFeedMeCacheForMock(feedMeCacheKey(userId, fix.query), {
    suggestions: fix.suggestions,
    source: fix.source,
  });
  // A small set of common variant keys so QA can flip dietary pills without
  // immediately losing the fixture state. The first hit (above) keeps the
  // declared query authoritative; these variants only fire if the view
  // queries them.
  for (const diet of ['all', 'vegetarian', 'vegan', 'mediterranean', 'turkish'] as const) {
    _seedFeedMeCacheForMock(
      feedMeCacheKey(userId, { ...fix.query, diet }),
      {
        suggestions: fix.suggestions,
        source: fix.source,
      },
    );
  }
  return true;
}

// ─── ?mock=… install ──────────────────────────────────────────────────────────

const ALLOWED_PARAMS = new Set(FEED_ME_FIXTURE_KEYS);

/**
 * Call once from main.tsx. Parses `?mock=feedme_<fixture>` from the URL
 * and seeds the cache so the next FeedMe hook mount reads the fixture.
 * No-op when the param is missing or unrecognised.
 */
export function installFeedMeMockFromURL(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('mock');
  if (!raw || !ALLOWED_PARAMS.has(raw)) return;
  // Defer one tick so any boot-sequence that resets the cache has settled.
  setTimeout(() => {
    seedFeedMeFixture(raw);
  }, 50);
}
