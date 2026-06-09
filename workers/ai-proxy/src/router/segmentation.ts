/**
 * Brain-dump segmentation · Pass 1 (regex / Intl.Segmenter) + pass-2 trigger.
 *
 * Pass 1 pipeline:
 *   1. Intl.Segmenter (granularity: 'sentence') splits on locale-aware
 *      sentence boundaries — handles "Dr.", "vb." etc better than naive regex.
 *   2. Trilingual conjunction overlay re-splits each sentence on
 *      ve/ile/ama/veya/ya da/fakat (tr) · and/but/or/so/then (en) ·
 *      y/e/pero/o/u/sino (es).
 *   3. Trim, drop empties.
 *
 * Pass 2 trigger (Decision A — word-count-only, no verb-anchor heuristic):
 *   - fragment.words > 7  OR
 *   - (fragment.words > 4 AND no conjunctions AND no terminal punctuation)
 *
 * Pass 2 itself lives in segmentation-llm.ts and uses Gemini Flash with
 * a JSON-array response_schema (Decision C).
 *
 * Cache policy (per brief): pass-2 output is NEVER cached. Only the
 * final per-fragment classification goes into routing_cache.
 */

/**
 * Conjunctions used for in-sentence re-splitting. Case-insensitive, word-boundaried.
 * Order matters for regex alternation — longer first when they overlap.
 */
const CONJUNCTIONS_TR = ['ya\\s+da', 'veya', 'fakat', 'ama', 'ile', 've'];
const CONJUNCTIONS_EN = ['and', 'but', 'or', 'so', 'then'];
const CONJUNCTIONS_ES = ['pero', 'sino', 'y', 'e', 'o', 'u'];

/**
 * One regex that matches any trilingual conjunction with whitespace
 * boundaries. Used to split at the conjunction position (the conjunction
 * itself is dropped — it lives at the join, not in either side).
 */
const CONJ_RE = new RegExp(
  `\\s+(?:${[...CONJUNCTIONS_TR, ...CONJUNCTIONS_EN, ...CONJUNCTIONS_ES].join('|')})\\s+`,
  'gi',
);

const TERMINAL_PUNCT_RE = /[.!?…;]$/;

/**
 * Split a dump into pass-1 fragments.
 *
 * Returns `{ fragments, needsPass2 }` where `needsPass2` flags entries
 * that should be sent to Gemini for further splitting per Decision A.
 *
 * @param dump   raw user text
 * @param locale BCP-47 locale hint; defaults to 'tr' (Serra's primary) but
 *               the Intl.Segmenter sentence break is fairly locale-tolerant.
 */
export function pass1Segment(
  dump: string,
  locale: string = 'tr',
): Pass1Result {
  const sentences = sentenceSplit(dump, locale);
  const fragments: Pass1Fragment[] = [];

  for (const sentence of sentences) {
    const parts = sentence.split(CONJ_RE).map((s) => s.trim()).filter((s) => s.length > 0);

    for (const part of parts) {
      const wordCount = countWords(part);
      const hasConjunction = CONJ_RE.test(part);
      // CONJ_RE has the /g flag — reset lastIndex so the next .test() works.
      CONJ_RE.lastIndex = 0;
      const hasTerminalPunct = TERMINAL_PUNCT_RE.test(part);

      const needsPass2 =
        wordCount > 7 ||
        (wordCount > 4 && !hasConjunction && !hasTerminalPunct);

      fragments.push({ text: part, wordCount, needsPass2 });
    }
  }

  return {
    fragments,
    needsPass2Count: fragments.filter((f) => f.needsPass2).length,
  };
}

/**
 * Locale-aware sentence break via Intl.Segmenter. Falls back to a naive
 * regex split if the runtime doesn't support sentence granularity (we
 * verified workerd does, but defense in depth).
 */
function sentenceSplit(text: string, locale: string): string[] {
  try {
    const seg = new Intl.Segmenter(locale, { granularity: 'sentence' });
    return [...seg.segment(text)].map((s) => s.segment.trim()).filter((s) => s.length > 0);
  } catch {
    return text
      .split(/(?<=[.!?…])\s+|\r?\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}

function countWords(s: string): number {
  return s.split(/\s+/).filter((w) => w.length > 0).length;
}

export interface Pass1Fragment {
  text: string;
  wordCount: number;
  needsPass2: boolean;
}

export interface Pass1Result {
  fragments: Pass1Fragment[];
  needsPass2Count: number;
}
