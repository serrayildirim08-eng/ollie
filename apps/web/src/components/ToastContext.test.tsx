/**
 * ToastContext · useToast reference stability (audit-fix #15)
 *
 * The bug: `useToast()` did `return { show: ctx.show }`, allocating a
 * fresh object every render. Consumers that list `toast` in a
 * `useCallback` / `useEffect` dependency array (notably
 * `useApplyBrainDump`) re-ran their memo/effect on EVERY render.
 *
 * The fix: the wrapper is `useMemo`-d on the (already stable) `ctx.show`,
 * so the object returned by `useToast()` is referentially stable for the
 * lifetime of the provider.
 */

import React, { act, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider, useToast } from './ToastContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('useToast — reference stability', () => {
  it('returns the SAME object across re-renders of the consumer', () => {
    const seen: Array<ReturnType<typeof useToast>> = [];
    let forceRender: (() => void) | null = null;

    function Consumer() {
      const toast = useToast();
      const [, setN] = useState(0);
      seen.push(toast);
      forceRender = () => setN((n) => n + 1);
      return null;
    }

    const host = document.createElement('div');
    const root: Root = createRoot(host);

    act(() => {
      root.render(
        <ToastProvider>
          <Consumer />
        </ToastProvider>,
      );
    });

    // Force a re-render of the consumer that does NOT touch toast state.
    act(() => {
      forceRender?.();
    });
    act(() => {
      forceRender?.();
    });

    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Every render observed the identical object reference.
    for (const t of seen) {
      expect(t).toBe(seen[0]);
    }

    act(() => root.unmount());
  });

  it('the `show` function reference is stable across re-renders', () => {
    const shows: Array<(m: string) => void> = [];
    let forceRender: (() => void) | null = null;

    function Consumer() {
      const toast = useToast();
      const [, setN] = useState(0);
      shows.push(toast.show);
      forceRender = () => setN((n) => n + 1);
      return null;
    }

    const host = document.createElement('div');
    const root: Root = createRoot(host);

    act(() => {
      root.render(
        <ToastProvider>
          <Consumer />
        </ToastProvider>,
      );
    });
    act(() => forceRender?.());

    expect(shows.length).toBeGreaterThanOrEqual(2);
    expect(shows[1]).toBe(shows[0]);

    act(() => root.unmount());
  });
});
