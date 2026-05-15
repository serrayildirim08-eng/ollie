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
import { dispatchAction, type DispatchLocale } from '@ollie/orchestrator';

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
  dispatchAction(route, store, Date.now(), getLocale ? { getLocale } : {});
}
