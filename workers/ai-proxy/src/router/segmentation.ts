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

/**
 * Same alternation, but CAPTURING the conjunction (with its surrounding
 * whitespace) so we can re-join across a boundary we decide is NOT an intent
 * split — keeping the user's wording verbatim ("mac and cheese" stays one).
 */
const CONJ_SPLIT_RE = new RegExp(
  `(\\s+(?:${[...CONJUNCTIONS_TR, ...CONJUNCTIONS_EN, ...CONJUNCTIONS_ES].join('|')})\\s+)`,
  'gi',
);

const TERMINAL_PUNCT_RE = /[.!?…;]$/;

/**
 * A comma acting as a LIST delimiter — i.e. not a thousands/decimal separator
 * inside a number ("$1,500", "1,000 ml"). Mirrors the native client's
 * splitGroceryList guard so the two layers agree on what a list comma is.
 */
const LIST_COMMA_RE = /,(?=\s*(?:\D|$))/;

/**
 * Lightweight trilingual VERB / predicate signal. The ONE job of this detector
 * is to answer "does this span carry its own intent (a verb), or is it a bare
 * noun phrase (a list member / compound name)?". It drives the list-vs-clause
 * decision in pass-1.
 *
 * Coverage is deliberately partial and FAIL-SAFE: a missed verb makes a span
 * read as "bare", which biases toward KEEPING TEXT TOGETHER (no split, no data
 * loss). The dangerous direction would be a false positive that splits a list
 * member off on its own — but list members are nouns without verbs, so that
 * almost never fires. We therefore over-include common action verbs (so real
 * multi-intent dumps still split) and accept that exotic verbs merge instead.
 */
const VERB_WORDS = [
  // EN — high-frequency dump verbs, base + common inflections
  'bought', 'buy', 'buying', 'got', 'get', 'getting', 'grab', 'grabbed',
  'need', 'needed', 'want', 'wanted', 'pick', 'picked', 'paid', 'pay',
  'call', 'called', 'calling', 'text', 'texted', 'email', 'emailed',
  'made', 'make', 'did', 'do', 'doing', 'done', 'went', 'go', 'going',
  'clean', 'cleaned', 'vacuum', 'vacuumed', 'took', 'take', 'taken',
  'finish', 'finished', 'send', 'sent', 'wrote', 'write', 'book', 'booked',
  'remind', 'forgot', 'forget', 'skipped', 'started', 'spent', 'felt', 'feel',
  // ES
  'compré', 'comprar', 'llamé', 'llamar', 'necesito', 'necesita',
  'fui', 'hice', 'hacer', 'limpié', 'tomé', 'pagué', 'olvidé', 'tengo',
  // TR particles / auxiliaries that mark a predicate
  'lazım', 'gerek', 'istiyorum', 'aldım', 'aramam', 'yaptım',
];

const VERB_WORD_RE = new RegExp(`\\b(?:${VERB_WORDS.join('|')})\\b`, 'i');

/**
 * Turkish is agglutinative — most predicates are a single inflected word rather
 * than a listed lexeme, so we detect them MORPHOLOGICALLY: past tense
 * (-dı/-di/-du/-dü/-tı/-ti/-tu/-tü + optional person), the necessitative
 * (-malı/-meli, "-mam/-mem lazım"), and the future/aorist. Anchored to a word
 * end so a bare noun like "süt" or "yumurta" never matches.
 */
const TR_VERB_MORPH_RE =
  /\w+(?:d[ıiuü]|t[ıiuü])(?:m|n|k|nız|niz|nuz|nüz|lar|ler)?\b|\w+m[ae](?:lı|li)\b|\w+(?:ı|i|u|ü)yorum?\b|\w+m[ae]m\b/i;

function hasVerbSignal(span: string): boolean {
  return VERB_WORD_RE.test(span) || TR_VERB_MORPH_RE.test(span);
}

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
    const parts = clauseSplit(sentence);

    for (const part of parts) {
      const wordCount = countWords(part);
      const hasConjunction = CONJ_RE.test(part);
      // CONJ_RE has the /g flag — reset lastIndex so the next .test() works.
      CONJ_RE.lastIndex = 0;
      const hasTerminalPunct = TERMINAL_PUNCT_RE.test(part);

      // An enumeration ("milk, eggs, batteries, detergent to buy") is ONE intent
      // unit that the classifier + the client's splitGroceryList itemize
      // deterministically. Never hand it to the pass-2 LLM, which would risk
      // shattering the list back into orphan noun fragments (the original bug).
      const needsPass2 =
        !isEnumeration(part) &&
        (wordCount > 7 ||
          (wordCount > 4 && !hasConjunction && !hasTerminalPunct));

      fragments.push({ text: part, wordCount, needsPass2 });
    }
  }

  return {
    fragments,
    needsPass2Count: fragments.filter((f) => f.needsPass2).length,
  };
}

/**
 * Split a sentence into intent units at conjunction boundaries — but ONLY where
 * the conjunction is a genuine INTENT BOUNDARY, not a LIST/COMPOUND joiner.
 *
 * Key heuristic (the whole point of this function):
 *   Split at a conjunction iff BOTH sides carry their own verb (are
 *   "clause-like"). If either side is a bare noun phrase, the conjunction is
 *   joining list members or a compound name, so we KEEP the text together.
 *
 *   - "bought milk and called mom"  → both sides have a verb → SPLIT (2 units)
 *   - "I need milk, eggs and bread" → "bread" has no verb → KEEP (one list)
 *   - "süt, yumurta ve ekmek almam lazım" → "süt, yumurta" has no verb → KEEP
 *   - "mac and cheese" / "salt and pepper" → neither side a verb → KEEP
 *
 * Failure-safe: when a verb is unrecognised a side reads as "bare", which biases
 * toward KEEPING text together (no data loss) rather than shattering a list.
 */
function clauseSplit(sentence: string): string[] {
  // tokens = [seg0, conj1, seg1, conj2, seg2, ...] — conjunctions captured so a
  // non-split boundary can be re-joined verbatim (keeps "mac and cheese" intact).
  const tokens = sentence.split(CONJ_SPLIT_RE);
  if (tokens.length <= 1) {
    const t = sentence.trim();
    return t.length > 0 ? [t] : [];
  }

  const out: string[] = [];
  let current = tokens[0];
  for (let i = 1; i < tokens.length; i += 2) {
    const conj = tokens[i];
    const next = tokens[i + 1] ?? '';
    // Only a boundary between two clause-like spans is a real intent split.
    if (hasVerbSignal(current) && hasVerbSignal(next)) {
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = next;
    } else {
      // List joiner / compound name → re-join verbatim, conjunction included.
      current = current + conj + next;
    }
  }
  const tail = current.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * An ENUMERATION is a comma list of short noun phrases governed by at most one
 * verb (e.g. "milk, eggs, batteries, detergent to buy" — a single buy intent,
 * four items). It is one intent unit; splitting it loses items.
 *
 * Detection: a list comma is present AND at most ONE comma-member is clause-like
 * (carries a verb). Two or more verb-bearing members means it's a run of clauses
 * ("süt aldım, eve gittim ve yattım"), not a shopping list — leave that to the
 * normal split / pass-2 path.
 */
function isEnumeration(text: string): boolean {
  if (!LIST_COMMA_RE.test(text)) return false;
  const members = text.split(LIST_COMMA_RE);
  if (members.length < 2) return false;
  let clauseLike = 0;
  for (const m of members) {
    if (hasVerbSignal(m)) clauseLike++;
    if (clauseLike > 1) return false;
  }
  return true;
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
