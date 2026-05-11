/**
 * @ollie/api · anthropic tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeViaHaiku, __resetLastCallTs } from '../src/anthropic';

const TEST_ENDPOINT = 'http://localhost:0/v1/messages';

// Shared opts that pin the endpoint so tests never hit the real worker.
const BASE_OPTS = { endpoint: TEST_ENDPOINT, minGapMs: 0 };

function makeResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  __resetLastCallTs();
  (globalThis as Record<string, unknown>).__voidAIOffline = false;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── happy path ────────────────────────────────────────────────────────────────

describe('routeViaHaiku — happy path', () => {
  it('returns parsed Action[] on valid 200 response', async () => {
    const payload = [
      { module: 'grocery', action: 'add', data: 'eggs' },
      { module: 'finance', action: 'add', data: 'pay rent' },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeResp({ content: [{ text: JSON.stringify(payload) }] }),
    );

    const result = await routeViaHaiku('buy eggs and pay rent', undefined, BASE_OPTS);

    expect(result).toHaveLength(2);
    expect(result![0]).toMatchObject({ module: 'grocery', action: 'add', data: 'eggs' });
    expect(result![1]).toMatchObject({ module: 'finance', action: 'add', data: 'pay rent' });
    expect((globalThis as Record<string, unknown>).__voidAIOffline).toBe(false);
  });

  it('strips markdown code fences before parsing', async () => {
    const payload = [{ module: 'dump', action: 'log', data: 'feeling good' }];
    const fenced = '```json\n' + JSON.stringify(payload) + '\n```';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeResp({ content: [{ text: fenced }] }),
    );

    const result = await routeViaHaiku('feeling good', undefined, BASE_OPTS);
    expect(result).toHaveLength(1);
    expect(result![0].module).toBe('dump');
  });
});

// ── 5xx / 4xx ─────────────────────────────────────────────────────────────────

describe('routeViaHaiku — HTTP errors', () => {
  it('returns null and sets __voidAIOffline on 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResp({ error: 'oops' }, 500));

    const result = await routeViaHaiku('test', undefined, BASE_OPTS);

    expect(result).toBeNull();
    expect((globalThis as Record<string, unknown>).__voidAIOffline).toBe(true);
  });

  it('returns null and sets __voidAIOffline on 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeResp({ error: 'rate limited' }, 429));

    const result = await routeViaHaiku('test', undefined, BASE_OPTS);

    expect(result).toBeNull();
    expect((globalThis as Record<string, unknown>).__voidAIOffline).toBe(true);
  });
});

// ── network error ─────────────────────────────────────────────────────────────

describe('routeViaHaiku — network error', () => {
  it('returns null and sets __voidAIOffline when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await routeViaHaiku('test', undefined, BASE_OPTS);

    expect(result).toBeNull();
    expect((globalThis as Record<string, unknown>).__voidAIOffline).toBe(true);
  });
});

// ── rate-limit gate ───────────────────────────────────────────────────────────

describe('routeViaHaiku — rate-limit gate', () => {
  it('returns null immediately if called twice within minGapMs', async () => {
    const payload = [{ module: 'habits', action: 'add', data: 'walk' }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResp({ content: [{ text: JSON.stringify(payload) }] }),
    );

    // First call succeeds (minGapMs=0 for this, but we override to 3000 here).
    const opts = { endpoint: TEST_ENDPOINT, minGapMs: 3_000 };

    const first = await routeViaHaiku('walk', undefined, opts);
    expect(first).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call within 3s — should be gated.
    const second = await routeViaHaiku('walk again', undefined, opts);
    expect(second).toBeNull();
    // fetch must NOT have been called a second time.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ── AbortController / timeout ─────────────────────────────────────────────────

describe('routeViaHaiku — timeout', () => {
  it('aborts and returns null when fetch hangs beyond timeoutMs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          // Simulate abort being triggered.
          (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
          // Never resolves on its own.
        }),
    );

    const result = await routeViaHaiku('slow request', undefined, {
      ...BASE_OPTS,
      timeoutMs: 20,
    });

    expect(result).toBeNull();
    expect((globalThis as Record<string, unknown>).__voidAIOffline).toBe(true);
  });
});

// ── malformed JSON ────────────────────────────────────────────────────────────

describe('routeViaHaiku — parse errors', () => {
  it('returns null and sets __voidAIOffline when response is not valid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeResp({ content: [{ text: 'not json at all' }] }),
    );

    const result = await routeViaHaiku('test', undefined, BASE_OPTS);

    expect(result).toBeNull();
    expect((globalThis as Record<string, unknown>).__voidAIOffline).toBe(true);
  });

  it('returns null (not offline) when response is an answer object, not an array', async () => {
    const answer = { type: 'answer', text: 'you logged rent 3 days ago', lookupModules: ['finance'] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeResp({ content: [{ text: JSON.stringify(answer) }] }),
    );

    const result = await routeViaHaiku('when is my rent due?', undefined, BASE_OPTS);

    expect(result).toBeNull();
    // Answer objects are a valid non-error path — offline flag stays false.
    expect((globalThis as Record<string, unknown>).__voidAIOffline).toBe(false);
  });
});
