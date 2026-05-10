/**
 * @ollie/logic · journal · resurface
 *
 * resurface, resurfaceAnniversaries, resurfacePhaseAnniversaries,
 * resurfaceSemanticEchoes, resurfaceFilterRecency, resurfaceMMR.
 *
 * All pure. `now` is always an explicit parameter — no Date.now() calls.
 */

import type {
  StoredEntry,
  ResurfaceBuckets,
  AnniversaryBucket,
  PhaseAnniversaryResult,
  SemanticEchoResult,
  RecentlyShownRecord,
  CycleRecord,
  MMROpts,
  ResurfaceSemanticOpts,
} from './types';
import { DAY_MS } from './constants';
import { searchEntries } from './search';

// ─── resurface ────────────────────────────────────────────────────────

/**
 * Four-bucket resurfacing at 7 / 30 / 90 / 365 days.
 * Falls back to ±1-day window when the exact day has no entries.
 */
export function resurface(entries: StoredEntry[], now: number): ResurfaceBuckets {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { weekAgo: [], monthAgo: [], seasonAgo: [], yearAgo: [] };
  }

  const bucket = (offsetDays: number): StoredEntry[] => {
    const target = new Date(now - offsetDays * DAY_MS);
    target.setHours(0, 0, 0, 0);
    const dayStart = target.getTime();
    const dayEnd = dayStart + DAY_MS;
    const exact = entries.filter(e => e.ts >= dayStart && e.ts < dayEnd);
    if (exact.length > 0) return exact;
    return entries.filter(e => e.ts >= dayStart - DAY_MS && e.ts < dayEnd + DAY_MS);
  };

  return {
    weekAgo: bucket(7),
    monthAgo: bucket(30),
    seasonAgo: bucket(90),
    yearAgo: bucket(365),
  };
}

// ─── resurfaceAnniversaries ───────────────────────────────────────────

/**
 * Stacked calendar anniversaries at 7/14/21/30/60/90/180/365 day offsets.
 * Returns flat array sorted closest-first; each bucket only populated when
 * at least one entry falls within ±1 day of the target date.
 */
export function resurfaceAnniversaries(
  entries: StoredEntry[],
  now: number,
): AnniversaryBucket[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const offsets: Array<{ days: number; label: string }> = [
    { days: 7,   label: 'a week ago' },
    { days: 14,  label: 'two weeks ago' },
    { days: 21,  label: 'three weeks ago' },
    { days: 30,  label: 'a month ago' },
    { days: 60,  label: 'two months ago' },
    { days: 90,  label: 'a season ago' },
    { days: 180, label: 'half a year ago' },
    { days: 365, label: 'a year ago' },
  ];

  const out: AnniversaryBucket[] = [];

  for (const { days, label } of offsets) {
    const target = new Date(now - days * DAY_MS);
    target.setHours(0, 0, 0, 0);
    const dayStart = target.getTime();
    const dayEnd = dayStart + DAY_MS;

    let matches = entries.filter(e => e?.ts >= dayStart && e.ts < dayEnd);
    if (matches.length === 0) {
      matches = entries.filter(e => e?.ts >= dayStart - DAY_MS && e.ts < dayEnd + DAY_MS);
    }
    if (matches.length > 0) {
      out.push({ offsetDays: days, offsetLabel: label, entries: matches });
    }
  }

  return out;
}

// ─── resurfacePhaseAnniversaries ──────────────────────────────────────

/**
 * Entries that fell on the user's current cycle day (±2 days) in any prior
 * cycle. Returns at most 5 results, most recent first.
 * Returns [] when cycle data is too thin (< 2 cycles).
 */
export function resurfacePhaseAnniversaries(
  entries: StoredEntry[],
  cycles: CycleRecord[],
  now: number,
): PhaseAnniversaryResult[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  if (!Array.isArray(cycles) || cycles.length < 2) return [];

  const current = [...cycles].reverse().find(
    c => c?.cycleStartTs && c.cycleStartTs <= now,
  );
  if (!current) return [];

  const todayCycleDay = Math.floor((now - current.cycleStartTs) / DAY_MS) + 1;
  if (todayCycleDay < 1 || todayCycleDay > 60) return [];

  const priorCycles = cycles.filter(
    c => c?.cycleStartTs && c.cycleStartTs !== current.cycleStartTs,
  );
  if (priorCycles.length === 0) return [];

  const collected: PhaseAnniversaryResult[] = [];

  for (const c of priorCycles) {
    const cycleStart = c.cycleStartTs;
    const cycleEnd = c.cycleEndTs ?? cycleStart + (c.cycleLengthDays ?? 28) * DAY_MS;
    const targetMin = cycleStart + (todayCycleDay - 3) * DAY_MS;
    const targetMax = cycleStart + (todayCycleDay + 2) * DAY_MS;
    const windowMin = Math.max(targetMin, cycleStart);
    const windowMax = Math.min(targetMax, cycleEnd);
    if (windowMax < windowMin) continue;

    for (const e of entries) {
      if (!e?.ts) continue;
      if (e.ts >= windowMin && e.ts <= windowMax) {
        const entryDay = Math.floor((e.ts - cycleStart) / DAY_MS) + 1;
        collected.push({
          entry: e,
          cycleDay: entryDay,
          daysSince: Math.floor((now - e.ts) / DAY_MS),
        });
      }
    }
  }

  collected.sort((a, b) => (b.entry.ts ?? 0) - (a.entry.ts ?? 0));

  const seen = new Set<number>();
  const uniq: PhaseAnniversaryResult[] = [];
  for (const r of collected) {
    if (seen.has(r.entry.ts)) continue;
    seen.add(r.entry.ts);
    uniq.push(r);
    if (uniq.length >= 5) break;
  }

  return uniq;
}

// ─── resurfaceSemanticEchoes ──────────────────────────────────────────

/**
 * Find past entries older than `minDaysOld` that share meaningful token
 * overlap with queryText. Uses TF-IDF + fuzzy-1 via searchEntries.
 * Returns top-N { entry, score, daysSince }.
 */
export function resurfaceSemanticEchoes(
  entries: StoredEntry[],
  queryText: string,
  now: number,
  opts?: ResurfaceSemanticOpts,
): SemanticEchoResult[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  if (!queryText || typeof queryText !== 'string') return [];

  const maxOut = opts?.max ?? 3;
  const minDaysOld = typeof opts?.minDaysOld === 'number' ? opts.minDaysOld : 14;
  const cutoff = now - minDaysOld * DAY_MS;

  const oldEnough = entries.filter(
    e => e && typeof e.ts === 'number' && e.ts < cutoff,
  );
  if (oldEnough.length === 0) return [];

  const ranked = searchEntries(oldEnough, queryText);

  return ranked.slice(0, maxOut).map(r => ({
    entry: r.entry,
    score: r.score,
    daysSince: Math.floor((now - (r.entry.ts ?? 0)) / DAY_MS),
  }));
}

// ─── resurfaceFilterRecency ───────────────────────────────────────────

/**
 * Drop candidates whose entry-ts appears in recentlyShown within windowMs.
 * Prevents the same memory surfacing twice inside 72h by default.
 *
 * NOTE: `now` is explicit — the original void code called Date.now()
 * directly here. We require the caller to pass it for purity.
 */
export function resurfaceFilterRecency(
  candidates: Array<StoredEntry | { entry: StoredEntry; [k: string]: unknown }>,
  recentlyShown: RecentlyShownRecord[],
  windowMs: number,
  now: number,
): Array<StoredEntry | { entry: StoredEntry; [k: string]: unknown }> {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const w = typeof windowMs === 'number' ? windowMs : 3 * DAY_MS * 24;

  const shownSet = new Set<number>(
    (Array.isArray(recentlyShown) ? recentlyShown : [])
      .filter(
        r => r && typeof r.ts === 'number' && typeof r.seenAt === 'number' && now - r.seenAt < w,
      )
      .map(r => r.ts),
  );

  if (shownSet.size === 0) return candidates.slice();

  return candidates.filter(c => {
    const ts = (c as StoredEntry).ts ?? ((c as { entry: StoredEntry }).entry?.ts);
    return !shownSet.has(ts as number);
  });
}

// ─── resurfaceMMR ─────────────────────────────────────────────────────

type MMRCandidate =
  | StoredEntry
  | SemanticEchoResult
  | AnniversaryBucket
  | Record<string, unknown>;

function getText(c: MMRCandidate): string {
  const candidate = c as Record<string, unknown>;
  const nested = candidate['entry'] as Record<string, unknown> | undefined;
  return String(
    nested?.['text'] ?? nested?.['data'] ?? candidate['text'] ?? candidate['data'] ?? '',
  );
}

function tokenSet(s: string): Set<string> {
  return new Set(
    String(s ?? '').toLowerCase().match(/[a-zçğıöşüâîû]{3,}/gi) ?? [],
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Maximum Marginal Relevance dedupe — penalises near-duplicate memories.
 * lambda=0.7 = lean toward relevance but heavily penalise overlap.
 * (Carbonell & Goldstein 1998)
 */
export function resurfaceMMR<T extends MMRCandidate>(
  candidates: T[],
  opts?: MMROpts,
): T[] {
  if (!Array.isArray(candidates) || candidates.length <= 1) {
    return Array.isArray(candidates) ? candidates.slice() : [];
  }

  const lambda = typeof opts?.lambda === 'number' ? opts.lambda : 0.7;
  const maxOut = typeof opts?.maxOut === 'number' ? opts.maxOut : candidates.length;

  const prepped = candidates.map((c, i) => ({
    c,
    tokens: tokenSet(getText(c)),
    rel: typeof (c as Record<string, unknown>)['score'] === 'number'
      ? ((c as Record<string, unknown>)['score'] as number)
      : (1 / (i + 1)),
  }));

  const picked: typeof prepped = [];
  const remaining = prepped.slice();

  while (picked.length < maxOut && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      let maxSim = 0;
      for (const p of picked) {
        const sim = jaccard(r.tokens, p.tokens);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * r.rel - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }

    picked.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return picked.map(p => p.c);
}
