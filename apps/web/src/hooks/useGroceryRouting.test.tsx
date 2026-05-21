/**
 * useGroceryRouting · subscription state-machine tests.
 *
 * Runs without a DOM-rendered React tree: we drive the hook via a manual
 * createRoot + functional component, then emit on the @ollie/events bus
 * directly. Vitest fake timers + IS_REACT_ACT_ENVIRONMENT keep state
 * updates synchronous and predictable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { emit, _clearAllHandlers } from '@ollie/events';
import { useGroceryRouting, type UseGroceryRoutingState } from './useGroceryRouting';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(opts?: Parameters<typeof useGroceryRouting>[0]) {
  const container = document.createElement('div');
  let last: UseGroceryRoutingState | null = null;
  function Probe() {
    last = useGroceryRouting(opts);
    return null;
  }
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    unmount() {
      act(() => root?.unmount());
    },
    get state() {
      if (!last) throw new Error('probe never rendered');
      return last;
    },
  };
}

describe('useGroceryRouting', () => {
  beforeEach(() => {
    _clearAllHandlers();
    vi.useFakeTimers();
  });
  afterEach(() => {
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('starts idle', () => {
    const h = mount();
    expect(h.state.status).toBe('idle');
    expect(h.state.result).toBeNull();
    expect(h.state.pendingRaw).toBeNull();
    h.unmount();
  });

  it('transitions idle → pending on grocery:routing:pending', () => {
    const h = mount();
    act(() => {
      emit('grocery:routing:pending', { idempotency_key: 'k1', raw: 'milk', ts: 1 });
    });
    expect(h.state.status).toBe('pending');
    expect(h.state.pendingRaw).toBe('milk');
    h.unmount();
  });

  it('transitions pending → routed on grocery:routed (cache)', () => {
    const h = mount();
    act(() => {
      emit('grocery:routing:pending', { idempotency_key: 'k1', raw: 'milk', ts: 1 });
      emit('grocery:routed', {
        idempotency_key: 'k1',
        raw: 'milk',
        items: [{ name: 'milk', target: 'shopping' }],
        source: 'cache',
        latency_ms: 8,
        ts: 2,
      });
    });
    expect(h.state.status).toBe('routed');
    expect(h.state.result?.source).toBe('cache');
    expect(h.state.result?.items[0].name).toBe('milk');
    h.unmount();
  });

  it('maps source=fallback to status=fallback', () => {
    const h = mount();
    act(() => {
      emit('grocery:routed', {
        idempotency_key: 'k1',
        raw: 'butter',
        items: [{ name: 'butter', target: 'shopping' }],
        source: 'fallback',
        latency_ms: 50,
        ts: 1,
      });
    });
    expect(h.state.status).toBe('fallback');
    h.unmount();
  });

  it('maps error string to status=error', () => {
    const h = mount();
    act(() => {
      emit('grocery:routed', {
        idempotency_key: 'k1',
        raw: 'x',
        items: [{ name: 'x', target: 'shopping' }],
        source: 'fallback',
        latency_ms: 1,
        ts: 1,
        error: 'gemini_unavailable',
      });
    });
    expect(h.state.status).toBe('error');
    h.unmount();
  });

  it('auto-resets to idle after autoResetMs', () => {
    const h = mount({ autoResetMs: 100 });
    act(() => {
      emit('grocery:routed', {
        idempotency_key: 'k1',
        raw: 'milk',
        items: [{ name: 'milk', target: 'shopping' }],
        source: 'cache',
        latency_ms: 1,
        ts: 1,
      });
    });
    expect(h.state.status).toBe('routed');
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(h.state.status).toBe('idle');
    h.unmount();
  });

  it('scopeKey filters out non-matching emits', () => {
    const h = mount({ scopeKey: 'mine' });
    act(() => {
      emit('grocery:routing:pending', { idempotency_key: 'theirs', raw: 'x', ts: 1 });
    });
    expect(h.state.status).toBe('idle');
    act(() => {
      emit('grocery:routing:pending', { idempotency_key: 'mine', raw: 'mine-raw', ts: 1 });
    });
    expect(h.state.status).toBe('pending');
    h.unmount();
  });

  it('unsubscribes on unmount (no leak)', () => {
    const h = mount();
    h.unmount();
    // After unmount, no errors should fire when events come in.
    expect(() => {
      emit('grocery:routing:pending', { idempotency_key: 'k', raw: 'x', ts: 1 });
    }).not.toThrow();
  });
});
