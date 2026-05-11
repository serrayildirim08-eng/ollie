import type { CrisisDetectResult } from './types';

/**
 * Matches explicit self-harm / suicidal-ideation phrases in EN and TR.
 *
 * Design notes:
 * - ASCII phrases are \b-anchored to avoid false positives inside larger words
 *   (e.g. "kill it on the dance floor" won't match because "kill" alone is NOT
 *   in the list — only "kill myself" is).
 * - Turkish phrases that start with non-ASCII characters (ö, ü…) use a
 *   `(?:^|(?<=\s))` prefix instead of \b, because JS \b is ASCII-only and
 *   treats ö as a non-word char, making `\b` before it always false.
 *   `(?<=\s)` is a lookbehind — supported in V8/Node ≥ 9.6.
 * - `suicid\w*` covers "suicidal", "suicide", "suicidality".
 * - `self.?harm` covers "self harm", "self-harm", "selfharm".
 * - `end\s+(?:it|my\s+life)` requires the full phrase.
 * - `can'?t\s+take\s+it\s+anymore` and `want\s+to\s+die` are included as
 *   they unambiguously signal distress when taken literally.
 */

// EN + ASCII-starting TR phrases — safe to \b-anchor.
const ASCII_CRISIS_RE =
  /\b(intihar|kendime\s+zarar|olmak\s+istemiyorum|son\s+verme|yokum\s+daha\s+iyi|want\s+to\s+die|can'?t\s+take\s+it\s+anymore|harming\s+myself|kill\s+myself|end\s+(?:it|my\s+life)|don'?t\s+want\s+to\s+be\s+here|suicid\w*|self.?harm|hurt\s+myself)\b/i;

// Non-ASCII-starting TR phrases — use lookbehind for word-boundary equivalent.
const TR_UNICODE_CRISIS_RE =
  /(?:^|(?<=\s))(?:öldürme(?:k)?\s+istiyorum)/i;

export const CRISIS_RE: RegExp = ASCII_CRISIS_RE;

/**
 * Tests `text` against both CRISIS_RE (ASCII) and TR_UNICODE_CRISIS_RE.
 *
 * Returns `{ match: true, line: <first matching line> }` or
 * `{ match: false, line: '' }`.
 *
 * Pure function — no side effects, no I/O.
 */
export function detectCrisis(text: string): CrisisDetectResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { match: false, line: '' };
  }
  const lines = text.split('\n');
  for (const line of lines) {
    if (ASCII_CRISIS_RE.test(line) || TR_UNICODE_CRISIS_RE.test(line)) {
      return { match: true, line };
    }
  }
  return { match: false, line: '' };
}
