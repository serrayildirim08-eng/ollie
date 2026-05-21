/**
 * @ollie/orchestrator · braindump-dispatch
 *
 * THE single canonical brain-dump routing core (Görev 2 · 2026-05-15).
 *
 * Wraps dissection.extract() + writes each routed Action into the right
 * store slice. Lives here (not in @ollie/logic) so the logic package
 * stays pure (no store dep) but the orchestrator package already depends
 * on both @ollie/store and @ollie/logic.
 *
 * ─── Consolidation (Görev 2) ────────────────────────────────────────────────
 * Until 2026-05-15 there were TWO routing implementations that had drifted:
 *   - apps/web/src/hooks/applyRoute.ts — the UI path, with finance
 *     sub-classification (records/bills/subscriptions/goals/adhd_tax/
 *     transactions) but NO research:row_written emit.
 *   - this file — the research-pipeline path, with research:row_written
 *     emit + dump handling but NO finance sub-classification.
 * They are now ONE. `dispatchAction` below is the union:
 *   - finance sub-slice classification (was UI-only) — ported here;
 *   - research:row_written emit (was research-only) — kept here;
 *   - dump / astrology→dump / work.meetings handling — kept here.
 * `applyRoute.ts` is now a thin shim that delegates to `dispatchAction`.
 *
 * Audit-task 1 (2026-05-14): work + goals routes populate work.tasks /
 * work.meetings / goals.items[] with proper schema so the W-* / G-*
 * pattern detectors see the data.
 *
 * Sprint B'' (2026-05-14): each scrubbable row write emits
 * `research:row_written` so the opt-in research orchestrator can pick it
 * up, scrub, and ship to /label. Emit is unconditional; consent gating
 * lives in research.ts. Table mapping:
 *   body                                  → body_records
 *   work                                  → work_records
 *   astrology + explicit dump module      → brain_dump_log
 *   default fallthrough (admin/sleep/habits/pets/grocery/…)
 *                                         → home_records
 * cycle + goals have structured slices without scrubbable free text so
 * they're NOT emitted. finance is NOT emitted here either — the finance
 * orchestrator owns the finance_records corpus emit path.
 */

import type { Store } from '@ollie/store';
import * as events from '@ollie/events';
import { extract } from '@ollie/logic/dissection';
import type { Action, Route } from '@ollie/logic/dissection';
import { parseFinanceDump } from '@ollie/logic/finance';

// ─── Grocery AI routing (T2 2026-05-21) ──────────────────────────────────────
//
// Locked shape from spec (memory MODULE_AGNOSTIC_AI.md + T2 task):
//   source: 'cache_hit' | 'gemini_miss' | 'fallback_keyword'
//
// `grocery-routing.ts` in @ollie/events not yet shipped by frontend-senior;
// type defined here to keep orchestrator self-contained. Align when it ships.

export type GroceryRoutingSource = 'cache_hit' | 'gemini_miss' | 'fallback_keyword';

/**
 * Mutation action — mirror of the worker's GroceryAction union. Items
 * without an `action` field are treated as 'add' for backward compat
 * with cached Gemini classifications written before 2026-05-22.
 */
export type GroceryRoutedAction = 'add' | 'remove' | 'check' | 'move_to_pantry';

export interface GroceryRoutedItem {
  name: string;
  canonical: string | null;
  category: string;
  intent: string;
  target: 'pantry' | 'shopping';
  /** Mutation to apply. Absent = 'add' (backward compat). */
  action?: GroceryRoutedAction;
  qty?: number;
  unit?: string;
  shelfLifeDays?: number;
  isRecipeExpansion?: boolean;
}

/**
 * List context passed to the worker for mutation disambiguation. The
 * dispatcher pulls it from `opts.getGroceryContext` synchronously so the
 * caller can capture the live store state at dispatch time (not at async
 * resolution time, which would race with the keyword placeholder write).
 */
export interface GroceryListContext {
  shoppingItems: Array<{ name: string; canonical?: string | null }>;
  pantryItems: Array<{ name: string; canonical?: string | null }>;
}

/**
 * Mutation-verb regex covering EN + TR + ES. When this hits, the
 * synchronous keyword placeholder write is suppressed and dispatch waits
 * for the AI result. Verbs are tuned to be specific — "got" alone is NOT
 * here (too many false positives for pantry log "got milk"). The
 * mutation-disambiguating phrase needs more than the bare verb: "got
 * everything except", "got all but", etc.
 */
const MUTATION_RE =
  /\b(remove|delete|scratch|throw out|threw out|finished|ran out|ran out of|used up|got everything except|got all but|all except|no need for|drop\s+\w+\s+from|take\s+\w+\s+off|listeden çıkar|çıkar|sil|kaldır|bozuldu|bitti(?: ?artık)?|quita|elimina|borra|saca|menos|excepto|se acabó|se nos acabó|se echó a perder)\b/i;

/**
 * Match a store item against an AI-returned mutation item. Canonical
 * match wins when both sides have one; otherwise fall back to
 * case-insensitive substring match in either direction. Returns true
 * when this store item should be the mutation's target.
 *
 * NOTE: this is intentionally permissive — Gemini sometimes returns the
 * lemma ("egg") for a stored line that says the plural ("eggs"), so
 * we accept substring matches in either direction.
 */
export function matchItem(
  storeItem: { name: string; canonical?: string | null },
  aiItem: { name: string; canonical: string | null },
): boolean {
  if (aiItem.canonical && storeItem.canonical && aiItem.canonical === storeItem.canonical) {
    return true;
  }
  const a = (storeItem.name ?? '').toLowerCase().trim();
  const b = (aiItem.name ?? '').toLowerCase().trim();
  if (a.length === 0 || b.length === 0) return false;
  return a.includes(b) || b.includes(a);
}

export interface GroceryRoutingResult {
  dumpId: string;
  source: GroceryRoutingSource;
  latencyMs: number;
  applied: boolean;
  language: string;
  recipeSourceLabel?: string | null;
  items: GroceryRoutedItem[];
}

/** Base URL for the ai-proxy worker. Overrideable for tests + frontend via DispatchOptions. */
let _aiProxyBaseUrl = 'https://ollie-ai-proxy.ollieapp.workers.dev';

/** Override the ai-proxy base URL (for tests only). */
export function _setAiProxyBaseUrl(url: string): void {
  _aiProxyBaseUrl = url;
}

/** Timeout for /route/grocery call. Falls back to keyword logic on timeout.
 *  Voyage embed (~500ms) + Gemini classify (cold start ~3-5s) + Supabase RPC
 *  (~200ms) stack to ~5-6s on a miss; cache hits return <300ms. 10s gives the
 *  first-touch Gemini call headroom — subsequent same/similar phrases hit the
 *  pgvector cache and are effectively instant. */
const ROUTE_TIMEOUT_MS = 10000;

/**
 * Call /route/grocery on the ai-proxy worker. Returns null on any error or
 * timeout — caller falls through to keyword fallback.
 */
async function callGroceryRoute(
  text: string,
  dumpId: string,
  authToken?: string,
  context?: GroceryListContext,
): Promise<GroceryRoutingResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authToken) headers['authorization'] = `Bearer ${authToken}`;

    const requestBody: Record<string, unknown> = { text, dumpId };
    if (context) requestBody.context = context;

    const res = await fetch(`${_aiProxyBaseUrl}/route/grocery`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      source: 'cache_hit' | 'gemini_miss';
      latencyMs: number;
      language: string;
      classification?: {
        items?: GroceryRoutedItem[];
        intent?: string;
        language?: string;
        recipeSourceLabel?: string | null;
      };
    };

    const classification = data.classification ?? {};
    const items: GroceryRoutedItem[] = Array.isArray(classification.items)
      ? classification.items
      : [];

    return {
      dumpId,
      source: data.source,
      latencyMs: data.latencyMs ?? 0,
      applied: items.length > 0,
      language: data.language ?? classification.language ?? 'en',
      recipeSourceLabel: classification.recipeSourceLabel ?? null,
      items,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Locale token for the scrubber. Mirrors @ollie/pii-scrub `Locale`. We
 * re-type here instead of importing so this package doesn't gain a
 * pii-scrub dependency just for one type token.
 */
export type DispatchLocale = 'en' | 'es' | 'tr';

/**
 * A single grocery purchase event — written when an item lands in the pantry
 * slice via any of the three trigger paths (pantry dump, AI routing, shop
 * checkbox). Forwarded fire-and-forget to the worker's POST /grocery/purchase
 * endpoint.
 *
 * Contract (for backend-senior's /grocery/purchase worker endpoint):
 *   canonical: string        — AI-resolved canonical or raw name if unknown
 *   qty?:      number        — optional quantity provided by the user
 *   unit?:     string        — optional unit (e.g. "l", "bottle", "count")
 *   source:    'pantry_add' | 'shop_checked' | 'ai_inferred'
 *   ts:        number        — Unix epoch ms of the purchase event
 */
export interface GroceryPurchaseEvent {
  canonical: string;
  qty?: number;
  unit?: string;
  source: 'pantry_add' | 'shop_checked' | 'ai_inferred';
  ts: number;
}

export interface DispatchOptions {
  /** Resolver for the active locale at emit time. Defaults to 'en'. */
  getLocale?: () => DispatchLocale;
  /**
   * Supabase/Clerk JWT to forward to /route/:module. Required once T0 ships.
   * When absent, /route endpoint still responds (T0_JWT_ENFORCED not yet set).
   */
  authToken?: string;
  /**
   * Override the AI proxy base URL (tests + dev). Defaults to production worker.
   */
  aiProxyBaseUrl?: string;
  /**
   * Optional sink for grocery purchase events. Called fire-and-forget when a
   * grocery item lands in the pantry slice (kind='log', kind='add' AI-routed
   * to pantry, or shop checkbox flip handled by the caller). The callback
   * forwards to the worker's POST /grocery/purchase endpoint. Tests inject a
   * memory recorder.
   */
  recordGroceryPurchase?: (event: GroceryPurchaseEvent) => void;
  /**
   * Provides the live shopping + pantry lists at dispatch time so the
   * worker can disambiguate mutation commands ("remove pasta",
   * "got everything except eggs", "I finished the milk"). Synchronous —
   * captured at the moment of dispatch, NOT when the async fetch resolves,
   * so the AI sees the same state the user typed against. Optional; absent
   * = no context block in the prompt (mutation still works via fuzzy match
   * on the applier side, just less reliable).
   */
  getGroceryContext?: () => GroceryListContext;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ─── finance sub-slice classification (ported from applyRoute.ts) ─────────────
//
// Sub-slice keywords not covered by parseFinanceDump (subscription / bill /
// savings). parseFinanceDump already handles is_adhd_tax and direction in/out.

const SUBSCRIPTION_RE =
  /\b(subscription|subscri(?:be|bed)|monthly\s+plan|annual\s+plan|canva|spotify|netflix|apple\s+one|notion|figma|slack)\b/i;
const BILL_RE =
  /\b(rent|electric(?:ity)?|gas\s+bill|internet\s+bill|phone\s+bill|every\s+(?:month|week|year|quarter)|monthly|weekly|yearly|quarterly|recurring)\b/i;
const SAVINGS_RE =
  /\b(save|saving|savings|put\s+aside|set\s+aside|goal|toward|for\s+(?:a\s+)?\w+\s+(?:fund|goal))\b/i;

export type FinanceSlice =
  | 'records'
  | 'bills'
  | 'subscriptions'
  | 'goals'
  | 'adhd_tax'
  | 'transactions';

/** Classify a finance text into a store sub-slice key. */
function classifyFinanceSlice(text: string, now: number): FinanceSlice {
  const parsed = parseFinanceDump(text, now);
  const rec = parsed.record;

  if (rec?.is_adhd_tax) return 'adhd_tax';

  const lower = text.toLowerCase();

  if (SAVINGS_RE.test(lower)) return 'goals';

  // Check subscription before bill — "canva monthly $20" is a subscription.
  if (SUBSCRIPTION_RE.test(lower)) return 'subscriptions';

  if (BILL_RE.test(lower)) return 'bills';

  // One-off income or expense.
  if (rec && (rec.direction === 'in' || rec.direction === 'out')) return 'records';

  return 'transactions';
}

/**
 * Emit `research:row_written` for a scrubbable upstream module write.
 * Wrapped so a single broken downstream subscriber never blocks the
 * dispatcher's row-write fast path.
 */
function emitResearchRow(
  table: 'brain_dump_log' | 'body_records' | 'work_records' | 'home_records',
  rowId: string,
  text: string,
  ts: number,
  locale: DispatchLocale,
): void {
  if (!text || text.length === 0) return;
  try {
    events.emit('research:row_written', {
      row_id: rowId,
      table,
      text,
      locale,
      ts,
    });
  } catch { /* never throw from the dispatcher */ }
}

/**
 * Apply a batch of AI-classified mutation items to the grocery slices.
 *
 * Each item carries an `action` (default 'add') that drives which slice
 * is mutated and how:
 *   - 'add': append to shopping or pantry per target.
 *   - 'remove': drop one matching item from the target slice.
 *   - 'check': mark a matching shopping item as bought (checked=true).
 *   - 'move_to_pantry': remove from shopping AND append to pantry; also
 *     emits a purchase-history event (source='ai_inferred').
 *
 * Match semantics — see `matchItem` above. Canonical preferred; substring
 * either-direction fallback. No-match for any non-'add' action is a
 * silent no-op (we'd rather lose a mutation than mangle the wrong row).
 */
export function applyGroceryMutations(
  items: GroceryRoutedItem[],
  store: Store,
  ts: number,
  opts: DispatchOptions = {},
): void {
  for (const aiItem of items) {
    const act: GroceryRoutedAction = aiItem.action ?? 'add';

    switch (act) {
      case 'add': {
        const newRowId = newId();
        if (aiItem.target === 'pantry') {
          store.update<Array<{ id: string; name: string; canonical?: string; ts: number; boughtTs: number }>>(
            'grocery',
            'pantry',
            (cur) => [...(cur ?? []), {
              id: newRowId,
              name: aiItem.name,
              canonical: aiItem.canonical ?? undefined,
              ts,
              boughtTs: ts,
            }],
          );
          try {
            opts.recordGroceryPurchase?.({
              canonical: aiItem.canonical ?? aiItem.name,
              qty: aiItem.qty,
              unit: aiItem.unit,
              source: 'ai_inferred',
              ts,
            });
          } catch { /* fire-and-forget */ }
        } else {
          store.update<Array<{ id: string; name: string; canonical?: string; ts: number; checked: boolean }>>(
            'grocery',
            'items',
            (cur) => [...(cur ?? []), {
              id: newRowId,
              name: aiItem.name,
              canonical: aiItem.canonical ?? undefined,
              ts,
              checked: false,
            }],
          );
        }
        break;
      }

      case 'remove': {
        if (aiItem.target === 'pantry') {
          store.update<Array<{ id: string; name: string; canonical?: string | null; ts: number; boughtTs?: number }>>(
            'grocery',
            'pantry',
            (cur) => {
              const arr = cur ?? [];
              // Remove the FIRST matching item. Silent no-op if no match.
              const idx = arr.findIndex((it) => matchItem(it, aiItem));
              if (idx < 0) return arr;
              return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
            },
          );
        } else {
          store.update<Array<{ id: string; name: string; canonical?: string | null; ts: number; checked: boolean }>>(
            'grocery',
            'items',
            (cur) => {
              const arr = cur ?? [];
              const idx = arr.findIndex((it) => matchItem(it, aiItem));
              if (idx < 0) return arr;
              return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
            },
          );
        }
        break;
      }

      case 'check': {
        store.update<Array<{ id: string; name: string; canonical?: string | null; ts: number; checked: boolean }>>(
          'grocery',
          'items',
          (cur) => {
            const arr = cur ?? [];
            // Mark the first match as checked. Any subsequent identical
            // names are intentionally left alone — the AI would have
            // emitted N items for N entries (see the "got everything
            // except" few-shot pattern).
            const idx = arr.findIndex((it) => !it.checked && matchItem(it, aiItem));
            if (idx < 0) return arr;
            return arr.map((it, i) => (i === idx ? { ...it, checked: true } : it));
          },
        );
        // Treat checked items as purchases for the replenishment signal.
        try {
          opts.recordGroceryPurchase?.({
            canonical: aiItem.canonical ?? aiItem.name,
            qty: aiItem.qty,
            unit: aiItem.unit,
            source: 'shop_checked',
            ts,
          });
        } catch { /* fire-and-forget */ }
        break;
      }

      case 'move_to_pantry': {
        // Remove from shopping (silent on no-match — user might be
        // confirming possession of something never on the list).
        store.update<Array<{ id: string; name: string; canonical?: string | null; ts: number; checked: boolean }>>(
          'grocery',
          'items',
          (cur) => {
            const arr = cur ?? [];
            const idx = arr.findIndex((it) => matchItem(it, aiItem));
            if (idx < 0) return arr;
            return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
          },
        );
        // Add to pantry (always — "scratch X, got some" is a possession
        // claim even when X wasn't on the shopping list).
        const pantryRowId = newId();
        store.update<Array<{ id: string; name: string; canonical?: string; ts: number; boughtTs: number }>>(
          'grocery',
          'pantry',
          (cur) => [...(cur ?? []), {
            id: pantryRowId,
            name: aiItem.name,
            canonical: aiItem.canonical ?? undefined,
            ts,
            boughtTs: ts,
          }],
        );
        try {
          opts.recordGroceryPurchase?.({
            canonical: aiItem.canonical ?? aiItem.name,
            qty: aiItem.qty,
            unit: aiItem.unit,
            source: 'ai_inferred',
            ts,
          });
        } catch { /* fire-and-forget */ }
        break;
      }
    }
  }
}

export interface RouteBrainDumpResult {
  isAnswer: boolean;
  actions: Action[];
  modulesHit: string[];
}

/**
 * routeBrainDump — extract + apply.
 *
 * Question text → no writes, isAnswer: true.
 * Empty list → no-op.
 *
 * @param text   raw user input
 * @param store  app store (apps/web or memory adapter in tests)
 * @param now    injected clock for tests; defaults to Date.now()
 * @param opts   dispatch options (e.g. getLocale resolver)
 */
export function routeBrainDump(
  text: string,
  store: Store,
  now: number = Date.now(),
  opts: DispatchOptions = {},
): RouteBrainDumpResult {
  const route: Route = extract(text);

  if (!Array.isArray(route)) {
    return { isAnswer: true, actions: [], modulesHit: [] };
  }

  const modulesHit = new Set<string>();
  for (const action of route) {
    modulesHit.add(action.module);
    dispatchAction(action, store, now, opts);
  }

  return {
    isAnswer: false,
    actions: route,
    modulesHit: [...modulesHit],
  };
}

/** Write a single routed Action to the appropriate store slice. */
export function dispatchAction(
  action: Action,
  store: Store,
  now: number = Date.now(),
  opts: DispatchOptions = {},
): void {
  const { module, action: kind, data } = action;
  const ts = now;
  const getLocale = opts.getLocale ?? ((): DispatchLocale => 'en');

  // ── grocery ──────────────────────────────────────────────────────────
  // Sprint B'' (2026-05-14): grocery rolls up into the home_records
  // corpus table server-side; emit accordingly.
  //
  // T2 (2026-05-21): async AI routing via /route/grocery.
  //   - Emit `grocery:routing:pending` immediately (instant UI feedback).
  //   - Call ai-proxy /route/grocery async.
  //   - On success: emit `grocery:routed` with AI result + source=cache/gemini.
  //   - On failure/timeout: keyword fallback (original behaviour below),
  //     source=fallback.
  //
  // Mutation (2026-05-22): when the input contains a mutation verb
  // (remove / scratch / threw out / finished / "got everything except"
  // and TR/ES equivalents) the synchronous keyword placeholder write is
  // SUPPRESSED — we cannot write "remove pasta" to shopping as a regular
  // line because that's exactly what the user wants undone. We still
  // emit `grocery:routing:pending` so the UI shows the pending state,
  // then wait for the AI to come back with action='remove' / 'check' /
  // 'move_to_pantry' and apply the mutation against the live store.
  if (module === 'grocery' && kind === 'add') {
    const isMutation = MUTATION_RE.test(data);
    const id = newId();

    // Default path: place the placeholder in shopping immediately so the
    // UI has something to render. Mutation path: skip the placeholder —
    // we'll wait for the AI result to find and operate on the EXISTING
    // matching items. If AI fails the user sees a no-op and the input
    // line is dropped (we'd rather drop than incorrectly add "remove
    // pasta" to the shopping list).
    if (!isMutation) {
      store.update<Array<{ id: string; name: string; ts: number; checked: boolean }>>(
        'grocery',
        'items',
        (cur) => [...(cur ?? []), { id, name: data, ts, checked: false }],
      );
      emitResearchRow('home_records', id, data, ts, getLocale());
    }

    // Async AI routing — fire-and-forget from the synchronous dispatch path.
    // Override base URL from opts if set (used by tests + dev).
    if (opts.aiProxyBaseUrl) _setAiProxyBaseUrl(opts.aiProxyBaseUrl);
    try {
      events.emit('grocery:routing:pending', {
        idempotency_key: id,
        raw: data,
        ts,
      });
    } catch { /* non-fatal */ }

    // Capture context SYNCHRONOUSLY at dispatch time — not inside the
    // async callback. The user's live list state at the moment they
    // typed is what disambiguates "remove pasta" / "I finished the
    // milk"; if we waited until the AI fetch resolved, a concurrent
    // edit could shift the list out from under us.
    const context = opts.getGroceryContext?.();

    void (async () => {
      const result = await callGroceryRoute(data, id, opts.authToken, context);
      const now2 = Date.now();
      if (result && result.items.length > 0) {
        if (isMutation) {
          // Mutation path — apply action-aware logic against the live
          // store. No placeholder to clean up (we suppressed it above).
          applyGroceryMutations(result.items, store, ts, opts);
        } else {
          // Original "add" path — clean up the placeholder we wrote
          // synchronously and re-distribute AI items into the right
          // slice (shopping vs pantry).
          store.update<Array<{ id: string; name: string; canonical?: string; ts: number; checked: boolean }>>(
            'grocery',
            'items',
            (cur) => (cur ?? []).filter((it) => it.id !== id),
          );
          for (const aiItem of result.items) {
            const aiId = newId();
            if (aiItem.target === 'pantry') {
              store.update<Array<{ id: string; name: string; canonical?: string; ts: number; boughtTs: number }>>(
                'grocery',
                'pantry',
                (cur) => [...(cur ?? []), {
                  id: aiId,
                  name: aiItem.name,
                  canonical: aiItem.canonical ?? undefined,
                  ts,
                  boughtTs: ts,
                }],
              );
              // Purchase history — use AI-resolved canonical when available.
              try {
                opts.recordGroceryPurchase?.({
                  canonical: aiItem.canonical ?? aiItem.name,
                  qty: aiItem.qty,
                  unit: aiItem.unit,
                  source: 'ai_inferred',
                  ts,
                });
              } catch { /* fire-and-forget */ }
            } else {
              store.update<Array<{ id: string; name: string; canonical?: string; ts: number; checked: boolean }>>(
                'grocery',
                'items',
                (cur) => [...(cur ?? []), {
                  id: aiId,
                  name: aiItem.name,
                  canonical: aiItem.canonical ?? undefined,
                  ts,
                  checked: false,
                }],
              );
            }
          }
        }
        try {
          events.emit('grocery:routed', {
            idempotency_key: id,
            raw: data,
            items: result.items.map((it) => ({
              name: it.name,
              target: it.target,
              recipe_parent: it.isRecipeExpansion ? (result.recipeSourceLabel ?? undefined) : undefined,
            })),
            source: result.source === 'cache_hit' ? 'cache' : 'gemini',
            latency_ms: result.latencyMs,
            ts: now2,
          });
        } catch { /* non-fatal */ }
      } else {
        // Fallback.
        //  - non-mutation: keyword placeholder is already in shopping; emit
        //    fallback so the toast shows "offline sort".
        //  - mutation: AI failed AND we suppressed the placeholder. There is
        //    no safe local fallback (we'd need a fuzzy keyword matcher
        //    against the live store, which is exactly the AI's job). Emit
        //    an empty fallback so the UI knows nothing happened.
        try {
          events.emit('grocery:routed', {
            idempotency_key: id,
            raw: data,
            items: isMutation ? [] : [{ name: data, target: 'shopping' }],
            source: 'fallback',
            latency_ms: Date.now() - ts,
            ts: now2,
          });
        } catch { /* non-fatal */ }
      }
    })();

    return;
  }
  if (module === 'grocery' && kind === 'log') {
    const id = newId();
    store.update<Array<{ id: string; name: string; ts: number; boughtTs: number }>>(
      'grocery',
      'pantry',
      (cur) => [...(cur ?? []), { id, name: data, ts, boughtTs: ts }],
    );
    emitResearchRow('home_records', id, data, ts, getLocale());

    // Purchase history — raw name (no AI on pantry_add path, worker normalises).
    try {
      opts.recordGroceryPurchase?.({ canonical: data, source: 'pantry_add', ts });
    } catch { /* fire-and-forget, never throw from dispatcher */ }

    // Async AI routing for pantry log (intent=pantry).
    if (opts.aiProxyBaseUrl) _setAiProxyBaseUrl(opts.aiProxyBaseUrl);
    try {
      events.emit('grocery:routing:pending', {
        idempotency_key: id,
        raw: data,
        ts,
      });
    } catch { /* non-fatal */ }
    const logContext = opts.getGroceryContext?.();
    void (async () => {
      const result = await callGroceryRoute(data, id, opts.authToken, logContext);
      const now2 = Date.now();
      try {
        events.emit('grocery:routed', {
          idempotency_key: id,
          raw: data,
          items: result
            ? result.items.map((it) => ({ name: it.name, target: it.target }))
            : [{ name: data, target: 'pantry' as const }],
          source: result
            ? (result.source === 'cache_hit' ? 'cache' : 'gemini')
            : 'fallback',
          latency_ms: result ? result.latencyMs : Date.now() - ts,
          ts: now2,
        });
      } catch { /* non-fatal */ }
    })();

    return;
  }

  // ── cycle ────────────────────────────────────────────────────────────
  // cycle is structured (action enum + text). No scrubbable note field
  // — corpus spec doesn't include a cycle_records table. Skip emit.
  if (module === 'cycle') {
    store.update<Array<{ ts: number; action: string; text: string }>>(
      'cycle',
      'items',
      (cur) => [...(cur ?? []), { ts, action: kind, text: data }],
    );
    return;
  }

  // ── finance ──────────────────────────────────────────────────────────
  // Görev 2: finance sub-slice classification (was UI-only in
  // applyRoute.ts). Lands in finance.<slice> with a generic row shape.
  // No research:row_written emit — the finance orchestrator owns the
  // finance_records corpus path.
  if (module === 'finance') {
    const slice = classifyFinanceSlice(data, ts);
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'finance',
      slice,
      (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
    );
    return;
  }

  // ── work ────────────────────────────────────────────────────────────
  if (module === 'work') {
    const lower = data.toLowerCase();
    // Turkish "ı" breaks \b word boundaries; use a tolerant lookbehind-free
    // check that catches "meeting" + Turkish "toplantı"/"toplanti" anywhere.
    if (/\bmeeting\b/i.test(lower) || /toplant[ıi]/i.test(lower)) {
      const id = newId();
      store.update<
        Array<{ id: string; title: string; start_at: number; end_at: number }>
      >('work', 'meetings', (cur) => [
        ...(cur ?? []),
        { id, title: data, start_at: ts, end_at: ts + 30 * 60_000 },
      ]);
      emitResearchRow('work_records', id, data, ts, getLocale());
      return;
    }
    // deadline / project / focus / generic task → tasks
    const id = newId();
    store.update<Array<{ id: string; title: string; created_at: number }>>(
      'work',
      'tasks',
      (cur) => [...(cur ?? []), { id, title: data, created_at: ts }],
    );
    emitResearchRow('work_records', id, data, ts, getLocale());
    return;
  }

  // ── goals ───────────────────────────────────────────────────────────
  // goals.items is title + status; corpus spec doesn't define a
  // goals_records table. Skip emit.
  if (module === 'goals') {
    store.update<
      Array<{ id: string; title: string; created_at: number; status: string }>
    >('goals', 'items', (cur) => [
      ...(cur ?? []),
      { id: newId(), title: data, created_at: ts, status: 'active' },
    ]);
    return;
  }

  // ── body ────────────────────────────────────────────────────────────
  if (module === 'body') {
    const lower = data.toLowerCase();
    // water_log has no scrubbable text field — skip emit.
    if (/glass|water|içtim|drank|drunk|hydrat/i.test(lower)) {
      store.update<Array<{ ts: number }>>(
        'body',
        'water_log',
        (cur) => [...(cur ?? []), { ts }],
      );
      return;
    }
    if (/vitamin|supplement|d3|magnesium|omega|zinc|iron|b12|probiotic|tablet|capsule/i.test(lower)) {
      const id = newId();
      store.update<Array<{ id: string; text: string; ts: number }>>(
        'body',
        'supplements',
        (cur) => [...(cur ?? []), { id, text: data, ts }],
      );
      emitResearchRow('body_records', id, data, ts, getLocale());
      return;
    }
    // Görev 2: episodes sub-slice (was UI-only in applyRoute.ts) — migraine
    // / crash / flare entries land in body.episodes, not body.items.
    if (/migraine|migren|episode|severe|crash|flare/i.test(lower)) {
      const id = newId();
      store.update<Array<{ id: string; text: string; ts: number }>>(
        'body',
        'episodes',
        (cur) => [...(cur ?? []), { id, text: data, ts }],
      );
      emitResearchRow('body_records', id, data, ts, getLocale());
      return;
    }
    const id = newId();
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'body',
      'items',
      (cur) => [...(cur ?? []), { id, text: data, ts }],
    );
    emitResearchRow('body_records', id, data, ts, getLocale());
    return;
  }

  // ── astrology → dump ────────────────────────────────────────────────
  // Astrology has no surface of its own; lands in the dump.items
  // bucket, which the corpus spec treats as brain_dump_log content.
  if (module === 'astrology') {
    const id = newId();
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'dump',
      'items',
      (cur) => [...(cur ?? []), { id, text: data, ts }],
    );
    emitResearchRow('brain_dump_log', id, data, ts, getLocale());
    return;
  }

  // ── default: <module>.items generic shape ────────────────────────────
  // dump → brain_dump_log; admin/sleep/habits/pets/health/reminders/…
  // → home_records.
  const id = newId();
  store.update<Array<{ id: string; text: string; ts: number }>>(
    module,
    'items',
    (cur) => [...(cur ?? []), { id, text: data, ts }],
  );
  if (module === 'dump') {
    emitResearchRow('brain_dump_log', id, data, ts, getLocale());
  } else {
    emitResearchRow('home_records', id, data, ts, getLocale());
  }
}
