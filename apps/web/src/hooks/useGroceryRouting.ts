/**
 * useGroceryRouting
 *
 * Subscribes to the two `@ollie/events` grocery-routing events that
 * the backend (T0/T1/T2) emits on the dump → AI router pipeline:
 *
 *   • `grocery:routing:pending` — fires the instant a grocery dump is
 *     accepted by the router; UI shows a non-blocking PendingHair shimmer
 *     while we wait. Pairs with `idempotency_key`.
 *   • `grocery:routed`         — fires when the router resolves. Carries
 *     the parsed `items[]` (each with `target: shopping|pantry`), the
 *     `source` (cache|gemini|fallback), and a latency reading.
 *
 * The hook is intentionally local: each call site (BrainDumpInput shell,
 * GroceryModule header) gets its own subscription + status machine. It
 * does NOT route into the store — that stays the responsibility of
 * `useApplyBrainDump`. This hook is the *display* contract for
 * SortedToast + PendingHair only.
 *
 * Status state machine:
 *   idle  ──(pending event)──▶ pending  ──(routed, source=cache|gemini)──▶ routed
 *                                       ──(routed, source=fallback)─────▶ fallback
 *                                       ──(routed, error: string)──────▶ error
 *
 * The hook auto-resets to `idle` after `autoResetMs` (default 4s) so the
 * next dump starts clean. Pass `0` to disable auto-reset (devtool / story
 * fixtures keep their state visible).
 *
 * Contract with the backend lives in:
 *   packages/events/src/registry.ts  ·  packages/events/src/shapes.ts
 *
 * Once backend ships `packages/events/src/grocery-routing.ts` with the
 * formal types we'll swap the local `GroceryRoutedPayload` for the
 * exported type — until then we keep the type local so this pod can
 * land ahead of theirs without an import cycle.
 */

import { useEffect, useRef, useState } from 'react';
import { on } from '@ollie/events';

// ─── Public types ─────────────────────────────────────────────────────────────

export type GroceryRoutingStatus =
  | 'idle'
  | 'pending'
  | 'routed'
  | 'fallback'
  | 'error';

export type GroceryRoutingTarget = 'shopping' | 'pantry';

export type GroceryRoutingSource = 'cache' | 'gemini' | 'fallback';

export interface GroceryRoutedItem {
  name: string;
  target: GroceryRoutingTarget;
  /** Recipe expansion link — when present, item was derived from a recipe
   *  the user named (e.g. "spaghetti bolognese" → 6 items, all stamped
   *  with `recipe_parent: "spaghetti bolognese"`). */
  recipe_parent?: string;
}

export interface GroceryRoutingResult {
  idempotency_key: string;
  raw: string;
  items: GroceryRoutedItem[];
  source: GroceryRoutingSource;
  latency_ms: number;
  ts: number;
  error?: string;
}

interface PendingPayload {
  idempotency_key: string;
  raw: string;
  ts: number;
}

export interface UseGroceryRoutingState {
  status: GroceryRoutingStatus;
  result: GroceryRoutingResult | null;
  /** Raw text of the in-flight dump, available during `pending`. Null otherwise. */
  pendingRaw: string | null;
}

export interface UseGroceryRoutingOptions {
  /** Auto-reset to `idle` this many ms after a terminal event. Default 4000.
   *  Pass 0 to keep the last result visible indefinitely (devtool/stories). */
  autoResetMs?: number;
  /** When set, the hook only reacts to events whose idempotency_key matches.
   *  Use this on a per-dump basis to scope a chip to a specific submission. */
  scopeKey?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const INITIAL: UseGroceryRoutingState = {
  status: 'idle',
  result: null,
  pendingRaw: null,
};

export function useGroceryRouting(
  options: UseGroceryRoutingOptions = {},
): UseGroceryRoutingState {
  const { autoResetMs = 4000, scopeKey } = options;
  const [state, setState] = useState<UseGroceryRoutingState>(INITIAL);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearResetTimer() {
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
        resetTimer.current = null;
      }
    }

    function scheduleReset() {
      if (autoResetMs <= 0) return;
      clearResetTimer();
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        setState(INITIAL);
      }, autoResetMs);
    }

    const offPending = on<PendingPayload>('grocery:routing:pending', (p) => {
      if (scopeKey && p.idempotency_key !== scopeKey) return;
      clearResetTimer();
      setState({
        status: 'pending',
        result: null,
        pendingRaw: p.raw,
      });
    });

    const offRouted = on<GroceryRoutingResult>('grocery:routed', (p) => {
      if (scopeKey && p.idempotency_key !== scopeKey) return;
      const nextStatus: GroceryRoutingStatus = p.error
        ? 'error'
        : p.source === 'fallback'
          ? 'fallback'
          : 'routed';
      setState({
        status: nextStatus,
        result: p,
        pendingRaw: null,
      });
      scheduleReset();
    });

    return () => {
      offPending();
      offRouted();
      clearResetTimer();
    };
  }, [autoResetMs, scopeKey]);

  return state;
}
