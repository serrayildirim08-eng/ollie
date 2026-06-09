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

/**
 * The action a noticing can offer, by kind. Today only the grocery replenish
 * ("milk") noticing offers one; the framework is generic so more attach later.
 */
function actionKindFor(n: ScoredNoticing): CopyActionKind | null {
  const kind = copyKindOf({ category: n.category, module: n.module });
  if (kind === 'replenish') return 'add_to_grocery_list';
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

/**
 * The suggested action descriptor for a noticing, or null if it offers none.
 * The native dispatcher (executeAction) turns this into a real repo call.
 */
export function actionForNoticing(n: ScoredNoticing, lang: AppLang): NoticingAction | null {
  if (actionKindFor(n) === 'add_to_grocery_list') {
    return buildAddToGroceryListAction(itemNames(n), lang);
  }
  return null;
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

function cacheKey(noticingId: string, lang: AppLang, bucket: number): string {
  return `${noticingId}|${lang}|${bucket}`;
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
