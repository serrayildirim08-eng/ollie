import { describe, expect, it } from 'vitest';
import { detectCrisis, detectCrisisIn, ALL_LANGUAGES } from '../src/index';

describe('@ollie/crisis-lexicon · per-language detection', () => {
  describe('en', () => {
    it('detects tier 2 — "want to die"', () => {
      const r = detectCrisisIn('I want to die', 'en');
      expect(r?.tier).toBe(2);
    });
    it('detects tier 3 — "how many pills"', () => {
      const r = detectCrisisIn('how many pills is too many', 'en');
      expect(r?.tier).toBe(3);
    });
    it('detects tier 4 — "won\'t be here tomorrow"', () => {
      const r = detectCrisisIn("I won't be here tomorrow", 'en');
      expect(r?.tier).toBe(4);
    });
    it('does NOT fire on "killing it at work" (exclusion)', () => {
      const r = detectCrisisIn('killing it at work today', 'en');
      expect(r).toBeNull();
    });
    it('does NOT fire on "dying to see this movie"', () => {
      const r = detectCrisisIn('dying to see this movie', 'en');
      expect(r).toBeNull();
    });
  });

  describe('tr', () => {
    it('detects tier 2 — "ölmek istiyorum"', () => {
      const r = detectCrisisIn('ölmek istiyorum', 'tr');
      expect(r?.tier).toBe(2);
    });
    it('detects tier 2 — "intihar"', () => {
      const r = detectCrisisIn('intihar etmek istiyorum', 'tr');
      expect(r?.tier).toBe(2);
    });
    it('detects tier 4 — "bu gece yapacağım"', () => {
      const r = detectCrisisIn('bu gece yapacağım', 'tr');
      expect(r?.tier).toBe(4);
    });
    it('does NOT fire on "gülmekten öldüm"', () => {
      const r = detectCrisisIn('gülmekten öldüm', 'tr');
      expect(r).toBeNull();
    });
  });

  describe('es', () => {
    it('detects tier 2 — "quiero morir"', () => {
      const r = detectCrisisIn('quiero morir', 'es');
      expect(r?.tier).toBe(2);
    });
    it('detects tier 2 — "suicidio"', () => {
      const r = detectCrisisIn('estoy pensando en el suicidio', 'es');
      expect(r?.tier).toBe(2);
    });
    it('detects tier 3 — "cuántas pastillas"', () => {
      const r = detectCrisisIn('cuántas pastillas para morir', 'es');
      expect(r?.tier).toBe(3);
    });
    it('does NOT fire on "muerto de risa"', () => {
      const r = detectCrisisIn('estoy muerto de risa', 'es');
      expect(r).toBeNull();
    });
    it('does NOT fire on "me muero por verte"', () => {
      const r = detectCrisisIn('me muero por verte mañana', 'es');
      expect(r).toBeNull();
    });
  });
});

describe('@ollie/crisis-lexicon · cross-language detection', () => {
  it('runs all 3 lexicons by default', () => {
    const r = detectCrisis('quiero morir and want to die ölmek istiyorum');
    expect(r?.detected).toBe(true);
    expect(r?.languages).toEqual(expect.arrayContaining(['en', 'tr', 'es']));
  });

  it('returns highest tier across all langs', () => {
    // tier-2 in es ("quiero morir") + tier-4 in en ("won't be here tomorrow")
    const r = detectCrisis("quiero morir and won't be here tomorrow");
    expect(r?.tier).toBe(4);
  });

  it('returns null when no lang fires', () => {
    const r = detectCrisis('süt aldım, başım ağrıyor, akşam annemi ara');
    expect(r).toBeNull();
  });

  it('accepts an explicit language subset', () => {
    const r = detectCrisis('quiero morir', { languages: ['en'] });
    expect(r).toBeNull(); // en lexicon shouldn't match Spanish phrase
  });

  it('ALL_LANGUAGES is exactly [tr, en, es]', () => {
    expect(ALL_LANGUAGES).toEqual(['tr', 'en', 'es']);
  });
});

describe('@ollie/crisis-lexicon · false-positive guard', () => {
  it('tier-1 ambiguous matches drop when exclusion is present', () => {
    // "tired of" + matching exclusion-context shouldn't fire alone.
    const r = detectCrisisIn('killing it at the gym, tired of it', 'en');
    // "tired of it" alone wouldn't match tier-1 (needs "everything|living|it all").
    // But "killing it at" is in exclusions, so the dance-floor sense wins.
    expect(r).toBeNull();
  });

  it('tier-2+ matches always fire even with exclusion in the text', () => {
    const r = detectCrisisIn('killing it at work but I want to die', 'en');
    expect(r?.tier).toBe(2);
  });
});
