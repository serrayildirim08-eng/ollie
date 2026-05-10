/**
 * @ollie/logic · journal · search
 *
 * tokenize, levenshtein1, searchEntries.
 * TF-IDF + fuzzy-1 over stored entries.
 *
 * No I/O. No DOM. No wall-clock reads.
 */

import type { StoredEntry, SearchResult } from './types';
import { STOPWORDS } from './constants';

export function tokenize(text: unknown): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9']+/g)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Fast edit-distance-1 check (exact or 1 sub/ins/del).
 * Returns 0, 1, or 2 (≥2 = definitely more than 1 edit).
 */
export function levenshtein1(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let i = 0, j = 0, diffs = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    diffs++;
    if (diffs > 1) return 2;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  if (i < a.length || j < b.length) diffs++;
  return diffs;
}

/**
 * TF-IDF search over stored entries with fuzzy-1 matching for 4+ char terms.
 * Returns scored results sorted by score desc, then recency desc.
 */
export function searchEntries(
  entries: StoredEntry[],
  query: string,
): SearchResult[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const qTerms = tokenize(query);
  if (qTerms.length === 0) return [];

  const N = entries.length;
  const docTokens = entries.map(e => tokenize(e['text_rendered'] ?? e['text'] ?? ''));

  const df: Record<string, number> = {};
  for (const t of qTerms) {
    df[t] = 0;
    for (const toks of docTokens) {
      const hit = toks.some(dt => dt === t || (t.length >= 4 && levenshtein1(dt, t) <= 1));
      if (hit) df[t]++;
    }
    if (df[t] === 0) df[t] = 1;
  }

  const idf: Record<string, number> = {};
  for (const t of qTerms) {
    idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
  }

  const results: SearchResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const toks = docTokens[i];
    if (toks.length === 0) continue;

    let score = 0;
    const matches: SearchResult['matches'] = [];
    const textLower = String(entry['text_rendered'] ?? entry['text'] ?? '').toLowerCase();

    for (const t of qTerms) {
      let tf = 0;
      const fuzzy = t.length >= 4;
      for (const dt of toks) {
        if (dt === t) tf += 1.0;
        else if (fuzzy && levenshtein1(dt, t) <= 1) tf += 0.6;
      }
      if (tf > 0) {
        score += tf * idf[t];
        let pos = 0;
        while (pos < textLower.length) {
          const found = textLower.indexOf(t, pos);
          if (found === -1) break;
          const before = found === 0 || !/[a-z0-9]/i.test(textLower[found - 1] ?? '');
          const after =
            found + t.length === textLower.length ||
            !/[a-z0-9]/i.test(textLower[found + t.length] ?? '');
          if (before && after) {
            matches.push({ term: t, start: found, end: found + t.length });
          }
          pos = found + t.length;
        }
      }
    }

    if (score > 0) results.push({ entry, score, matches });
  }

  results.sort((a, b) => b.score - a.score || (b.entry.ts ?? 0) - (a.entry.ts ?? 0));
  return results;
}
