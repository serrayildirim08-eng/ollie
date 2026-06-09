/**
 * Per-fragment language detection · runs AFTER pass-2 segmentation.
 *
 * Labels: 'tr' | 'en' | 'es' | 'mixed' | 'unknown'.
 *
 * Decision 4: per-FRAGMENT detection (not per-dump) because users
 * code-switch within the same fragment.
 *
 * Strategy: lightweight stopword + diacritic-density scoring. No model
 * call (would double our per-fragment Gemini bill for a feature whose
 * correctness mostly affects telemetry labels — classification itself
 * is multilingual via Voyage embedding).
 *
 * If two or more languages score above MIXED_THRESHOLD → "mixed".
 */

import type { FragmentLanguage } from './dump-schema';

const TR_STOPWORDS = new Set([
  've',
  'ile',
  'ama',
  'çok',
  'için',
  'değil',
  'bir',
  'bu',
  'şu',
  'o',
  'ne',
  'ben',
  'sen',
  'biz',
  'siz',
  'onlar',
  'gibi',
  'kadar',
  'olsun',
  'oldu',
  'olur',
  'olarak',
  'evet',
  'hayır',
]);

const EN_STOPWORDS = new Set([
  'the',
  'and',
  'but',
  'or',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'i',
  'you',
  'we',
  'they',
  'this',
  'that',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'have',
  'has',
  'had',
  "don't",
  'dont',
]);

const ES_STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'y',
  'pero',
  'o',
  'un',
  'una',
  'es',
  'son',
  'soy',
  'yo',
  'tu',
  'tú',
  'nosotros',
  'ellos',
  'esto',
  'eso',
  'a',
  'de',
  'en',
  'con',
  'para',
  'por',
  'que',
  'sí',
  'no',
]);

// Pure-TR-only diacritics (NOT shared with ES). `ü` and `ö` exist in both
// languages, so they don't disambiguate from a single char.
const TR_DIACRITICS = /[şğçıİ]/;
// Pure-ES-only marks (NOT shared with TR).
const ES_DIACRITICS = /[ñ¿¡]/;

const MIXED_THRESHOLD = 0.25; // ratio of fragment tokens that anchor a lang

export function detectFragmentLanguage(text: string): FragmentLanguage {
  if (typeof text !== 'string' || text.trim().length === 0) return 'unknown';

  const tokens = text
    .toLowerCase()
    .split(/[\s,.!?;:()'"]+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return 'unknown';

  let tr = 0;
  let en = 0;
  let es = 0;

  for (const tok of tokens) {
    if (TR_STOPWORDS.has(tok)) tr++;
    if (EN_STOPWORDS.has(tok)) en++;
    if (ES_STOPWORDS.has(tok)) es++;
  }

  // Diacritic bumps. Turkish + Spanish use disjoint character sets, so
  // a fragment with TR diacritics gets a strong tr nudge even if its
  // stopword density is low (e.g. "kafam ağrıyor" — no TR stopwords).
  if (TR_DIACRITICS.test(text)) tr += Math.max(1, tokens.length * 0.3);
  if (ES_DIACRITICS.test(text)) es += Math.max(1, tokens.length * 0.3);

  // Single-language fragments lacking any of the three signals fall back
  // to 'en' (most common second language) iff the fragment looks Latin
  // alphabet but has no anchors; otherwise 'unknown'.
  const total = tr + en + es;
  if (total === 0) {
    return /^[a-zA-Z\s.,!?'"-]+$/.test(text) ? 'en' : 'unknown';
  }

  const trShare = tr / total;
  const enShare = en / total;
  const esShare = es / total;

  // Count "above threshold" languages
  let above = 0;
  if (trShare >= MIXED_THRESHOLD) above++;
  if (enShare >= MIXED_THRESHOLD) above++;
  if (esShare >= MIXED_THRESHOLD) above++;

  if (above >= 2) return 'mixed';

  // Pick the dominant
  if (trShare >= enShare && trShare >= esShare) return 'tr';
  if (esShare >= enShare) return 'es';
  return 'en';
}
