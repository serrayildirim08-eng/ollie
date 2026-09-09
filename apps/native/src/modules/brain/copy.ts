/**
 * apps/native · modules/brain/copy.ts  —  "speak in your words" (Sprint 3)
 *
 * The native half of the noticing-copy layer. For a selected noticing it:
 *   1. derives the situation FACTS (kind / item / days / count / offered action)
 *      from the scored candidate (the pure @ollie/logic/brain helpers do the
 *      mapping; the candidate's `facts` carries the recovered item names),
 *   2. returns an AI-generated calm/neutral sentence in the user's APP language
 *      when available — generated AT MOST ONCE per (noticing, day, language)
 *      via a persisted cache (brain_copy_cache) so re-renders never re-call,
 *   3. FALLS BACK to the clean trilingual hardcoded sentence (fallbackCopy) on
 *      any miss — offline, error, no bearer, empty AI text. The surface is
 *      NEVER blank and NEVER shows an error.
 *
 * It also builds the suggested ACTION descriptor (e.g. the milk noticing →
 * add_to_grocery_list) so the surface can render an accept affordance.
 *
 * Best-effort throughout: every failure path resolves to the fallback string,
 * never throws into the UI.
 */

import {
  buildCopyPrompt,
  fallbackCopy,
  copyKindOf,
  buildAddToGroceryListAction,
  buildDeferTasksAction,
  buildAddAdminTaskAction,
  buildSurfaceDecisionAction,
  buildSurfaceTasksAction,
  buildBreakDownTaskAction,
  buildBatchBlockAction,
  buildArchiveTaskAction,
  buildMarkChoreDoneAction,
  type ScoredNoticing,
  type CopyFacts,
  type CopyActionKind,
  type AppLang,
  type NoticingAction,
} from '@ollie/logic/brain';

import { sql } from '../../storage';
import { routeBrainCopy } from '../../api/workers';
import { migrateBrain } from './migrate';
import { getAppLang } from '../../settings/appLang';

const DAY_MS = 86_400_000;

// ─── facts + action derivation (pure mapping over the candidate) ─────────────

/** The recognised offer action kinds a detector can attach via `facts.actionKind`. */
const OFFER_ACTION_KINDS: readonly CopyActionKind[] = [
  'add_to_grocery_list',
  'defer_tasks',
  'add_admin_task',
  'surface_decision',
  // ── wave 2 ──
  'surface_tasks',
  'break_down_task',
  'batch_block',
  // ── dateless ladder final tier ──
  'archive_task',
  // ── chores ──
  'mark_chore_done',
] as const;

/** Read the offer action a detector attached directly to the candidate's facts. */
function attachedActionKind(n: ScoredNoticing): CopyActionKind | null {
  const raw = (n.facts as { actionKind?: unknown } | null | undefined)?.actionKind;
  if (typeof raw !== 'string') return null;
  return (OFFER_ACTION_KINDS as readonly string[]).includes(raw)
    ? (raw as CopyActionKind)
    : null;
}

/**
 * The action a noticing can offer, by kind. Two paths:
 *   1. an action a detector attached directly (`facts.actionKind` — the admin
 *      renewal/decision offers carry their own kind + payload data), OR
 *   2. the kind inferred from the noticing's copy-kind:
 *        - replenish ("milk")  → add_to_grocery_list
 *        - sleep_debt          → defer_tasks
 * The milk path (replenish → add_to_grocery_list) is unchanged.
 */
function actionKindFor(n: ScoredNoticing): CopyActionKind | null {
  const attached = attachedActionKind(n);
  if (attached) return attached;
  const kind = copyKindOf({ category: n.category, module: n.module });
  if (kind === 'replenish') return 'add_to_grocery_list';
  if (kind === 'sleep_debt') return 'defer_tasks';
  return null;
}

/** Item names this noticing is about (e.g. ['milk']) — from the carried facts. */
function itemNames(n: ScoredNoticing): string[] {
  const items = n.facts?.items;
  return Array.isArray(items) ? items.filter((s): s is string => !!s) : [];
}

/** Build the {@link CopyFacts} the AI + fallback consume for this noticing. */
export function factsForNoticing(n: ScoredNoticing): CopyFacts {
  const kind = copyKindOf({ category: n.category, module: n.module });
  const names = itemNames(n);
  const days = typeof n.facts?.days === 'number' ? n.facts.days : null;
  return {
    kind,
    item: names[0] ?? null,
    days,
    otherCount: names.length > 1 ? names.length - 1 : null,
    action: actionKindFor(n),
  };
}

/** Read a string field a detector attached to the candidate's facts bag. */
function factString(n: ScoredNoticing, key: string): string {
  const raw = (n.facts as Record<string, unknown> | null | undefined)?.[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Read a string[] field a detector attached (wave-2 id lists). Empty when absent. */
function factStringArray(n: ScoredNoticing, key: string): string[] {
  const raw = (n.facts as Record<string, unknown> | null | undefined)?.[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => (x ?? '').toString().trim()).filter(Boolean);
}

/** Read a finite-number field a detector attached (wave-2 fire time). NaN when absent. */
function factNumber(n: ScoredNoticing, key: string): number {
  const raw = (n.facts as Record<string, unknown> | null | undefined)?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN;
}

/**
 * The suggested action descriptor for a noticing, or null if it offers none.
 * The native dispatcher (executeAction) turns this into a real repo call.
 *
 * Each kind builds from the data the detector carried:
 *   - add_to_grocery_list → the recovered item names (milk path, unchanged).
 *   - defer_tasks         → no per-task data; the executor resolves the set.
 *   - add_admin_task      → the renewal's task text + due date.
 *   - surface_decision    → the recurring-decision row id + what.
 */
export function actionForNoticing(n: ScoredNoticing, lang: AppLang): NoticingAction | null {
  const kind = actionKindFor(n);
  switch (kind) {
    case 'add_to_grocery_list':
      return buildAddToGroceryListAction(itemNames(n), lang);
    case 'defer_tasks':
      return buildDeferTasksAction(lang);
    case 'add_admin_task':
      return buildAddAdminTaskAction(
        factString(n, 'taskText'),
        factString(n, 'dueDate') || null,
        lang,
      );
    case 'surface_decision':
      return buildSurfaceDecisionAction(
        factString(n, 'decisionId'),
        factString(n, 'decisionWhat'),
        lang,
      );
    case 'surface_tasks':
      // paperwork piling → the stalled admin task ids to bring to today.
      return buildSurfaceTasksAction(factStringArray(n, 'taskIds'), lang);
    case 'break_down_task':
      // chronic deferral → break the repeatedly-deferred task into a first step.
      // The orchestrator carries the source id as `taskId`; accept `sourceTaskId`
      // too for any future synthesized path.
      return buildBreakDownTaskAction(
        factString(n, 'taskText'),
        factString(n, 'taskId') || factString(n, 'sourceTaskId'),
        lang,
      );
    case 'batch_block':
      // renewal cluster → batch the renewals into one day + an app-closed reminder.
      return buildBatchBlockAction(
        factString(n, 'batchLabel'),
        factNumber(n, 'batchFireAtMs'),
        factStringArray(n, 'renewalIds'),
        lang,
      );
    case 'archive_task': {
      // dateless ladder final tier → archive the long-untouched task. The
      // ladder attaches the task's module + id to the candidate facts.
      const mod = factString(n, 'taskModule');
      if (mod !== 'admin' && mod !== 'work') return null;
      return buildArchiveTaskAction(mod, factString(n, 'taskId'), lang);
    }
    case 'mark_chore_done':
      // chore-due offer → mark the recurring chore done (resets its clock).
      // The chores orchestrator attaches the registry id + name to the facts.
      return buildMarkChoreDoneAction(
        factString(n, 'choreId'),
        factString(n, 'choreName'),
        lang,
      );
    default:
      return null;
  }
}

// ─── per-(noticing, day, lang) cache ─────────────────────────────────────────

interface CopyCacheRow {
  text: string;
  source: string | null;
  [col: string]: unknown;
}

/** Local-day bucket — copy is regenerated at most once per calendar day. */
function dayBucket(now: number): number {
  return Math.floor(now / DAY_MS);
}

// Bump when the copy logic changes in a way that should invalidate already-
// cached sentences (e.g. the generic-placeholder fix). v2 retires any stale
// "you have a generic situation" rows written before the fix.
const COPY_CACHE_VERSION = 'v2';

function cacheKey(noticingId: string, lang: AppLang, bucket: number): string {
  return `${COPY_CACHE_VERSION}|${noticingId}|${lang}|${bucket}`;
}

async function readCache(key: string): Promise<string | null> {
  try {
    await migrateBrain();
    const rows = await sql.select<CopyCacheRow>(
      `SELECT text, source FROM brain_copy_cache WHERE cache_key = ? LIMIT 1`,
      [key],
    );
    const text = rows[0]?.text;
    return typeof text === 'string' && text.length > 0 ? text : null;
  } catch (err) {
    console.error('[brain] copy cache read failed (non-fatal):', err);
    return null;
  }
}

async function writeCache(
  key: string,
  noticingId: string,
  lang: AppLang,
  bucket: number,
  text: string,
  source: string,
  now: number,
): Promise<void> {
  try {
    await migrateBrain();
    await sql.execute(
      `INSERT INTO brain_copy_cache (cache_key, noticing_id, lang, day_bucket, text, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET text = excluded.text, source = excluded.source`,
      [key, noticingId, lang, bucket, text, source, now],
    );
  } catch (err) {
    console.error('[brain] copy cache write failed (non-fatal):', err);
  }
}

// ─── the resolve ─────────────────────────────────────────────────────────────

export interface ResolveCopyOptions {
  /** App language; defaults to the stored setting. */
  lang?: AppLang;
  /** Bearer for the AI call; when absent/empty, goes straight to fallback. */
  bearer?: string | null;
  /** Injectable clock (tests). */
  now?: number;
}

/**
 * Resolve the sentence to show for a noticing: AI when available (cached once
 * per noticing/day/lang), otherwise the clean trilingual fallback. NEVER blank,
 * NEVER throws. The fallback guarantees correctness with no live worker.
 */
export async function resolveNoticingCopy(
  n: ScoredNoticing,
  opts: ResolveCopyOptions = {},
): Promise<string> {
  const lang = opts.lang ?? getAppLang();
  const now = opts.now ?? Date.now();
  const facts = factsForNoticing(n);
  const fallback = fallbackCopy(facts, lang);

  const bucket = dayBucket(now);
  const key = cacheKey(n.id, lang, bucket);

  // 0. A 'generic' kind means the candidate's category mapped to nothing
  //    specific — there's nothing meaningful to hand the AI, and asking it to
  //    phrase "situation: generic" produces meta-garbage ("you have a generic
  //    situation"). Skip the AI entirely and use the clean fallback. This is a
  //    hard guarantee the placeholder copy can never reach the surface.
  if (facts.kind === 'generic') {
    return fallback;
  }

  // 1. Cached for this (noticing, day, lang)? Use it — no AI re-call on render.
  const cached = await readCache(key);
  if (cached) return cached;

  // 2. No bearer → no AI possible. Use + cache the fallback so we don't retry
  //    the (failed) AI path repeatedly within the day.
  const bearer = (opts.bearer ?? '').trim();
  if (!bearer) {
    await writeCache(key, n.id, lang, bucket, fallback, 'static_fallback', now);
    return fallback;
  }

  // 3. Try the AI. Any non-ok result OR empty text → trilingual fallback.
  try {
    const { system, user } = buildCopyPrompt(facts, lang);
    const res = await routeBrainCopy({ system, user, lang }, { bearer });
    if (res.ok) {
      const text = (res.data?.text ?? '').toString().trim();
      if (text) {
        await writeCache(key, n.id, lang, bucket, text, res.data?.source ?? 'ai', now);
        return text;
      }
    }
  } catch (err) {
    console.error('[brain] resolveNoticingCopy AI failed (non-fatal):', err);
  }

  await writeCache(key, n.id, lang, bucket, fallback, 'static_fallback', now);
  return fallback;
}
