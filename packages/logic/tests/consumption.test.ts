import { describe, it, expect } from 'vitest';
import { consumption } from '../src/index';

const { normalize, withinOne, matchBrand, BRAND_SEED, BRAND_INDEX } = consumption;

describe('normalize', () => {
  it('lowercases + ASCII-folds Turkish characters', () => {
    expect(normalize('İçim Süt')).toBe('icim sut');
    expect(normalize('Kahve Dünyası')).toBe('kahve dunyasi');
    // Non-Turkish diacritics (é, ñ, etc.) are intentionally NOT folded —
    // brand aliases are written with their canonical accents.
    expect(normalize("L'Oréal Paris")).toBe("l'oréal paris");
  });

  it('collapses whitespace + strips punctuation (except & / \' / -)', () => {
    expect(normalize('lay\'s   chips!!!')).toBe("lay's chips");
    expect(normalize('h&m')).toBe('h&m');
  });

  it('returns empty for falsy / non-string', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
    expect(normalize('')).toBe('');
  });
});

describe('withinOne (Levenshtein ≤ 1)', () => {
  it('equal strings', () => {
    expect(withinOne('starbucks', 'starbucks')).toBe(true);
  });

  it('single substitution', () => {
    expect(withinOne('starbucks', 'starbucks')).toBe(true);
    expect(withinOne('starbucks', 'starbukcs')).toBe(false); // 2 swaps, distance 2
    expect(withinOne('lavazza', 'lavarza')).toBe(true);
  });

  it('single insertion / deletion', () => {
    expect(withinOne('cerave', 'ceravex')).toBe(true);
    expect(withinOne('cerave', 'erave')).toBe(true);
  });

  it('distance > 1', () => {
    expect(withinOne('mcdonald', 'starbucks')).toBe(false);
  });
});

describe('matchBrand', () => {
  it('matches an exact unigram at confidence 1.0', () => {
    const result = matchBrand('grabbing a starbucks before work');
    expect(result[0]?.brand_key).toBe('starbucks');
    expect(result[0]?.confidence).toBe(1.0);
  });

  it('matches two-word brands via bigram lookup', () => {
    const result = matchBrand('ordered burger king last night');
    expect(result.some((m) => m.brand_key === 'burger_king')).toBe(true);
  });

  it('handles Turkish accents through normalization', () => {
    const result = matchBrand('Kahve Dünyası latte');
    expect(result.some((m) => m.brand_key === 'kahve_dunyasi')).toBe(true);
  });

  it('returns near-miss matches at lower confidence', () => {
    // "starbuckss" — one character off
    const result = matchBrand('grabbing a starbuckss');
    expect(result[0]?.brand_key).toBe('starbucks');
    expect(result[0]?.confidence).toBe(0.85);
  });

  it('returns [] for unmatched text', () => {
    expect(matchBrand('cooked dinner at home')).toEqual([]);
  });

  it('accepts a custom brand list', () => {
    const custom = [
      {
        key: 'ollie',
        display: 'Ollie',
        aliases: ['ollie'],
        category_l1: 'app',
        category_l2: 'lifestyle',
      },
    ];
    const result = matchBrand('opened ollie this morning', custom);
    expect(result[0]?.brand_key).toBe('ollie');
  });

  it('sorts by confidence descending', () => {
    const result = matchBrand('starbukss and a real coca cola');
    const scores = result.map((m) => m.confidence);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe('BRAND_SEED + BRAND_INDEX', () => {
  it('seed has multiple categories', () => {
    const cats = new Set(BRAND_SEED.map((b) => b.category_l1));
    expect(cats.size).toBeGreaterThan(5);
  });

  it('every alias is indexed (normalized)', () => {
    for (const b of BRAND_SEED) {
      for (const alias of b.aliases) {
        expect(BRAND_INDEX.has(normalize(alias))).toBe(true);
      }
    }
  });
});
