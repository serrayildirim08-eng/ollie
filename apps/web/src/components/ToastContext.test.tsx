/**
 * ToastContext · useToast reference stability (audit-fix #15)
 * + provider-guard regression tests (Sentry #7487966680 / #7487966681)
 *
 * The bug: `useToast()` did `return { show: ctx.show }`, allocating a
 * fresh object every render. Consumers that list `toast` in a
 * `useCallback` / `useEffect` dependency array (notably
 * `useApplyBrainDump`) re-ran their memo/effect on EVERY render.
 *
 * The fix: the wrapper is `useMemo`-d on the (already stable) `ctx.show`,
 * so the object returned by `useToast()` is referentially stable for the
 * lifetime of the provider.
 *
 * Provider-guard regression (2026-05-21):
 * Sentry showed "useToast must be inside <ToastProvider>" thrown from
 * AppServicesProvider → useApplyBrainDump → useToast. Root cause: the
 * provider used to live in App.tsx while AppServicesProvider lived in
 * router.tsx, so any alternate mount of AppRouter (tests, future entry
 * points) would silently omit the provider. The provider was moved into
 * AppRouter (router.tsx) to make the coupling structural. These tests
 * guard against regression: useToast MUST throw outside a provider, and
 * MUST work inside one — the provider chain is the contract.
 */

import { act, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider, useToast, useToastState } from './ToastContext';

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

// ─── Provider-guard regression (Sentry #7487966680 / #7487966681) ───────────
//
// useToast and useToastState MUST throw a clear error when called outside
// <ToastProvider>. React renders errors inside an error boundary so we
// drive them with createRoot + a try/catch consumer rather than
// renderHook, which would itself need a wrapper.

describe('useToast — provider guard (Sentry regression)', () => {
  it('useToast throws the provider-guard error when called outside ToastProvider', () => {
    let caught: unknown = null;

    function BadConsumer() {
      try {
        useToast();
      } catch (e) {
        caught = e;
      }
      return null;
    }

    const host = document.createElement('div');
    const root: Root = createRoot(host);

    // Suppress React's console.error for the expected throw.
    const originalError = console.error;
    console.error = () => {};

    act(() => {
      root.render(<BadConsumer />);
    });

    console.error = originalError;
    act(() => root.unmount());

    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(/useToast must be used inside/);
  });

  it('useToastState throws the provider-guard error when called outside ToastProvider', () => {
    let caught: unknown = null;

    function BadConsumer() {
      try {
        useToastState();
      } catch (e) {
        caught = e;
      }
      return null;
    }

    const host = document.createElement('div');
    const root: Root = createRoot(host);

    const originalError = console.error;
    console.error = () => {};

    act(() => {
      root.render(<BadConsumer />);
    });

    console.error = originalError;
    act(() => root.unmount());

    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(/useToastState must be used inside/);
  });

  it('useToast works normally when ToastProvider is present', () => {
    let toastRef: ReturnType<typeof useToast> | undefined;

    function GoodConsumer() {
      toastRef = useToast();
      return null;
    }

    const host = document.createElement('div');
    const root: Root = createRoot(host);

    act(() => {
      root.render(
        <ToastProvider>
          <GoodConsumer />
        </ToastProvider>,
      );
    });

    expect(toastRef).toBeDefined();
    expect(typeof toastRef!.show).toBe('function');

    act(() => root.unmount());
  });
});
