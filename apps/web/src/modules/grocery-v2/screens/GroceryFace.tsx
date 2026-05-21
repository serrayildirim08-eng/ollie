/**
 * grocery-v2 · GroceryFace — the grocery submodule face (Level 2)
 *
 * Grocery is a 3-mode tool. The face carries the mode switch (shop ·
 * pantry · feed me) and renders one of three sub-views beneath it:
 *
 *   - shop   → the torn-note shopping list (grocery.html / grocery-cold.html)
 *   - pantry → the shelf-life-aware kitchen view (grocery-pantry.html)
 *   - feed   → the recipe matcher (grocery-recipes.html)
 *
 * The `add` / `patterns` / `notifications` leaves are pushed by AppRoot.
 *
 * Real data: every line comes from `selectors.ts` over the live `grocery.*`
 * slices via `useGrocerySlices`. Checking a row off, dropping it, and
 * adding missing ingredients write through `useGroceryActions` — the SAME
 * store the live `GroceryModule` reads + writes.
 */
import { useMemo } from 'react';
import { Screen, v2 } from '../../money-v2/v2';
import { useGrocerySlices } from '../useGrocerySlices';
import { useGroceryActions } from '../useGroceryActions';
import { ModeSwitch, type GroceryMode } from '../components/ModeSwitch';
import { ShopView } from './ShopView';
import { PantryView } from './PantryView';
import { FeedMeView } from './FeedMeView';
import { useReplenishment } from '../../../hooks/useReplenishment';
import { getAuthUserId } from '../../../lib/account-boot';
import { recordGroceryPurchase } from '../../../hooks/applyRoute';
import type { GroceryPurchaseEvent } from '@ollie/orchestrator';

export interface GroceryFaceProps {
  now: number;
  mode: GroceryMode;
  onMode: (mode: GroceryMode) => void;
  onAdd: () => void;
  onPatterns: () => void;
  onNotifications: () => void;
  onSafe: () => void;
}

export function GroceryFace({
  now,
  mode,
  onMode,
  onAdd,
  onPatterns,
  onNotifications,
  onSafe,
}: GroceryFaceProps) {
  const slices = useGrocerySlices();
  // Pull per-user replenishment estimates. `null` userId (signed-out)
  // returns an empty Map — the badge sites then fall back to the static
  // shelf-life floor per item.
  const userId = getAuthUserId();
  const { estimates, refresh } = useReplenishment(userId);

  // checkOff → fire-and-forget purchase write, then refresh the estimates
  // so the next render reflects the freshly-extended cadence. This is the
  // backend-junior-2 coordination point: the same `recordGroceryPurchase`
  // shim that `applyRoute` uses for AI-routed dumps fires here for the
  // manual checkbox flip, and the Map re-pulls.
  const actions = useGroceryActions(now, {
    recordGroceryPurchase: (ev: GroceryPurchaseEvent) => {
      void recordGroceryPurchase(ev).finally(() => {
        refresh();
      });
    },
  });
  // a stable ref so child views can read fresh slices without prop churn
  const groceryActions = useMemo(() => actions, [actions]);

  return (
    <Screen label="grocery" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      <ModeSwitch mode={mode} onChange={onMode} />

      {mode === 'shop' && (
        <ShopView
          now={now}
          slices={slices}
          actions={groceryActions}
          estimates={estimates}
          onAdd={onAdd}
          onPatterns={onPatterns}
        />
      )}
      {mode === 'pantry' && (
        <PantryView now={now} slices={slices} estimates={estimates} />
      )}
      {mode === 'feed' && (
        <FeedMeView now={now} slices={slices} actions={groceryActions} />
      )}

      {/* a quiet way to preview the notification voice */}
      <button
        type="button"
        onClick={onNotifications}
        style={{
          marginTop: 28,
          alignSelf: 'center',
          background: 'transparent',
          border: 'none',
          fontSize: 12,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        what grocery sends &mdash; and what it never does
      </button>
    </Screen>
  );
}
