/**
 * @ollie/logic · grocery · text parsing helpers
 *
 * Pure functions — no I/O, no wall-clock reads.
 */

import type { NormalizeResult, ParsedGroceryItem, GroceryIntent } from './types';
import { ALIAS_TABLE, SORTED_ALIASES } from './data';
import { levenshtein } from '../util';

// ─── Regex constants ─────────────────────────────────────────────────────

export const INTENT_VERBS = {
  REMOVE: /\b(?:delete|remove|drop|skip|nevermind|never\s*mind|scratch|cancel|forget(?:\s+it)?|take\s+off(?:\s+the)?\s+list|don'?t\s+(?:need|want|buy|get|grab)|no\s+longer\s+need(?:ed)?|sil|kaldır|listeden\s+çıkar|gerek\s+yok|istemiyorum|boşver|vazgeç(?:tim)?)\b/i,
  BOUGHT: /\b(?:got|bought|grabbed|picked\s+up|stocked(?:\s+up)?|restocked|filled\s+up\s+on|just\s+(?:got|bought|grabbed|picked\s+up)|came\s+home\s+with|aldım|geldi|getirdim)\b/i,
  ADD:    /\b(?:need|needs|needed|want|wants|wanted|out\s+of|ran\s+out(?:\s+of)?|running\s+low(?:\s+on)?|buy|gotta(?:\s+(?:buy|get|grab|pick\s+up))?|pick\s+up|grab|add|adding|put\s+on(?:\s+the)?\s+list|throw\s+(?:on|in)(?:\s+the)?\s+list|gerek(?:li|iyor)?|al(?:malıyım|mam\s+lazım|mam\s+gerek)|bitti|bitmek\s+üzere|listeye\s+(?:ekle|at|koy)|eksik|gone)\b/i,
} as const;

export const STRIP_VERBS_RE = /^(?:got|bought|buy|get|need|needs|needed|grabbed|picked\s+up|have|added|add|adding|gotta|grab|pick\s+up|want|wants|wanted|ran\s+out\s+of|running\s+low\s+on|out\s+of|no\s+longer\s+need|don'?t\s+(?:need|want|buy|get|grab)|delete|remove|drop|skip|nevermind|never\s*mind|cancel|aldım|getirdim|geldi|gerekli|gerek|listeye\s+(?:ekle|at|koy))\s+/i;

const PAST_CONSUMPTION_RE = /\b(?:had|ate|finished|drank|polished\s+off)\s+(?:the\s+|some\s+|all\s+(?:the|my|our)\s+)?[a-zçğıöşü]+/i;
const HAVE_IDIOM_RE = /\bhave\s+(?:a|an|to|the)\b/i;

const QTY_RE = /(\d+(?:[.,]\d+)?)\s*(lbs?|pounds?|kg|kilos?|grams?|gr|g|oz|ounces?|gal|gallons?|liters?|litres?|l|ml|cups?|tbsp|tsp|pcs?|pieces?|adet|tane|dozen|doz|düzine|duzine|bags?|bottles?|cans?|cartons?|boxes?|packs?|paketi?|kutu|şişe|sise|loaves?|loaf)?\b/i;

// ─── String helpers ──────────────────────────────────────────────────────

const TR_FOLD: Record<string, string> = {
  'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's',
  'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g',
  'ö': 'o', 'Ö': 'o', 'ü': 'u', 'Ü': 'u',
};

export function foldDiacritics(s: string): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[ıİşŞçÇğĞöÖüÜ]/g, (ch) => TR_FOLD[ch] ?? ch)
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function stripPlural(s: string): string {
  if (!s) return s;
  if (/ies$/.test(s) && s.length > 4) return s.replace(/ies$/, 'y');
  if (/(?:[^aeiou]es|sses|shes|ches)$/.test(s)) return s.replace(/es$/, '');
  if (/s$/.test(s) && !/ss$/.test(s) && s.length > 3) return s.replace(/s$/, '');
  if (/(ler|lar)$/.test(s) && s.length > 4) return s.replace(/(ler|lar)$/, '');
  return s;
}

/**
 * Levenshtein distance, capped at 2. Delegates to the shared capped
 * implementation in `../util`. Distances beyond 2 return 3 (the
 * sole caller only checks `d <= 2`, so the over-budget sentinel value
 * does not matter).
 */
export function lev(a: string, b: string): number {
  return levenshtein(a, b, 2);
}

// ─── Item normaliser ─────────────────────────────────────────────────────

export function normalizeItemName(rawText: string): NormalizeResult {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { canonical: null, confidence: 'low', method: 'fail' };
  }
  const folded = foldDiacritics(rawText.toLowerCase()).replace(/\s+/g, ' ').trim();
  let s = folded.replace(STRIP_VERBS_RE, '').trim();
  if (!s) s = folded;
  s = s.replace(/\s+(?:please|pls|asap|today|tomorrow|btw)$/i, '');
  if (!s) return { canonical: null, confidence: 'low', method: 'fail' };

  // Exact alias match
  for (let i = 0; i < SORTED_ALIASES.length; i++) {
    if (foldDiacritics(SORTED_ALIASES[i][0]) === s) {
      return { canonical: SORTED_ALIASES[i][1], confidence: 'high', method: 'exact' };
    }
  }

  // Singular form match
  const sSing = stripPlural(s);
  if (sSing !== s) {
    for (let i = 0; i < SORTED_ALIASES.length; i++) {
      if (foldDiacritics(SORTED_ALIASES[i][0]) === sSing) {
        return { canonical: SORTED_ALIASES[i][1], confidence: 'high', method: 'alias' };
      }
    }
  }

  // Multi-word prefix match
  for (let i = 0; i < SORTED_ALIASES.length; i++) {
    const row = SORTED_ALIASES[i];
    if (row[2] < 2) break;
    const alFolded = foldDiacritics(row[0]);
    if (s === alFolded || s.startsWith(alFolded + ' ')) {
      return { canonical: row[1], confidence: 'medium', method: 'prefix' };
    }
  }

  // Single-token prefix match
  const tokens = s.split(/\s+/);
  for (const tok of tokens) {
    const tokSing = stripPlural(tok);
    for (let i = 0; i < SORTED_ALIASES.length; i++) {
      const row = SORTED_ALIASES[i];
      if (row[2] !== 1) continue;
      const alFolded = foldDiacritics(row[0]);
      if (tokSing === alFolded || tok === alFolded) {
        return { canonical: row[1], confidence: 'medium', method: 'prefix' };
      }
    }
  }

  // Edit-distance fallback
  let best: { d: number; canon: string } | null = null;
  for (let i = 0; i < SORTED_ALIASES.length; i++) {
    const row = SORTED_ALIASES[i];
    const alFolded = foldDiacritics(row[0]);
    if (alFolded.length > 12 || alFolded.includes(' ')) continue;
    const d = lev(s, alFolded);
    if (d <= 2 && (!best || d < best.d)) best = { d, canon: row[1] };
  }
  if (best) return { canonical: best.canon, confidence: 'low', method: 'edit' };

  return { canonical: null, confidence: 'low', method: 'fail' };
}

// ─── Full item parser ────────────────────────────────────────────────────

export function parseGroceryItem(text: string): ParsedGroceryItem | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (PAST_CONSUMPTION_RE.test(lower) && !INTENT_VERBS.BOUGHT.test(lower) && !INTENT_VERBS.ADD.test(lower)) {
    return null;
  }
  if (HAVE_IDIOM_RE.test(lower)) return null;

  let intent: GroceryIntent = 'UNKNOWN';
  if (INTENT_VERBS.REMOVE.test(lower)) intent = 'REMOVE';
  else if (INTENT_VERBS.BOUGHT.test(lower)) intent = 'BOUGHT';
  else if (INTENT_VERBS.ADD.test(lower)) intent = 'ADD';

  let body = trimmed.replace(STRIP_VERBS_RE, '').trim();
  if (!body) body = trimmed;

  let qty: number | null = null;
  let unit: string | null = null;
  const qtyMatch = body.match(QTY_RE);
  if (qtyMatch) {
    const num = parseFloat(qtyMatch[1].replace(',', '.'));
    if (!isNaN(num)) {
      qty = num;
      unit = (qtyMatch[2] ?? 'count').toLowerCase();
      if (unit === 'dozen' || unit === 'doz' || unit === 'düzine' || unit === 'duzine') {
        qty = num * 12;
        unit = 'count';
      }
      body = body.replace(qtyMatch[0], '').trim();
    }
  }

  const norm = normalizeItemName(body);
  if (!norm.canonical) {
    if (intent === 'UNKNOWN') return null;
    if (qty == null) return null;
    return { name: body || trimmed, normalizedName: null, category: 'other', intent, qty, unit: unit ?? undefined };
  }

  const row = ALIAS_TABLE[norm.canonical] ?? { category: 'other' as const };
  if (intent === 'UNKNOWN') intent = 'ADD';
  const out: ParsedGroceryItem = {
    name: norm.canonical,
    normalizedName: norm.canonical,
    category: row.category ?? 'other',
    intent,
  };
  if (qty != null) out.qty = qty;
  if (unit != null) out.unit = unit;
  return out;
}
