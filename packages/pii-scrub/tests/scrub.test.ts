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
       
      console.warn(`PII scrub FN: ${totalMissed}/${totalExpected} = ${(fnRate * 100).toFixed(1)}%`);
      for (const m of misses) console.warn(' · ' + m);
    }
    expect(fnRate).toBeLessThan(0.10);
  });

  it('false-positive rate < 5% on clean samples', () => {
    let totalChecks = 0;
    const fps: string[] = [];

    for (const sample of golden.clean_samples) {
      totalChecks++;
      const { redactions } = scrubPII(sample.text, sample.locale);
      if (redactions.length > 0) {
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
       
      console.warn(`PII scrub FP: ${samplesWithFP.size}/${totalChecks} = ${(fpRate * 100).toFixed(1)}%`);
      for (const f of fps) console.warn(' · ' + f);
    }
    expect(fpRate).toBeLessThan(0.05);
  });
});

// ─── audit item #3 · capitalization heuristic for names not in wordlist ──────

describe('@ollie/pii-scrub · capitalized-name heuristic (audit #3)', () => {
  it('redacts a capitalized first+last name NOT in the wordlist', () => {
    // "Tyrnauq Velkorin" — neither token is on the compiled wordlist.
    const { scrubbed, redactions } = scrubPII('lunch with Tyrnauq Velkorin tomorrow', 'en');
    expect(scrubbed).not.toContain('Tyrnauq');
    expect(scrubbed).not.toContain('Velkorin');
    expect(redactions.filter((r) => r.type === 'NAME')).toHaveLength(2);
  });

  it('redacts a single capitalized name after a name-trigger word', () => {
    const { scrubbed } = scrubPII('met Devendra at the cafe', 'en');
    expect(scrubbed).not.toContain('Devendra');
    expect(scrubbed).toContain('[NAME]');
  });

  it('does NOT redact a lone capitalized word with no name context', () => {
    // No trigger word, not part of a capitalized run — left alone so
    // brand names (kept on purpose) and sentence-initial words survive.
    const { redactions } = scrubPII('Spotify renewed again this month', 'en');
    expect(redactions.filter((r) => r.type === 'NAME')).toHaveLength(0);
  });

  it('does NOT redact a capitalized geographic / stoplist word', () => {
    const { redactions } = scrubPII('flying from London with friends', 'en');
    expect(redactions.filter((r) => r.type === 'NAME')).toHaveLength(0);
  });

  it('does NOT redact a sentence-initial common word', () => {
    const { redactions } = scrubPII('Tomorrow I need to call the dentist', 'en');
    expect(redactions.filter((r) => r.type === 'NAME')).toHaveLength(0);
  });

  it('handles Turkish capitalized names with diacritics', () => {
    const { scrubbed, redactions } = scrubPII('Çağrı Öztürk ile toplantı var', 'tr');
    expect(scrubbed).not.toContain('Çağrı');
    expect(scrubbed).not.toContain('Öztürk');
    expect(redactions.filter((r) => r.type === 'NAME').length).toBeGreaterThanOrEqual(2);
  });

  it('all-lowercase corpus is unaffected by the heuristic (no regression)', () => {
    // The heuristic only fires on capitalized tokens; lowercase input
    // still relies purely on the wordlist pass.
    const { redactions } = scrubPII('matcha latte and olive oil for dinner', 'en');
    expect(redactions.filter((r) => r.type === 'NAME')).toHaveLength(0);
  });
});

// ─── B3-8 · expanded coverage — privacy-critical scrubber ─────────────────────

describe('@ollie/pii-scrub · layer ordering + composite input (B3-8)', () => {
  it('a URL containing an email keeps the host, never leaks the embedded email', () => {
    const { scrubbed } = scrubPII('signup at https://app.example.com/u/sarah@corp.com/done', 'en');
    expect(scrubbed).not.toContain('sarah@corp.com');
    expect(scrubbed).not.toContain('/u/');
    expect(scrubbed).toContain('https://app.example.com');
  });

  it('email + phone + address in one string are all redacted', () => {
    const { scrubbed, redactions } = scrubPII(
      'reach me at jane@mail.com or (212) 555-7788, I live at 88 Oak Avenue',
      'en',
    );
    const types = new Set(redactions.map((r) => r.type));
    expect(types.has('EMAIL')).toBe(true);
    expect(types.has('PHONE')).toBe(true);
    expect(types.has('ADDRESS')).toBe(true);
    expect(scrubbed).not.toContain('jane@mail.com');
    expect(scrubbed).not.toContain('555-7788');
  });

  it('redacts an E.164 international phone number', () => {
    const { scrubbed, redactions } = scrubPII('text +1 415 555 0199 when ready', 'en');
    expect(scrubbed).toContain('[PHONE]');
    expect(redactions.some((r) => r.type === 'PHONE')).toBe(true);
  });

  it('redacts multiple distinct emails in the same input', () => {
    const { scrubbed, redactions } = scrubPII('cc a@x.com and b@y.org', 'en');
    expect(scrubbed).not.toContain('a@x.com');
    expect(scrubbed).not.toContain('b@y.org');
    expect(redactions.filter((r) => r.type === 'EMAIL')).toHaveLength(2);
  });

  it('every redaction carries the verbatim original it replaced', () => {
    const { redactions } = scrubPII('email sarah@example.com now', 'en');
    const emailRedaction = redactions.find((r) => r.type === 'EMAIL');
    expect(emailRedaction?.original).toBe('sarah@example.com');
  });

  it('scrubbing is idempotent — a second pass redacts nothing new', () => {
    const once = scrubPII('mail me at carlos@mail.es and call 0532 111 2233', 'es');
    const twice = scrubPII(once.scrubbed, 'es');
    expect(twice.redactions).toHaveLength(0);
    expect(twice.scrubbed).toBe(once.scrubbed);
  });

  it('a 4-digit dollar amount is preserved but a bare 4-digit id is redacted', () => {
    const { scrubbed } = scrubPII('paid $1299 on account 8675 today', 'en');
    expect(scrubbed).toContain('$1299');
    expect(scrubbed).toContain('[NUMERIC]');
  });

  it('a fully clean sentence returns the input unchanged with no redactions', () => {
    const input = 'felt tired but did a short walk and journaled';
    const { scrubbed, redactions } = scrubPII(input, 'en');
    expect(scrubbed).toBe(input);
    expect(redactions).toHaveLength(0);
  });

  it('an empty string is handled without throwing', () => {
    const { scrubbed, redactions } = scrubPII('', 'en');
    expect(scrubbed).toBe('');
    expect(redactions).toHaveLength(0);
  });

  it('a first+last pair where only one token is wordlisted still redacts both', () => {
    // wordlist catches the common surname; the heuristic anchors off the
    // resulting [NAME] placeholder to catch the uncommon first name too.
    const { scrubbed } = scrubPII('lunch with Zephyrina Johnson', 'en');
    expect(scrubbed).not.toContain('Zephyrina');
    expect(scrubbed).not.toContain('Johnson');
  });

  it('redaction count is consistent with the placeholders in the output', () => {
    const { scrubbed, redactions } = scrubPII(
      'mike johnson emailed mike@corp.com about 1234567890',
      'en',
    );
    const placeholderCount = (scrubbed.match(/\[(EMAIL|PHONE|ADDRESS|NAME|GPS|NUMERIC)\]/g) ?? [])
      .length;
    // Every redaction leaves exactly one placeholder (URL keeps the host,
    // so URL is excluded from this invariant — none here).
    expect(placeholderCount).toBe(redactions.length);
  });

  it('GPS coordinates are redacted before a phone pass can mis-claim the digits', () => {
    const { scrubbed, redactions } = scrubPII('dropped pin at 40.7128, -74.0060', 'en');
    expect(scrubbed).toContain('[GPS]');
    expect(redactions.some((r) => r.type === 'GPS')).toBe(true);
    expect(redactions.some((r) => r.type === 'PHONE')).toBe(false);
  });

  it('a two-word capitalized city is over-redacted by the name heuristic (safe-direction)', () => {
    // Documented + accepted: the capitalized-RUN heuristic flags any
    // Capitalized 2-word pair, so "New York" mid-sentence becomes [NAME]
    // [NAME]. Over-redaction is the safe failure direction for a privacy
    // gate — a place name leaking is worse than a place name lost.
    const { scrubbed } = scrubPII('thinking about New York again', 'en');
    expect(scrubbed).not.toContain('New York');
    expect(scrubbed).toContain('[NAME]');
  });
});
