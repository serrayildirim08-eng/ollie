/**
 * ConsentStep · banned-phrase audit
 *
 * Sprint B' (pivot 2026-05-14) acceptance: copy must not contain
 * "great job", "you should", "miss", or "streak". Per Serra's tone
 * lock (no shame, no urgency, no marketing puffery).
 *
 * This test grep-scans the source file directly so that future copy
 * edits — including any line that didn't go through a review — still
 * trip CI.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(__dirname, './ConsentStep.tsx'),
  'utf8',
);

// Limit the scan to user-facing copy region (the COPY const block).
// We avoid scanning the whole file because the variable name "miss"
// or "should" could legitimately appear in inline comments — copy is
// what the user sees, comments are not.
function extractCopyBlock(src: string): string {
  const start = src.indexOf('const COPY');
  expect(start, 'COPY block must exist').toBeGreaterThan(-1);
  const end = src.indexOf('} as const;', start);
  expect(end, 'COPY block must terminate').toBeGreaterThan(start);
  return src.slice(start, end);
}

const COPY_BLOCK = extractCopyBlock(SOURCE);

describe('ConsentStep · banned-phrase audit', () => {
  // notif-scope-allow — test asserts these phrases are ABSENT from copy
  const banned = ['great job', 'you should', 'streak'];
  for (const phrase of banned) {
    it(`does not contain "${phrase}"`, () => {
      expect(COPY_BLOCK.toLowerCase()).not.toContain(phrase);
    });
  }

  // "miss" is banned standalone; allow words that *contain* miss
  // (commission, dismiss, etc.) but flag any whole-word use.
  it('does not contain the word "miss" as a standalone token', () => {
    const re = /\bmiss(?:ed|ing)?\b/i;
    expect(re.test(COPY_BLOCK)).toBe(false);
  });

  it('is all-lowercase prose (no shouting, no title case headlines)', () => {
    // Allow proper-noun-free copy. Headlines render in serif but the
    // string itself stays lowercase.
    const titles = COPY_BLOCK.match(/'[A-Z][^']*'/g) ?? [];
    expect(titles, `unexpected uppercase strings: ${titles.join(', ')}`)
      .toHaveLength(0);
  });

  it('contains no exclamation marks', () => {
    expect(COPY_BLOCK).not.toContain('!');
  });
});

describe('ConsentStep · contract markers', () => {
  it('exports ConsentStep + ConsentStepProps + ConsentStepSource', () => {
    expect(SOURCE).toContain('export function ConsentStep');
    expect(SOURCE).toContain('export interface ConsentStepProps');
    expect(SOURCE).toContain('export type ConsentStepSource');
  });

  it('emits consent:set event with all four payload fields', () => {
    expect(SOURCE).toContain("emitEvent('consent:set'");
    expect(SOURCE).toMatch(/necessary:\s*true/);
    expect(SOURCE).toMatch(/marketing:/);
    expect(SOURCE).toMatch(/research_optin:/);
    expect(SOURCE).toMatch(/source,/);
  });

  it('imports setConsent from @ollie/consent (not local stub)', () => {
    expect(SOURCE).toMatch(/from '@ollie\/consent'/);
    expect(SOURCE).toContain('setConsent');
  });
});
