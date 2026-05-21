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

export interface GroceryRoutedItem {
  name: string;
  canonical: string | null;
  category: string;
  intent: string;
  target: 'pantry' | 'shopping';
  qty?: number;
  unit?: string;
  shelfLifeDays?: number;
  isRecipeExpansion?: boolean;
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

/** Base URL for the ai-proxy worker. Overrideable for tests. */
let _aiProxyBaseUrl = 'https://ollie-ai-proxy.workers.dev';

/** Override the ai-proxy base URL (for tests only). */
export function _setAiProxyBaseUrl(url: string): void {
  _aiProxyBaseUrl = url;
}

/** Timeout for /route/grocery call. Falls back to keyword logic on timeout. */
const ROUTE_TIMEOUT_MS = 3000;

/**
 * Call /route/grocery on the ai-proxy worker. Returns null on any error or
 * timeout — caller falls through to keyword fallback.
 */
async function callGroceryRoute(
  text: string,
  dumpId: string,
  authToken?: string,
): Promise<GroceryRoutingResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authToken) headers['authorization'] = `Bearer ${authToken}`;

    const res = await fetch(`${_aiProxyBaseUrl}/route/grocery`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, dumpId }),
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
  //   - Call ai-proxy /route/grocery async (3s timeout).
  //   - On success: emit `grocery:routed` with AI result + source=cache_hit/gemini_miss.
  //   - On failure/timeout: keyword fallback (original behaviour below), source=fallback_keyword.
  //   - Recipe expansion preserved: isRecipeExpansion items are kept.
  //   - Store write (items/pantry) runs synchronously via keyword path first;
  //     AI result is enrichment-only (adds canonical/category/intent metadata).
  if (module === 'grocery' && kind === 'add') {
    const id = newId();
    store.update<Array<{ id: string; name: string; ts: number; checked: boolean }>>(
      'grocery',
      'items',
      (cur) => [...(cur ?? []), { id, name: data, ts, checked: false }],
    );
    emitResearchRow('home_records', id, data, ts, getLocale());

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
    void (async () => {
      const result = await callGroceryRoute(data, id, opts.authToken);
      const now2 = Date.now();
      if (result) {
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
        // Fallback — keyword path already applied; emit with fallback source.
        try {
          events.emit('grocery:routed', {
            idempotency_key: id,
            raw: data,
            items: [{ name: data, target: 'shopping' }],
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

    // Async AI routing for pantry log (intent=pantry).
    if (opts.aiProxyBaseUrl) _setAiProxyBaseUrl(opts.aiProxyBaseUrl);
    try {
      events.emit('grocery:routing:pending', {
        idempotency_key: id,
        raw: data,
        ts,
      });
    } catch { /* non-fatal */ }
    void (async () => {
      const result = await callGroceryRoute(data, id, opts.authToken);
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

  // ── pets ────────────────────────────────────────────────────────────
  // Phantom-fix (2026-05-21): the default fallthrough wrote pets data to
  // `pets.items` — a slice no UI surface reads. PetsApp / PetsModule both
  // read `pets.observations` (alongside pets, care_log, care_gaps,
  // health_flags, milestones — see apps/web/src/modules/pets-v2/
  // usePetsSlices.ts). Land brain-dump pet text there with the schema the
  // selector expects (StoredObservation). `pet_id: ''` is intentional —
  // unrouted observations are unattached until the user (or a future
  // upstream resolver) ties them to a specific pet; the UI tolerates the
  // empty id and just shows the text.
  if (module === 'pets') {
    const id = newId();
    store.update<Array<{
      id: string;
      pet_id: string;
      text: string;
      tags: string[];
      kind: 'note';
      created_at: number;
      occurred_at: number;
    }>>(
      'pets',
      'observations',
      (cur) => [...(cur ?? []), {
        id,
        pet_id: '',
        text: data,
        tags: [],
        kind: 'note',
        created_at: ts,
        occurred_at: ts,
      }],
    );
    emitResearchRow('home_records', id, data, ts, getLocale());
    return;
  }

  // ── admin ───────────────────────────────────────────────────────────
  // Phantom-fix (2026-05-21): default fallthrough wrote to `admin.items`;
  // AdminApp / AdminModule both read `admin.tasks` (see
  // apps/web/src/modules/admin-v2/useAdminSlices.ts). Land brain-dump
  // admin text there with the AdminItem shape — `label` is the canonical
  // field, `title` is kept for the legacy module's older rows.
  if (module === 'admin') {
    const id = newId();
    store.update<Array<{
      id: string;
      label: string;
      title: string;
      state: string;
      status: string;
      created_at: number;
      ts: number;
    }>>(
      'admin',
      'tasks',
      (cur) => [...(cur ?? []), {
        id,
        label: data,
        title: data,
        state: 'open',
        status: 'open',
        created_at: ts,
        ts,
      }],
    );
    emitResearchRow('home_records', id, data, ts, getLocale());
    return;
  }

  // ── habits ──────────────────────────────────────────────────────────
  // Phantom-fix (2026-05-21): default fallthrough wrote to `habits.items`;
  // HabitsApp / HabitsModule both read `shared.habits_v2` (StoredHabit[];
  // see apps/web/src/modules/habits-v2/useHabitsSlices.ts). A brain-dump
  // habit line is treated as the user adding a new tracked habit: append
  // a fresh `StoredHabit` with an empty completions log, default cue, and
  // an `anytime` cueTime bucket. Existing seeded habits are preserved.
  if (module === 'habits') {
    const id = `h_${newId().slice(0, 10)}`;
    store.update<Array<{
      id: string;
      name: string;
      cue: string;
      cueTime: 'morning' | 'anytime' | 'evening';
      completions: Array<{ ts: number }>;
    }>>(
      'shared',
      'habits_v2',
      (cur) => [...(cur ?? []), {
        id,
        name: data,
        cue: '',
        cueTime: 'anytime',
        completions: [],
      }],
    );
    emitResearchRow('home_records', id, data, ts, getLocale());
    return;
  }

  // ── health → dump ───────────────────────────────────────────────────
  // Phantom-fix (2026-05-21): the `health` module has NO UI surface in
  // the v2 app (no apps/web/src/modules/health* dir), so writing to
  // `health.items` is a guaranteed silent loss. Reroute to `dump.items`
  // so the entry surfaces in the brain-dump archive and lands in the
  // brain_dump_log corpus table (which is also where the keyword router
  // sends ambiguous health text via the emotion-fallback path).
  if (module === 'health') {
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
  // dump → brain_dump_log. Other modules with no explicit handler above
  // (sleep, the legacy `reminders` ModuleName kept for type back-compat)
  // → home_records. The `reminders` keyword entry is no longer emitted
  // by fallbackRoute (the phantom-fix landed there too); reminder
  // scheduling runs upstream in useApplyBrainDump via parseReminder.
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
