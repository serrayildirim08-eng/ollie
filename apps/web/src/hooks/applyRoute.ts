/**
 * applyRoute — thin shim over the canonical brain-dump dispatch core.
 *
 * Görev 2 (2026-05-15): the routing + store-write logic used to be
 * duplicated here and in @ollie/orchestrator/braindump-dispatch.ts, and
 * the two copies had drifted (this file had finance sub-classification;
 * the orchestrator copy had research:row_written emit + dump handling).
 *
 * They are now ONE. `@ollie/orchestrator`'s `dispatchAction` is the
 * single canonical core — it carries BOTH the finance sub-slice
 * classification AND the research:row_written emit. This file is kept
 * only so existing callers (useApplyBrainDump + its tests) keep their
 * `applyRoute(route, store)` import unchanged; it just delegates.
 *
 * No top-level side-effects — the store is dependency-injected so this
 * stays testable without the browser adapter.
 */

import type { Action } from '@ollie/logic/dissection';
import type { Store } from '@ollie/store';
import {
  dispatchAction,
  type DispatchLocale,
  type DispatchOptions,
  type GroceryListContext,
  type GroceryPurchaseEvent,
  type GroceryMutationEntry,
  type GroceryMutationReverse,
} from '@ollie/orchestrator';
import { getAuthJwt } from '../lib/account-boot';
import { pushUndo } from '../lib/grocery-undo-stack';

/** Hard cap on items shipped in the worker prompt — matches LIST_CONTEXT_CAP. */
const GROCERY_CONTEXT_CAP = 50;

// ─── Grocery undo reverse applier ─────────────────────────────────────────────

type ShoppingItem = { id: string; name: string; canonical?: string | null; ts: number; checked: boolean };
type PantryItem = { id: string; name: string; canonical?: string | null; ts: number; boughtTs: number };

/**
 * Apply a GroceryMutationReverse to the store. Called inside the undo()
 * closure that applyRoute builds when onGroceryMutation fires.
 */
export function applyReverse(store: Store, reverse: GroceryMutationReverse): void {
  switch (reverse.kind) {
    case 'restore_to_items':
      store.update<ShoppingItem[]>('grocery', 'items', (cur) => [
        ...(cur ?? []),
        {
          id: reverse.item.id,
          name: reverse.item.name,
          canonical: reverse.item.canonical ?? undefined,
          ts: reverse.item.ts,
          checked: reverse.item.checked,
        },
      ]);
      break;
    case 'restore_to_pantry':
      store.update<PantryItem[]>('grocery', 'pantry', (cur) => [
        ...(cur ?? []),
        {
          id: reverse.item.id,
          name: reverse.item.name,
          canonical: reverse.item.canonical ?? undefined,
          ts: reverse.item.ts,
          boughtTs: reverse.item.boughtTs,
        },
      ]);
      break;
    case 'remove_from_items':
      store.update<ShoppingItem[]>('grocery', 'items', (cur) =>
        (cur ?? []).filter((it) => !reverse.ids.includes(it.id)),
      );
      break;
    case 'remove_from_pantry':
      store.update<PantryItem[]>('grocery', 'pantry', (cur) =>
        (cur ?? []).filter((it) => !reverse.ids.includes(it.id)),
      );
      break;
    case 'set_checked': {
      const updates = reverse.updates;
      store.update<ShoppingItem[]>('grocery', 'items', (cur) =>
        (cur ?? []).map((it) => {
          const update = updates.find((u) => u.id === it.id);
          return update ? { ...it, checked: update.checked } : it;
        }),
      );
      break;
    }
    case 'composite':
      for (const step of reverse.steps) {
        applyReverse(store, step);
      }
      break;
  }
}

/**
 * Capture the user's live shopping + pantry slices for the worker. The
 * worker uses these to disambiguate mutation commands ("remove pasta",
 * "got everything except eggs", "I finished the milk"). Capped at 50
 * entries per side to keep prompt tokens bounded — recency wins
 * (the freshest end of the list is what the user is talking about).
 */
interface StoredGroceryItem {
  name: string;
  canonical?: string | null;
}

function buildGroceryContext(store: Store): GroceryListContext {
  const shopping = store.get<StoredGroceryItem[]>('grocery', 'items', []);
  const pantry = store.get<StoredGroceryItem[]>('grocery', 'pantry', []);

  const tail = <T,>(arr: T[]): T[] =>
    arr.length <= GROCERY_CONTEXT_CAP ? arr : arr.slice(arr.length - GROCERY_CONTEXT_CAP);

  return {
    shoppingItems: tail(shopping).map((it) => ({
      name: it.name,
      canonical: it.canonical ?? null,
    })),
    pantryItems: tail(pantry).map((it) => ({
      name: it.name,
      canonical: it.canonical ?? null,
    })),
  };
}

/**
 * Resolve the ai-proxy worker URL from Vite env. Frontend-only: the
 * orchestrator package can't read import.meta.env, so this shim does it.
 * Falls back to the dispatch default when the var is absent.
 */
const AI_PROXY_URL =
  (import.meta as unknown as { env?: { VITE_AI_WORKER_URL?: string; VITE_AI_PROXY_URL?: string } })
    .env?.VITE_AI_WORKER_URL ??
  (import.meta as unknown as { env?: { VITE_AI_PROXY_URL?: string } }).env?.VITE_AI_PROXY_URL;

/**
 * Fire-and-forget POST to the ai-proxy worker's /grocery/purchase endpoint.
 * Survives page unload via `keepalive: true`. Never throws — telemetry sink.
 */
async function recordGroceryPurchase(ev: GroceryPurchaseEvent): Promise<void> {
  const baseUrl = AI_PROXY_URL;
  if (!baseUrl) return;
  const token = getAuthJwt();
  try {
    await fetch(`${baseUrl}/grocery/purchase`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(ev),
      keepalive: true,
    });
  } catch { /* fire-and-forget — telemetry sink */ }
}

/**
 * Apply a single routed Action to the store via the canonical dispatcher.
 *
 * @param route    the routed action produced by dissection.extract()
 * @param store    the app store (or a memory adapter in tests)
 * @param getLocale optional locale resolver — drives the locale tag on the
 *                  emitted research:row_written event. Defaults to 'en'.
 */
export function applyRoute(
  route: Action,
  store: Store,
  getLocale?: () => DispatchLocale,
): void {
  const opts: DispatchOptions = {};
  if (getLocale) opts.getLocale = getLocale;
  if (AI_PROXY_URL) opts.aiProxyBaseUrl = AI_PROXY_URL;
  const token = getAuthJwt();
  if (token) opts.authToken = token;
  opts.recordGroceryPurchase = (ev) => { void recordGroceryPurchase(ev); };
  // Mutation (2026-05-22): the dispatcher pulls live shopping + pantry
  // context synchronously at dispatch time. Only wire this for grocery
  // routes — other modules don't read it.
  if (route.module === 'grocery') {
    opts.getGroceryContext = () => buildGroceryContext(store);
    opts.onGroceryMutation = (entry: GroceryMutationEntry) => {
      pushUndo({
        ts: entry.ts,
        mode: entry.mode,
        description: entry.description,
        undo: () => applyReverse(store, entry.reverse),
      });
    };
  }
  dispatchAction(route, store, Date.now(), opts);
}

/**
 * Exported for consumers that wire the grocery checkOff handler directly
 * (e.g. useGroceryActions in grocery-v2).
 */
export { recordGroceryPurchase };
