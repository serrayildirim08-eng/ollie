/**
 * useFeedMe · fetch + cache + telemetry tests.
 *
 * Mirrors the `useReplenishment.test.tsx` setup: createRoot probe over a
 * functional component, stubbed `globalThis.fetch`, vitest fake timers,
 * IS_REACT_ACT_ENVIRONMENT so state updates flush synchronously.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { _clearAllHandlers, on } from '@ollie/events';
import {
  useFeedMe,
  postCookHistory,
  feedMeCacheKey,
  _resetFeedMeCache,
  _setFeedMeWorkerUrlForTests,
  type UseFeedMeResult,
  type FeedMeQuery,
  type RecipeSuggestion,
} from './useFeedMe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ─── helpers ──────────────────────────────────────────────────────────────────

function stubWorkerUrl(url: string | undefined): void {
  _setFeedMeWorkerUrlForTests(url === undefined ? null : url);
}

function mkSuggestion(dish = 'shakshuka'): RecipeSuggestion {
  return {
    dish,
    cuisine: 'levantine',
    diet: ['vegetarian'],
    ingredients: [
      { name: 'tomato', canonical: 'tomato', have: true },
      { name: 'egg', canonical: 'egg', have: false },
    ],
    steps: ['warm pan', 'add eggs'],
    prepMinutes: 5,
    cookMinutes: 15,
    servings: 2,
  };
}

function mkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mkError(status: number): Response {
  return new Response('error', { status });
}

function mount(userId: string | null, query: FeedMeQuery) {
  const container = document.createElement('div');
  let last: UseFeedMeResult | null = null;
  let currentQuery = query;
  function Probe() {
    last = useFeedMe(userId, currentQuery);
    return null;
  }
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    rerenderWithQuery(next: FeedMeQuery) {
      currentQuery = next;
      act(() => {
        root?.render(<Probe />);
      });
    },
    unmount() {
      act(() => root?.unmount());
    },
    get state() {
      if (!last) throw new Error('probe never rendered');
      return last;
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useFeedMe', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _clearAllHandlers();
    _resetFeedMeCache();
    stubWorkerUrl('https://test.example');
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    _clearAllHandlers();
    _resetFeedMeCache();
    _setFeedMeWorkerUrlForTests(undefined);
  });

  it('returns static_fallback shape when userId is null (no fetch)', () => {
    const h = mount(null, { pantry: ['milk'] });
    expect(h.state.source).toBe('static_fallback');
    expect(h.state.suggestions).toEqual([]);
    expect(h.state.loading).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    h.unmount();
  });

  it('returns static_fallback shape when worker URL is not configured', () => {
    stubWorkerUrl(undefined);
    const h = mount('u1', { pantry: ['milk'] });
    expect(h.state.source).toBe('static_fallback');
    expect(h.state.suggestions).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    h.unmount();
  });

  it('successful fetch populates suggestions and reports gemini source', async () => {
    fetchSpy.mockResolvedValueOnce(
      mkResponse({
        suggestions: [mkSuggestion('shakshuka')],
        source: 'gemini',
        latencyMs: 410,
      }),
    );
    const h = mount('u1', { pantry: ['tomato', 'egg'] });
    expect(h.state.loading).toBe(true);
    expect(h.state.source).toBe('loading');
    await flush();
    expect(h.state.suggestions.length).toBe(1);
    expect(h.state.suggestions[0].dish).toBe('shakshuka');
    expect(h.state.source).toBe('gemini');
    expect(h.state.loading).toBe(false);
    expect(h.state.error).toBeNull();
    h.unmount();
  });

  it('http 5xx falls back to static_fallback with no error thrown', async () => {
    fetchSpy.mockResolvedValueOnce(mkError(503));
    const h = mount('u1', { pantry: ['milk'] });
    await flush();
    expect(h.state.source).toBe('static_fallback');
    expect(h.state.suggestions).toEqual([]);
    expect(h.state.error).toBe('http_503');
    expect(h.state.loading).toBe(false);
    h.unmount();
  });

  it('network error falls back to static_fallback with captured message', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'));
    const h = mount('u1', { pantry: ['milk'] });
    await flush();
    expect(h.state.source).toBe('static_fallback');
    expect(h.state.error).toBe('boom');
    expect(h.state.loading).toBe(false);
    h.unmount();
  });

  it('malformed response payload reports static_fallback', async () => {
    fetchSpy.mockResolvedValueOnce(mkResponse({ nope: true }));
    const h = mount('u1', { pantry: ['milk'] });
    await flush();
    expect(h.state.source).toBe('static_fallback');
    expect(h.state.suggestions).toEqual([]);
    h.unmount();
  });

  it('60s cache prevents duplicate identical query', async () => {
    fetchSpy.mockResolvedValueOnce(
      mkResponse({
        suggestions: [mkSuggestion()],
        source: 'gemini',
        latencyMs: 100,
      }),
    );
    const h = mount('u1', { pantry: ['tomato'] });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // remount with the same query — should read from cache
    const h2 = mount('u1', { pantry: ['tomato'] });
    expect(h2.state.suggestions.length).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // unchanged
    h.unmount();
    h2.unmount();
  });

  it('refresh() forces a re-fetch even with a fresh cache entry', async () => {
    fetchSpy.mockResolvedValue(
      mkResponse({
        suggestions: [mkSuggestion('first')],
        source: 'gemini',
        latencyMs: 100,
      }),
    );
    const h = mount('u1', { pantry: ['tomato'] });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // explicit refresh bumps tick, bypasses cache
    fetchSpy.mockResolvedValueOnce(
      mkResponse({
        suggestions: [mkSuggestion('second')],
        source: 'gemini',
        latencyMs: 100,
      }),
    );
    act(() => h.state.refresh());
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(h.state.suggestions[0].dish).toBe('second');
    h.unmount();
  });

  it('diet change produces a new cache key and re-fetches', async () => {
    fetchSpy.mockResolvedValueOnce(
      mkResponse({
        suggestions: [mkSuggestion('first')],
        source: 'gemini',
        latencyMs: 100,
      }),
    );
    const h = mount('u1', { pantry: ['tomato'], diet: 'all' });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockResolvedValueOnce(
      mkResponse({
        suggestions: [mkSuggestion('vegan_dish')],
        source: 'gemini',
        latencyMs: 100,
      }),
    );
    h.rerenderWithQuery({ pantry: ['tomato'], diet: 'vegan' });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(h.state.suggestions[0].dish).toBe('vegan_dish');
    h.unmount();
  });

  it('excludeDishes change produces a new cache key', async () => {
    fetchSpy.mockResolvedValue(
      mkResponse({
        suggestions: [mkSuggestion()],
        source: 'gemini',
        latencyMs: 0,
      }),
    );
    const h = mount('u1', { pantry: ['tomato'] });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    h.rerenderWithQuery({ pantry: ['tomato'], excludeDishes: ['shakshuka'] });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it('unmount aborts the in-flight fetch', async () => {
    let aborted = false;
    fetchSpy.mockImplementation((_url, init) => {
      const sig = (init as { signal: AbortSignal }).signal;
      sig.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise(() => {
        // never resolves
      });
    });
    const h = mount('u1', { pantry: ['milk'] });
    h.unmount();
    expect(aborted).toBe(true);
  });

  it('emits feedme:requested + feedme:suggested on a successful fetch', async () => {
    const requests: unknown[] = [];
    const suggesteds: unknown[] = [];
    on('feedme:requested', (p) => requests.push(p));
    on('feedme:suggested', (p) => suggesteds.push(p));

    fetchSpy.mockResolvedValueOnce(
      mkResponse({
        suggestions: [mkSuggestion()],
        source: 'gemini',
        latencyMs: 200,
      }),
    );
    const h = mount('u1', {
      pantry: ['tomato'],
      diet: 'mediterranean',
      feedTarget: 'user',
    });
    await flush();
    expect(requests.length).toBe(1);
    expect(suggesteds.length).toBe(1);
    expect((suggesteds[0] as { count: number }).count).toBe(1);
    expect((suggesteds[0] as { source: string }).source).toBe('gemini');
    h.unmount();
  });

  it('feedMeCacheKey is order-independent on pantry + excludeDishes', () => {
    const a = feedMeCacheKey('u', {
      pantry: ['a', 'b', 'c'],
      excludeDishes: ['x', 'y'],
    });
    const b = feedMeCacheKey('u', {
      pantry: ['c', 'a', 'b'],
      excludeDishes: ['y', 'x'],
    });
    expect(a).toBe(b);
  });
});

// ─── postCookHistory ──────────────────────────────────────────────────────────

describe('postCookHistory', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _clearAllHandlers();
    stubWorkerUrl('https://test.example');
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    _clearAllHandlers();
    _setFeedMeWorkerUrlForTests(undefined);
  });

  it('emits feedme:cooked even when the worker is not configured', async () => {
    stubWorkerUrl(undefined);
    const cooked: unknown[] = [];
    on('feedme:cooked', (p) => cooked.push(p));
    const ok = await postCookHistory('u1', {
      dish: 'shakshuka',
      rating: 1,
      feedTarget: 'user',
    });
    expect(cooked.length).toBe(1);
    expect(ok).toBe(false);
  });

  it('returns true on a 201 write and emits feedme:cooked', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'row-1' }), { status: 201 }),
    );
    const cooked: unknown[] = [];
    on('feedme:cooked', (p) => cooked.push(p));
    const ok = await postCookHistory('u1', {
      dish: 'shakshuka',
      rating: 1,
      feedTarget: 'user',
    });
    expect(ok).toBe(true);
    expect(cooked.length).toBe(1);
    expect((cooked[0] as { rating: number }).rating).toBe(1);
  });
});
