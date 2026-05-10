/**
 * @ollie/logic/corrections
 *
 * A learned store of "she routed this text to X, not whatever the router
 * suggested." Repeated corrections bias stronger via count × √count rank.
 *
 * Storage of the array lives in @ollie/store (shared.routingCorrections).
 * These are the pure transforms: `record(prev, text, mod, now)` returns a
 * new array, `match(corrections, dump)` returns the best-fit or null.
 *
 * `now` is an explicit param (was Date.now() in the legacy code).
 */

export interface CorrectionEntry {
  text: string;
  preferredModule: string;
  ts: number;
  count: number;
}

const TOKEN_RE = /[a-zçğıöşüâîû]{3,}/gi;

function norm(s: unknown): string[] {
  return String(s ?? '').toLowerCase().match(TOKEN_RE) || [];
}

function jaccard(aTokens: readonly string[], bTokens: readonly string[]): number {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const MAX_ENTRIES = 50;
const NEAR_DUPLICATE_THRESHOLD = 0.6;
const MATCH_THRESHOLD = 0.3;

export function record(
  prev: readonly CorrectionEntry[] | undefined | null,
  text: string,
  preferredModule: string,
  now: number,
): CorrectionEntry[] {
  const safe: CorrectionEntry[] = Array.isArray(prev) ? prev.slice() : [];
  const txt = String(text || '').trim();
  const mod = String(preferredModule || '').trim();
  if (!txt || !mod) return safe;
  const toks = norm(txt);
  if (!toks.length) return safe;

  let idx = -1;
  for (let i = 0; i < safe.length; i++) {
    const e = safe[i];
    if (!e || e.preferredModule !== mod) continue;
    const score = jaccard(toks, norm(e.text));
    if (score >= NEAR_DUPLICATE_THRESHOLD) {
      idx = i;
      break;
    }
  }
  if (idx >= 0) {
    safe[idx] = { ...safe[idx], ts: now, count: (safe[idx].count || 1) + 1 };
  } else {
    safe.push({ text: txt.slice(0, 200), preferredModule: mod, ts: now, count: 1 });
  }
  if (safe.length > MAX_ENTRIES) {
    safe.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return safe.slice(0, MAX_ENTRIES);
  }
  return safe;
}

export function match(
  corrections: readonly CorrectionEntry[] | undefined | null,
  dumpText: string,
): CorrectionEntry | null {
  const arr = Array.isArray(corrections) ? corrections : [];
  if (!arr.length) return null;
  const dumpToks = norm(dumpText);
  if (!dumpToks.length) return null;
  let best: CorrectionEntry | null = null;
  let bestScore = 0;
  for (const e of arr) {
    if (!e || !e.text || !e.preferredModule) continue;
    const score = jaccard(dumpToks, norm(e.text));
    if (score < MATCH_THRESHOLD) continue;
    const rank = score * Math.sqrt(e.count || 1);
    if (rank > bestScore) {
      bestScore = rank;
      best = e;
    }
  }
  return best;
}

/** Exposed for tests + downstream tools. */
export const _internals = { norm, jaccard };
