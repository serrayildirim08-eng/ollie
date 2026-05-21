/**
 * useReplenishment · fetch + cache + refresh tests.
 *
 * Drives the hook through a manual createRoot + functional component
 * probe, stubbing window.fetch + the Vite env on import.meta. Vitest
 * fake timers + IS_REACT_ACT_ENVIRONMENT keep state updates synchronous.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  useReplenishment,
  staticEstimate,
  resolveEstimate,
  _resetReplenishmentCache,
  _seedReplenishmentCacheForMock,
  _setReplenishmentWorkerUrlForTests,
  STATIC_SHELF_LIFE,
  type ReplenishmentEstimate,
  type UseReplenishmentResult,
} from './useReplenishment';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── env + fetch stubs ────────────────────────────────────────────────────────

function stubWorkerUrl(url: string | undefined): void {
  // `null` = simulate the "no worker URL configured" branch
  // (a real string) = pin the URL the hook will hit
  _setReplenishmentWorkerUrlForTests(url === undefined ? null : url);
}

interface WireEstimate {
  canonical: string;
  daysLeft: number;
  confidence: 'static' | 'low-data' | 'observed';
  sampleSize: number;
  medianIntervalDays: number;
  lastPurchaseTs: number;
}

function mkResponse(estimates: WireEstimate[], ok = true, status = 200): Response {
  return new Response(JSON.stringify({ estimates }), {
    status: ok ? status : status,
    headers: { 'content-type': 'application/json' },
  });
}

function mkError(status: number): Response {
  return new Response('not found', { status, headers: {} });
}

// ─── probe ────────────────────────────────────────────────────────────────────

function mount(userId: string | null) {
  const container = document.createElement('div');
  let last: UseReplenishmentResult | null = null;
  function Probe() {
    last = useReplenishment(userId);
    return null;
  }
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    rerender(newUserId: string | null) {
      function Probe2() {
        last = useReplenishment(newUserId);
        return null;
      }
      act(() => {
        root?.render(<Probe2 />);
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

// flush microtasks so the in-flight fetch().then resolves
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useReplenishment', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetReplenishmentCache();
    stubWorkerUrl('https://test.example');
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    _resetReplenishmentCache();
    _setReplenishmentWorkerUrlForTests(undefined);
  });

  it('returns an empty Map when userId is null (no fetch)', () => {
    const h = mount(null);
    expect(h.state.estimates.size).toBe(0);
    expect(h.state.loading).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    h.unmount();
  });

  it('fetches and populates the Map for a userId', async () => {
    fetchSpy.mockResolvedValueOnce(
      mkResponse([
        {
          canonical: 'milk',
          daysLeft: 2,
          confidence: 'observed',
          sampleSize: 5,
          medianIntervalDays: 3,
          lastPurchaseTs: Date.now() - 86400000,
        },
      ]),
    );
    const h = mount('user-a');
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toBe('https://test.example/replenishment/user-a');
    expect(h.state.estimates.size).toBe(1);
    const milk = h.state.estimates.get('milk');
    expect(milk?.confidence).toBe('observed');
    expect(milk?.daysLeft).toBe(2);
    h.unmount();
  });

  it('falls back to an empty Map on a 404 (consumer reads static)', async () => {
    fetchSpy.mockResolvedValueOnce(mkError(404));
    const h = mount('user-b');
    await flush();
    expect(h.state.estimates.size).toBe(0);
    expect(h.state.loading).toBe(false);
    h.unmount();
  });

  it('falls back to an empty Map on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('net down'));
    const h = mount('user-c');
    await flush();
    expect(h.state.estimates.size).toBe(0);
    expect(h.state.loading).toBe(false);
    h.unmount();
  });

  it('re-fetches when refresh() is called (bypasses 60s cache)', async () => {
    fetchSpy.mockResolvedValue(
      mkResponse([
        {
          canonical: 'milk',
          daysLeft: 5,
          confidence: 'observed',
          sampleSize: 3,
          medianIntervalDays: 7,
          lastPurchaseTs: 0,
        },
      ]),
    );
    const h = mount('user-d');
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    act(() => {
      h.state.refresh();
    });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it('honours the 60s in-memory cache for a fresh second mount', async () => {
    // First mount: real fetch fills the cache
    fetchSpy.mockResolvedValueOnce(
      mkResponse([
        {
          canonical: 'milk',
          daysLeft: 2,
          confidence: 'observed',
          sampleSize: 5,
          medianIntervalDays: 3,
          lastPurchaseTs: 0,
        },
      ]),
    );
    const h1 = mount('user-e');
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    h1.unmount();

    // Second mount within 60s: no second fetch, Map comes from cache
    const h2 = mount('user-e');
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(h2.state.estimates.get('milk')?.daysLeft).toBe(2);
    h2.unmount();
  });

  it('degrades to empty Map when VITE_AI_WORKER_URL is unset', async () => {
    stubWorkerUrl(undefined);
    const h = mount('user-f');
    await flush();
    expect(h.state.estimates.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    h.unmount();
  });

  it('ignores malformed wire entries', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          estimates: [
            { canonical: 'milk' }, // missing fields
            {
              canonical: 'bread',
              daysLeft: 5,
              confidence: 'low-data',
              sampleSize: 1,
              medianIntervalDays: 7,
              lastPurchaseTs: 0,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const h = mount('user-g');
    await flush();
    expect(h.state.estimates.size).toBe(1);
    expect(h.state.estimates.get('bread')).toBeDefined();
    h.unmount();
  });
});

// ─── pure helpers ─────────────────────────────────────────────────────────────

describe('staticEstimate', () => {
  it('returns confidence=static + the static shelf-life days', () => {
    const e = staticEstimate('milk');
    expect(e.canonical).toBe('milk');
    expect(e.daysLeft).toBe(STATIC_SHELF_LIFE.milk);
    expect(e.confidence).toBe('static');
    expect(e.sampleSize).toBe(0);
    expect(e.lastPurchaseTs).toBe(0);
  });

  it('falls back to the default (14 days) for unknown canonicals', () => {
    const e = staticEstimate('alfalfa');
    expect(e.daysLeft).toBe(14);
  });

  it('lowercases + trims the input', () => {
    const e = staticEstimate('  MILK  ');
    expect(e.canonical).toBe('milk');
    expect(e.daysLeft).toBe(STATIC_SHELF_LIFE.milk);
  });
});

describe('resolveEstimate', () => {
  it('returns the Map entry when present', () => {
    const map = new Map<string, ReplenishmentEstimate>();
    const observed: ReplenishmentEstimate = {
      canonical: 'milk',
      daysLeft: 2,
      confidence: 'observed',
      sampleSize: 5,
      medianIntervalDays: 3,
      lastPurchaseTs: 0,
    };
    map.set('milk', observed);
    expect(resolveEstimate(map, 'milk')).toBe(observed);
  });

  it('falls back to staticEstimate when the key is absent', () => {
    const map = new Map<string, ReplenishmentEstimate>();
    const r = resolveEstimate(map, 'milk');
    expect(r.confidence).toBe('static');
  });
});

describe('_seedReplenishmentCacheForMock', () => {
  beforeEach(() => _resetReplenishmentCache());
  afterEach(() => _resetReplenishmentCache());

  it('lets the next hook mount resolve instantly without a fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    stubWorkerUrl('https://test.example');

    const map = new Map<string, ReplenishmentEstimate>();
    map.set('milk', {
      canonical: 'milk',
      daysLeft: 1,
      confidence: 'observed',
      sampleSize: 8,
      medianIntervalDays: 2,
      lastPurchaseTs: 0,
    });
    _seedReplenishmentCacheForMock('mock-user', map);

    const h = mount('mock-user');
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.state.estimates.get('milk')?.daysLeft).toBe(1);
    h.unmount();
  });
});
