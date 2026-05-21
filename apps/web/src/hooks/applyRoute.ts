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
import { dispatchAction, type DispatchLocale, type DispatchOptions, type GroceryPurchaseEvent } from '@ollie/orchestrator';
import { getAuthJwt } from '../lib/account-boot';

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
  dispatchAction(route, store, Date.now(), opts);
}

/**
 * Exported for consumers that wire the grocery checkOff handler directly
 * (e.g. useGroceryActions in grocery-v2).
 */
export { recordGroceryPurchase };
