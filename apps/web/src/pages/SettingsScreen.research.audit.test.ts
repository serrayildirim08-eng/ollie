/**
 * SettingsScreen.ResearchSection · banned-phrase audit (Sprint B'' Item 1)
 *
 * Mirrors apps/web/src/screens/onboarding/ConsentStep.audit.test.ts.
 * Scans the source file for the user-facing copy in the research opt-in
 * row + inline confirmation lines and asserts:
 *   - no "great job", "you should", "miss", "streak"
 *   - no exclamation marks in the copy region
 *
 * Future copy edits trip this scan before reaching review.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(__dirname, './SettingsScreen.tsx'),
  'utf8',
);

/**
 * Extract the ResearchSection user-facing copy. Scope is the body of the
 * exported function up to the next "// ─── … section" divider so copy in
 * PrivacySection / About (unrelated to this sprint) doesn't trip the scan.
 */
function extractResearchCopy(src: string): string {
  const start = src.indexOf('export function ResearchSection');
  expect(start, 'ResearchSection must exist').toBeGreaterThan(-1);
  const after = src.slice(start + 100); // skip header
  const endRel = after.search(/\n\/\/ ─{3,}.*section/i);
  expect(endRel, 'ResearchSection must be followed by another section').toBeGreaterThan(-1);
  return src.slice(start, start + 100 + endRel);
}

const COPY_BLOCK = extractResearchCopy(SOURCE);

describe('ResearchSection · banned-phrase audit', () => {
  // notif-scope-allow — test asserts these phrases are ABSENT from copy
  const banned = ['great job', 'you should', 'streak'];
  for (const phrase of banned) {
    it(`does not contain "${phrase}"`, () => {
      expect(COPY_BLOCK.toLowerCase()).not.toContain(phrase);
    });
  }

  // "miss" is banned standalone; allow words containing miss (dismiss,
  // permission, commission, mission). Whole-word check only.
  it('does not contain the word "miss" as a standalone token', () => {
    const re = /\bmiss(?:ed|ing)?\b/i;
    expect(re.test(COPY_BLOCK)).toBe(false);
  });

  it('contains no exclamation marks in user-facing JSX text', () => {
    // Match JSX text-nodes — content between > and < that contains a space
    // (a real sentence, not a JSX expression boundary).
    const textNodes = COPY_BLOCK.match(/>[^<>{}]*[a-z][^<>{}]*</gi) ?? [];
    for (const node of textNodes) {
      if (!node.trim() || node.length < 4) continue;
      expect(node, `unexpected "!" in JSX text: ${node}`).not.toContain('!');
    }
  });
});

describe('ResearchSection · contract markers', () => {
  it('imports setConsent + getConsent from @ollie/consent', () => {
    expect(SOURCE).toMatch(/from '@ollie\/consent'/);
    expect(SOURCE).toContain('getConsent');
    expect(SOURCE).toContain('setConsent');
  });

  it('renders the canonical research opt-in copy', () => {
    expect(COPY_BLOCK).toContain('research opt-in');
    expect(COPY_BLOCK).toContain('your anonymized text helps us find adhd patterns');
    expect(COPY_BLOCK).toContain('off. no new text gets labeled');
    expect(COPY_BLOCK).toContain('on. anonymized text helps train ollie');
  });

  it('has a section header reading "research data"', () => {
    expect(COPY_BLOCK).toContain('research data');
  });

  it('confirmation line is rendered inline (role="status"), not a modal', () => {
    expect(COPY_BLOCK).toContain('role="status"');
    const sectionMatches = COPY_BLOCK.match(/role="dialog"/g) ?? [];
    expect(sectionMatches.length).toBe(0);
  });

  it('ResearchSection is exported (testability)', () => {
    expect(SOURCE).toContain('export function ResearchSection');
    expect(SOURCE).toContain('export interface ResearchSectionProps');
  });
});
