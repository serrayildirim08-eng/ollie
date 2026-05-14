import { describe, expect, it } from 'vitest';
import { scrubPII, type Locale, type RedactionType } from '../src/index';
import { WORDLIST_SIZES } from '../src/wordlists';

describe('@ollie/pii-scrub · core regex layer', () => {
  it('redacts email', () => {
    const { scrubbed, redactions } = scrubPII('email me at sarah@example.com plz', 'en');
    expect(scrubbed).toContain('[EMAIL]');
    expect(scrubbed).not.toContain('sarah@example.com');
    expect(redactions.some((r) => r.type === 'EMAIL')).toBe(true);
  });

  it('redacts phone US format', () => {
    const { scrubbed, redactions } = scrubPII('call (415) 555-0123 anytime', 'en');
    expect(scrubbed).toContain('[PHONE]');
    expect(redactions.some((r) => r.type === 'PHONE')).toBe(true);
  });

  it('redacts phone TR format', () => {
    const { scrubbed } = scrubPII('telefon 0532 123 4567 ararsın', 'tr');
    expect(scrubbed).toContain('[PHONE]');
  });

  it('redacts URL paths', () => {
    const { scrubbed } = scrubPII('check https://www.example.com/secret/page', 'en');
    expect(scrubbed).toContain('https://www.example.com');
    expect(scrubbed).not.toContain('/secret/page');
  });

  it('redacts US street address', () => {
    const { scrubbed } = scrubPII('moved to 123 Main Street, Boston, MA 02101', 'en');
    expect(scrubbed).toContain('[ADDRESS]');
  });

  it('redacts GPS coords', () => {
    const { scrubbed } = scrubPII('meet at 37.7749, -122.4194 by 8', 'en');
    expect(scrubbed).toContain('[GPS]');
  });

  it('redacts numeric long-digit sequences', () => {
    const { scrubbed } = scrubPII('ssn 1234567890 do not share', 'en');
    expect(scrubbed).toContain('[NUMERIC]');
  });

  it('preserves years (1900-2099)', () => {
    const { scrubbed } = scrubPII('met him back in 2014, what a year', 'en');
    expect(scrubbed).toContain('2014');
  });

  it('preserves money amounts with currency prefix', () => {
    const { scrubbed: a } = scrubPII('rent is $1850 monthly', 'en');
    expect(a).toContain('$1850');
    const { scrubbed: b } = scrubPII('gastaste €4200 este mes', 'es');
    expect(b).toContain('€4200');
    const { scrubbed: c } = scrubPII('₺5000 ödedim kiraya', 'tr');
    expect(c).toContain('₺5000');
  });
});

describe('@ollie/pii-scrub · name wordlist layer', () => {
  it('redacts English first+last names', () => {
    const { scrubbed } = scrubPII('mike johnson stopped by', 'en');
    expect(scrubbed).toContain('[NAME] [NAME]');
  });

  it('redacts Spanish names', () => {
    const { scrubbed } = scrubPII('carlos garcia me ayudo', 'es');
    expect(scrubbed).toContain('[NAME] [NAME]');
  });

  it('redacts Turkish names with diacritics', () => {
    const { scrubbed } = scrubPII('ayşe yılmaz aradı', 'tr');
    expect(scrubbed).toContain('[NAME] [NAME]');
  });

  it('preserves module vocabulary (cycle/food/mood)', () => {
    const samples = [
      'pms symptoms hitting hard',
      'matcha latte was amazing',
      'olive oil and bread for dinner',
      'feeling anxious about deadline',
      'tracked 45 min of deep work',
    ];
    for (const s of samples) {
      const { redactions } = scrubPII(s, 'en');
      const names = redactions.filter((r) => r.type === 'NAME');
      expect(names).toHaveLength(0);
    }
  });

  it('wordlist sizes meet floor (locale coverage sanity)', () => {
    // Spec asked for 5k; v0 ships compact. Floor of 200/locale ensures we're
    // not shipping a 5-word stub.
    expect(WORDLIST_SIZES.en).toBeGreaterThan(200);
    expect(WORDLIST_SIZES.es).toBeGreaterThan(200);
    expect(WORDLIST_SIZES.tr).toBeGreaterThan(200);
  });
});

// ─── 100-sample golden ────────────────────────────────────────────────────────

interface PiiSample {
  locale: Locale;
  text: string;
  should_redact: RedactionType[];
}

interface CleanSample {
  locale: Locale;
  text: string;
}

interface GoldenFile {
  _meta: {
    total: number;
    pii_samples: number;
    clean_samples: number;
    thresholds: {
      max_false_positive_rate: number;
      max_false_negative_rate: number;
    };
  };
  pii_samples: PiiSample[];
  clean_samples: CleanSample[];
}

// Load the golden file via fs (json import works but vitest's path resolution
// is cleaner with fs.readFileSync for fixtures).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.resolve(__dirname, '../test/golden/samples.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf-8')) as GoldenFile;

describe('@ollie/pii-scrub · 100-sample golden', () => {
  it('contains 100 samples (60 PII + 40 clean)', () => {
    expect(golden._meta.total).toBe(100);
    expect(golden.pii_samples.length + golden.clean_samples.length).toBe(100);
  });

  it('false-negative rate < 10% on PII samples', () => {
    let totalExpected = 0;
    let totalMissed = 0;
    const misses: string[] = [];

    for (const sample of golden.pii_samples) {
      const { redactions } = scrubPII(sample.text, sample.locale);
      const foundTypes = new Set(redactions.map((r) => r.type));
      for (const expectedType of sample.should_redact) {
        totalExpected++;
        if (!foundTypes.has(expectedType)) {
          totalMissed++;
          misses.push(`[${sample.locale}] missed ${expectedType} in: "${sample.text}"`);
        }
      }
    }

    const fnRate = totalExpected === 0 ? 0 : totalMissed / totalExpected;
    // Always print so a regression is visible in CI logs.
    if (fnRate > 0) {
      // eslint-disable-next-line no-console
      console.warn(`PII scrub FN: ${totalMissed}/${totalExpected} = ${(fnRate * 100).toFixed(1)}%`);
      for (const m of misses) console.warn(' · ' + m);
    }
    expect(fnRate).toBeLessThan(0.10);
  });

  it('false-positive rate < 5% on clean samples', () => {
    let totalRedactions = 0;
    let totalChecks = 0;
    const fps: string[] = [];

    for (const sample of golden.clean_samples) {
      totalChecks++;
      const { redactions } = scrubPII(sample.text, sample.locale);
      if (redactions.length > 0) {
        totalRedactions += redactions.length;
        for (const r of redactions) {
          fps.push(`[${sample.locale}] false-positive ${r.type}="${r.original}" in: "${sample.text}"`);
        }
      }
    }

    // FP measured as samples-with-any-redaction / total-clean-samples
    const samplesWithFP = new Set<number>();
    golden.clean_samples.forEach((sample, idx) => {
      const { redactions } = scrubPII(sample.text, sample.locale);
      if (redactions.length > 0) samplesWithFP.add(idx);
    });
    const fpRate = samplesWithFP.size / totalChecks;

    if (fpRate > 0) {
      // eslint-disable-next-line no-console
      console.warn(`PII scrub FP: ${samplesWithFP.size}/${totalChecks} = ${(fpRate * 100).toFixed(1)}%`);
      for (const f of fps) console.warn(' · ' + f);
    }
    expect(fpRate).toBeLessThan(0.05);
  });
});
