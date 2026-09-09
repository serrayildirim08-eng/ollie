/**
 * @ollie/crisis-lexicon
 *
 * Tiered crisis detection (TR/EN/ES) backing the brain-dump router's
 * parallel crisis classifier AND apps/native's client-side zero-network
 * safety net.
 *
 * IMPORTANT — false positives > false negatives. A wrongly-flagged dump
 * lands the user on the crisis screen with hotline numbers, which is a
 * recoverable inconvenience. A missed signal is not.
 *
 * @see ./types.ts for the lexicon + signal schemas.
 * @see ../data/lexicon.{tr,en,es}.json for source-of-truth content.
 *
 * Lexicons are PENDING_SERRA_APPROVAL — `last_reviewed_by` must be `@serra`
 * before any merge that ships to alpha.
 */

import enLexicon from '../data/lexicon.en.json' with { type: 'json' };
import trLexicon from '../data/lexicon.tr.json' with { type: 'json' };
import esLexicon from '../data/lexicon.es.json' with { type: 'json' };

import type {
  CrisisDetectOptions,
  CrisisSignal,
  LanguageLexicon,
  LexiconEntry,
  LexiconLanguage,
  SeverityTier,
} from './types';

export type {
  CrisisDetectOptions,
  CrisisSignal,
  LanguageLexicon,
  LexiconEntry,
  LexiconLanguage,
  SeverityTier,
  Citation,
} from './types';

const LEXICONS: Record<LexiconLanguage, LanguageLexicon> = {
  en: enLexicon as LanguageLexicon,
  tr: trLexicon as LanguageLexicon,
  es: esLexicon as LanguageLexicon,
};

export const ALL_LANGUAGES: readonly LexiconLanguage[] = ['tr', 'en', 'es'];

const TIERS: readonly SeverityTier[] = [1, 2, 3, 4];

/**
 * Compile a lexicon entry into a tester. Caches compiled regexes
 * module-side keyed by `${lang}:${tier}:${pattern}:${flags ?? 'i'}`.
 */
type CompiledEntry = {
  test: (text: string) => boolean;
  /** Locate the matched span [start, end) in `text`, or null if no match. */
  match: (text: string) => { start: number; end: number } | null;
  pattern: string;
};

const compileCache = new Map<string, CompiledEntry>();

function compile(
  lang: LexiconLanguage,
  tier: SeverityTier,
  entry: LexiconEntry,
): CompiledEntry {
  const key = `${lang}:${tier}:${entry.type}:${entry.pattern}:${entry.flags ?? 'i'}`;
  const cached = compileCache.get(key);
  if (cached) return cached;

  let test: (text: string) => boolean;
  let match: (text: string) => { start: number; end: number } | null;
  if (entry.type === 'regex') {
    const re = new RegExp(entry.pattern, entry.flags ?? 'i');
    test = (text) => re.test(text);
    match = (text) => {
      const m = re.exec(text);
      return m ? { start: m.index, end: m.index + m[0].length } : null;
    };
  } else {
    const lower = entry.pattern.toLowerCase();
    test = (text) => text.toLowerCase().includes(lower);
    match = (text) => {
      const idx = text.toLowerCase().indexOf(lower);
      return idx === -1 ? null : { start: idx, end: idx + lower.length };
    };
  }

  const compiled: CompiledEntry = { test, match, pattern: entry.pattern };
  compileCache.set(key, compiled);
  return compiled;
}

/**
 * Test a fragment against a single language lexicon.
 * Returns the HIGHEST matching tier and the first matching pattern within it.
 */
export function detectCrisisIn(
  text: string,
  language: LexiconLanguage,
): { tier: SeverityTier; pattern: string } | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const lex = LEXICONS[language];
  if (!lex) return null;

  // Exclusion guard — collect the span of EVERY exclusion literal present
  // in the text. A tier-1 match is suppressed ONLY when its own matched span
  // sits entirely inside an exclusion span (e.g. "killing it" swallowing a
  // dance-floor sense). A real tier-1 signal elsewhere in the same dump is
  // NOT suppressed just because an unrelated exclusion appears. Tier ≥ 2
  // always fires (false-positive over false-negative).
  const lowered = text.toLowerCase();
  const exclusionSpans: { start: number; end: number }[] = [];
  for (const ex of lex.exclusions) {
    const needle = ex.toLowerCase();
    let from = 0;
    let idx = lowered.indexOf(needle, from);
    while (idx !== -1) {
      exclusionSpans.push({ start: idx, end: idx + needle.length });
      from = idx + needle.length;
      idx = lowered.indexOf(needle, from);
    }
  }

  const inExclusion = (span: { start: number; end: number }): boolean =>
    exclusionSpans.some((ex) => span.start >= ex.start && span.end <= ex.end);

  // Walk tiers HIGH → LOW so we surface the most severe match first.
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const tier = TIERS[i];
    const tierEntries = lex.tiers[String(tier) as '1' | '2' | '3' | '4'];
    for (const entry of tierEntries) {
      const compiled = compile(language, tier, entry);
      if (compiled.test(text)) {
        // Tier-1: suppress only if THIS match's span is covered by an
        // exclusion. Tier ≥ 2 always fires.
        if (tier === 1 && exclusionSpans.length > 0) {
          const span = compiled.match(text);
          if (span && inExclusion(span)) continue;
        }
        return { tier, pattern: compiled.pattern };
      }
    }
  }

  return null;
}

/**
 * Detect crisis across all three languages in parallel (per the router brief —
 * mixed-language fragments must check ALL three lexicons regardless of the
 * dominant language).
 *
 * Returns a `CrisisSignal` keyed to the HIGHEST tier matched across all
 * langs, or `null` if no lexicon fired.
 */
export function detectCrisis(
  text: string,
  options: CrisisDetectOptions = {},
): CrisisSignal | null {
  const languages = options.languages ?? ALL_LANGUAGES;
  const matches: CrisisSignal['matches'] = [];

  for (const lang of languages) {
    const hit = detectCrisisIn(text, lang);
    if (hit) {
      // NEVER carry the matched raw text. Only lexicon coordinates
      // (tier + language + pattern id) cross the wire — returning the
      // matched line would leak crisis-dump content to the client and
      // break the zero-storage invariant (audit #77).
      matches.push({
        language: lang,
        tier: hit.tier,
        pattern: hit.pattern,
      });
    }
  }

  if (matches.length === 0) return null;

  const tier = matches.reduce<SeverityTier>(
    (max, m) => (m.tier > max ? m.tier : max),
    1,
  );

  return {
    detected: true,
    tier,
    languages: matches.map((m) => m.language),
    matches,
  };
}

/** Expose lexicon objects for tests + audit. Do not mutate. */
export function getLexicon(lang: LexiconLanguage): LanguageLexicon {
  return LEXICONS[lang];
}
