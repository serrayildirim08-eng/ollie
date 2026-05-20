/**
 * aiRouteBridge
 *
 * Routes a brain-dump through the hybrid AI router and falls back to the
 * offline keyword router when the router is unreachable.
 *
 * ─── how routing works now ──────────────────────────────────────────────────
 * The hybrid Voyage + Gemini router lives entirely in the ai-proxy Worker's
 * `/route` endpoint (see docs/router/OLLIE_AI_ROUTER_HYBRID.md). It does the
 * two-stage routing — Voyage embedding fast path + Gemini 2.5 Flash slow
 * path — and returns a unified `{calls, meta}` shape. The client just calls
 * it and dispatches the calls.
 *
 * This SUPERSEDES the earlier interim routing (on-device FoundationModels /
 * NLEmbedding tiers + the Haiku `/route` + rule-route.ts). Those tiers were
 * a stopgap; the worker hybrid router replaces them.
 *
 * ─── tiers ──────────────────────────────────────────────────────────────────
 *   1. HYBRID router — the worker `/route` endpoint (Voyage + Gemini).
 *      Consent-gated (the dump text leaves the device). Returns `{calls}`.
 *   2. ON-DEVICE router — Apple Intelligence FoundationModels via the
 *      `OllieAI` Capacitor plugin (`lib/ollie-ai.ts`). Fully private — the
 *      dump text never leaves the device, so it is NOT consent-gated. It
 *      only runs when the hybrid router did not (no consent / offline /
 *      cloud down) and naturally no-ops on web / desktop / old iOS.
 *   3. KEYWORD router (@ollie/logic/dissection `extract`) — the permanent
 *      OFFLINE fallback. Runs when neither AI tier produced a result. It is
 *      never removed — it is the floor everything degrades to.
 *
 * Contract:
 *   - Question text (AnswerRoute) is detected by the keyword router and
 *     returned as-is — never sent to any AI.
 *   - If no AI tier produces actions, the keyword actions ship verbatim.
 */

import type { Action, ModuleName, Route } from '@ollie/logic/dissection';
import { extract } from '@ollie/logic/dissection';
import { aiRoute, type RouterMeta } from '../lib/aiRoute';
import { routerCallsToActions, MODULE_TOOL } from '../lib/routerCallToActions';
import { aiRoute as aiRouteOnDevice, MODULE_EXEMPLARS } from '../lib/ollie-ai';
import * as events from '@ollie/events';

/** Which routing tier produced the result — surfaced for telemetry / debug. */
export type RouteTier =
  | 'keyword'
  | 'hybrid-fast'
  | 'hybrid-slow'
  | 'hybrid-queued'
  | 'on-device';

/**
 * Module keys the on-device router classifies into — the canonical routable
 * module list, sourced from `MODULE_EXEMPLARS` in lib/ollie-ai.ts (the same
 * keys the NLEmbedding tier uses). The native plugin appends its own
 * "notebook" no-fit fallback, so it is intentionally absent here.
 */
const ON_DEVICE_MODULES: string[] = Object.keys(MODULE_EXEMPLARS);

/** Minimum on-device confidence to accept a classification (below → floor). */
const ON_DEVICE_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Map an on-device module classification onto the store's ModuleName.
 * The native plugin's no-fit fallback is "notebook" — the `dump` module in
 * store terms. Unknown keys also funnel to `dump` so a stray label never
 * crashes the tier; the caller still validates via MODULE_TOOL below.
 */
function onDeviceModuleToModuleName(module: string): ModuleName {
  if (module === 'notebook') return 'dump';
  return (Object.prototype.hasOwnProperty.call(MODULE_TOOL, module)
    ? module
    : 'dump') as ModuleName;
}

export interface AiRouteOutcome {
  /** Actions to dispatch — one chip per action downstream. */
  actions: Action[];
  /** True when the hybrid router (not the keyword fallback) produced the result. */
  usedAi: boolean;
  /** Which tier the final decision came from. */
  tier: RouteTier;
  /** Router metadata (path, latency, confidence) — telemetry only. */
  meta: RouterMeta | null;
}

/** Map the hybrid router's `meta.path` onto a RouteTier label. */
function tierFromPath(path: RouterMeta['path']): RouteTier {
  if (path === 'fast') return 'hybrid-fast';
  if (path === 'queued') return 'hybrid-queued';
  return 'hybrid-slow';
}

/**
 * Route a brain-dump.
 *
 * @param text  raw user input
 * @returns the keyword `Route` for questions, otherwise an AiRouteOutcome.
 */
export async function aiRouteBrainDump(text: string): Promise<Route | AiRouteOutcome> {
  // ── Keyword router — runs first ONLY to detect questions (AnswerRoute).
  // Questions are never AI-routed; hand them back untouched. The keyword
  // action list it also produces is kept as the offline fallback below.
  const keyword = extract(text);
  if (!Array.isArray(keyword)) return keyword;

  // ── Tier 1 — hybrid worker router (Voyage + Gemini) ─────────────────────
  // Consent-gated inside aiRoute(); returns null when skipped/failed.
  const result = await aiRoute(text);

  if (result && result.calls.length > 0) {
    const actions = routerCallsToActions(result.calls);
    if (actions.length > 0) {
      const tier = tierFromPath(result.meta.path);

      // DEV-only debug toast — shows which path fired. Harmless in prod
      // (events.emit is a no-op when nothing listens) but kept dev-gated.
      if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
        try {
          events.emit('void:toast', {
            message: `route → ${actions[0].module} · ${tier}`,
            module: 'debug',
          });
        } catch {
          /* noop */
        }
      }

      return { actions, usedAi: true, tier, meta: result.meta };
    }
  }

  // ── Tier 2 — on-device router (Apple Intelligence FoundationModels) ─────
  // Runs ONLY when the hybrid router produced nothing. Fully private — the
  // dump text never leaves the device, so this is NOT consent-gated. On
  // web / desktop / old iOS aiRouteOnDevice() returns null (graceful
  // degradation lives in lib/ollie-ai.ts) → fall through to the floor.
  //
  // The on-device router is MULTI-ROUTE: it splits the dump into distinct
  // thoughts and returns one `{module,text,confidence}` item per thought.
  // We map EACH item with confidence >= the threshold onto a RouterCall —
  // carrying that item's OWN split-out text (not the whole dump) — and feed
  // all the calls through the existing call→action adapter, so the tier
  // never invents a new shape. Items below the threshold still route, but to
  // the notebook (`dump`) module, same as the "notebook" no-fit fallback.
  //
  // The try/catch is belt-and-braces: ollie-ai.ts already never throws, but
  // a throw here must still degrade to the keyword floor, never propagate.
  try {
    const onDevice = await aiRouteOnDevice(text, ON_DEVICE_MODULES);
    if (onDevice && onDevice.routes.length > 0) {
      const calls = onDevice.routes.map((item) => {
        const module =
          item.confidence >= ON_DEVICE_CONFIDENCE_THRESHOLD
            ? onDeviceModuleToModuleName(item.module)
            : 'dump';
        // `raw` carries the item's own split-out thought — pickData()
        // reads it as data — NOT the whole dump blob.
        return { tool: MODULE_TOOL[module], input: { raw: item.text } };
      });
      const actions = routerCallsToActions(calls);
      if (actions.length > 0) {
        if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
          try {
            events.emit('void:toast', {
              message: `route → ${actions.length} item${
                actions.length === 1 ? '' : 's'
              } · on-device`,
              module: 'debug',
            });
          } catch {
            /* noop */
          }
        }
        return { actions, usedAi: true, tier: 'on-device', meta: null };
      }
    }
  } catch {
    /* on-device tier failed — fall through to the keyword floor */
  }

  // ── Tier 3 — offline keyword fallback ──────────────────────────────────
  // Neither AI tier produced actions (no consent / offline / cloud down /
  // on-device unavailable or low-confidence) → ship the keyword actions
  // verbatim. Never blocks the user.
  return { actions: keyword, usedAi: false, tier: 'keyword', meta: null };
}
