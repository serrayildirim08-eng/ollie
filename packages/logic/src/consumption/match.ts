/**
 * @ollie/logic/consumption · brand matching
 *
 * Tokenizes free text, normalizes Turkish characters to ASCII, then
 * looks up brand aliases via a precomputed Map. Exact-token unigrams
 * + bigrams match at confidence 1.0; near-miss matches (Levenshtein-1
 * on tokens of ≥5 chars vs. aliases of ≥5 chars) match at 0.85.
 *
 * Pure. No I/O. The default index is precomputed from BRAND_SEED;
 * callers passing a custom brand list pay a one-time index build.
 */

import { BRAND_SEED } from './brands';
import type { Brand, BrandMatch } from './types';
import { withinEditDistance } from '../util';

 
const COMBINING_DOT_ABOVE = String.fromCodePoint(0x0307);

export function normalize(text: string | undefined | null): string {
  if (!text || typeof text !== 'string') return '';
  // İ.toLowerCase() yields "i" + U+0307 (combining dot above). Strip the dot
  // before the regex sweep so it doesn't survive as whitespace. Built via
  // String escape because esbuild's source transform sometimes normalises
  // stand-alone combining marks out of inline regex literals.
  return text
    .toLowerCase()
    .split(COMBINING_DOT_ABOVE)
    .join('')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .replace(/[^\p{L}\p{N}&'\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein distance ≤ 1 (insertion, deletion, or substitution).
 * Delegates to the shared capped Levenshtein in `../util`.
 */
export function withinOne(a: string, b: string): boolean {
  return withinEditDistance(a, b, 1);
}

function buildIndex(brands: readonly Brand[]): Map<string, Brand> {
  const idx = new Map<string, Brand>();
  for (const b of brands) {
    for (const alias of b.aliases) idx.set(normalize(alias), b);
  }
  return idx;
}

export const BRAND_INDEX = buildIndex(BRAND_SEED);

export function matchBrand(text: string, brands?: readonly Brand[]): BrandMatch[] {
  const list = brands ?? BRAND_SEED;
  const idx = brands && brands !== BRAND_SEED ? buildIndex(list) : BRAND_INDEX;

  const norm = normalize(text);
  if (!norm) return [];
  const tokens = norm.split(' ');
  const matches = new Map<string, BrandMatch>();

  const pushMatch = (brand: Brand, confidence: number, matched_token: string): void => {
    const prev = matches.get(brand.key);
    if (!prev || confidence > prev.confidence) {
      matches.set(brand.key, {
        brand_key: brand.key,
        category_l1: brand.category_l1,
        category_l2: brand.category_l2 ?? null,
        confidence,
        matched_token,
      });
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const uni = tokens[i];
    const uniBrand = idx.get(uni);
    if (uniBrand) pushMatch(uniBrand, 1.0, uni);
    if (i + 1 < tokens.length) {
      const bi = uni + ' ' + tokens[i + 1];
      const biBrand = idx.get(bi);
      if (biBrand) pushMatch(biBrand, 1.0, bi);
    }
  }

  for (const tok of tokens) {
    if (tok.length < 5) continue;
    for (const [alias, brand] of idx) {
      if (matches.has(brand.key)) continue;
      if (alias.includes(' ')) continue;
      if (alias.length < 5) continue;
      if (withinOne(tok, alias)) pushMatch(brand, 0.85, tok);
    }
  }

  return Array.from(matches.values()).sort((a, b) => b.confidence - a.confidence);
}
