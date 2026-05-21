/**
 * SortedToastHost — root-level driver for the grocery routing popup.
 *
 * Mount exactly once near the app root (alongside <ChipFlyHost />,
 * <ToastHost />). Subscribes to:
 *   - `grocery:routed` via useGroceryRouting (mode='sorted', existing)
 *   - `grocery:mutation` (mode='removed' | 'moved' | 'checked')
 *   - `grocery:undone`  (mode='undone')
 *
 * Toast strategy: replace-with-fade — one toast visible at a time.
 * Rapid events (e.g. batch mutations) replace the previous toast rather
 * than stacking. This mirrors the grocery list's own optimistic-update
 * semantics where the last action is what the user cares about.
 *
 * Why a separate host (not just inline in BrainDumpInput):
 *   The popup is global — it must surface even if the user has scrolled
 *   away from the dump bar or navigated to a different module. The host
 *   sits above the route tree so it persists across route changes.
 */

import { useEffect, useState, useCallback } from 'react';
import { on } from '@ollie/events';
import { SortedToast, type ToastMode } from './SortedToast';
import { useGroceryRouting, type GroceryRoutingResult } from '../hooks/useGroceryRouting';

// ─── Toast state union ────────────────────────────────────────────────────────

interface RoutedToastState {
  kind: 'routed';
  result: GroceryRoutingResult;
}

interface MutationToastState {
  kind: 'mutation';
  mode: 'removed' | 'moved' | 'checked';
  itemName?: string;
  slice?: 'shopping' | 'pantry';
  itemCount?: number;
}

interface UndoneToastState {
  kind: 'undone';
  description: string;
}

type ToastState = RoutedToastState | MutationToastState | UndoneToastState;

// ─── Minimal result placeholder for mutation-mode toasts ─────────────────────
// SortedToast always receives a `result` prop (required by its type). For
// mutation/undone toasts the routing result is irrelevant — we pass a minimal
// placeholder so TypeScript stays happy without a large optional prop refactor.
const NOOP_RESULT: GroceryRoutingResult = {
  idempotency_key: 'noop',
  raw: '',
  items: [],
  source: 'cache',
  latency_ms: 0,
  ts: 0,
};

export function SortedToastHost() {
  const { status, result } = useGroceryRouting({ autoResetMs: 6000 });
  const [toastState, setToastState] = useState<ToastState | null>(null);

  // ── grocery:routed (existing, mode='sorted') ───────────────────────────────
  useEffect(() => {
    if (
      result &&
      (status === 'routed' || status === 'fallback' || status === 'error')
    ) {
      setToastState({ kind: 'routed', result });
    }
    if (status === 'idle' && toastState?.kind === 'routed') {
      setToastState(null);
    }
    // `toastState` intentionally omitted — we only react to status/result flip.
  }, [status, result]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── grocery:mutation (new, mode='removed'|'moved'|'checked') ──────────────
  const handleMutation = useCallback(
    (payload: unknown) => {
      const p = payload as {
        mode: 'removed' | 'moved' | 'checked';
        itemName?: string;
        itemCount?: number;
        slice?: 'shopping' | 'pantry';
        ts: number;
      };
      setToastState({
        kind: 'mutation',
        mode: p.mode,
        itemName: p.itemName,
        slice: p.slice,
        itemCount: p.itemCount,
      });
    },
    [],
  );

  // ── grocery:undone (new, mode='undone') ────────────────────────────────────
  const handleUndone = useCallback(
    (payload: unknown) => {
      const p = payload as { description: string; ts: number };
      setToastState({ kind: 'undone', description: p.description });
    },
    [],
  );

  useEffect(() => {
    const unsubMutation = on('grocery:mutation', handleMutation);
    const unsubUndone = on('grocery:undone', handleUndone);
    return () => {
      unsubMutation();
      unsubUndone();
    };
  }, [handleMutation, handleUndone]);

  const dismiss = useCallback(() => setToastState(null), []);

  if (!toastState) return null;

  // ── render ─────────────────────────────────────────────────────────────────
  if (toastState.kind === 'routed') {
    return (
      <SortedToast
        result={toastState.result}
        mode="sorted"
        onDismiss={dismiss}
      />
    );
  }

  if (toastState.kind === 'mutation') {
    const modeMap: Record<'removed' | 'moved' | 'checked', ToastMode> = {
      removed: 'removed',
      moved: 'moved',
      checked: 'checked',
    };
    return (
      <SortedToast
        result={NOOP_RESULT}
        mode={modeMap[toastState.mode]}
        itemName={toastState.itemName}
        slice={toastState.slice}
        itemCount={toastState.itemCount}
        onDismiss={dismiss}
      />
    );
  }

  // kind === 'undone'
  return (
    <SortedToast
      result={NOOP_RESULT}
      mode="undone"
      description={toastState.description}
      onDismiss={dismiss}
    />
  );
}
