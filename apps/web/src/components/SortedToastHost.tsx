/**
 * SortedToastHost — root-level driver for the grocery routing popup.
 *
 * Mount exactly once near the app root (alongside <ChipFlyHost />,
 * <ToastHost />). Subscribes to `grocery:routed` via `useGroceryRouting`
 * and renders a single <SortedToast> at a time. The toast auto-dismisses
 * via its internal ttl; this host also resets its own state when the
 * hook auto-resets so a back-to-back dump always re-mounts a fresh toast
 * (not just re-fires the auto-dismiss timer).
 *
 * Why a separate host (not just inline in BrainDumpInput):
 *   The popup is global — it must surface even if the user has scrolled
 *   away from the dump bar or navigated to a different module. The host
 *   sits above the route tree so it persists across route changes.
 */

import { useEffect, useState } from 'react';
import { SortedToast } from './SortedToast';
import { useGroceryRouting, type GroceryRoutingResult } from '../hooks/useGroceryRouting';

export function SortedToastHost() {
  const { status, result } = useGroceryRouting({ autoResetMs: 6000 });
  const [pinned, setPinned] = useState<GroceryRoutingResult | null>(null);

  useEffect(() => {
    if (
      result &&
      (status === 'routed' || status === 'fallback' || status === 'error')
    ) {
      setPinned(result);
    }
    if (status === 'idle' && pinned) {
      setPinned(null);
    }
    // `pinned` is intentionally omitted from deps — we only want to
    // re-pin when status flips, not when the local state changes.
  }, [status, result]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pinned) return null;

  return <SortedToast result={pinned} onDismiss={() => setPinned(null)} />;
}
