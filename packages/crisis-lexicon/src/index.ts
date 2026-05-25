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
  if (entry.type === 'regex') {
    const re = new RegExp(entry.pattern, entry.flags ?? 'i');
    test = (text) => re.test(text);
  } else {
    const lower = entry.pattern.toLowerCase();
    test = (text) => text.toLowerCase().includes(lower);
  }

  const compiled: CompiledEntry = { test, pattern: entry.pattern };
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

  // Exclusion guard — if ANY exclusion literal matches the text,
  // require a stronger signal to override. Implementation: track
  // whether an exclusion matched; if it did, only tier ≥ 2 counts.
  const lowered = text.toLowerCase();
  let exclusionHit = false;
  for (const ex of lex.exclusions) {
    if (lowered.includes(ex.toLowerCase())) {
      exclusionHit = true;
      break;
    }
  }

  // Walk tiers HIGH → LOW so we surface the most severe match first.
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const tier = TIERS[i];
    const tierEntries = lex.tiers[String(tier) as '1' | '2' | '3' | '4'];
    for (const entry of tierEntries) {
      const compiled = compile(language, tier, entry);
      if (compiled.test(text)) {
        // Exclusion guard: tier-1 hits suppressed if an exclusion matched.
        // Tier ≥ 2 always fires (false-positive over false-negative).
        if (exclusionHit && tier === 1) continue;
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
      matches.push({
        language: lang,
        tier: hit.tier,
        pattern: hit.pattern,
        line: extractMatchedLine(text, hit.pattern),
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

/**
 * Best-effort: pull the first line containing the matched pattern. Falls
 * back to the first non-empty line.
 */
function extractMatchedLine(text: string, pattern: string): string {
  const lines = text.split(/\r?\n/);
  try {
    const re = new RegExp(pattern, 'i');
    for (const line of lines) {
      if (re.test(line)) return line.trim();
    }
  } catch {
    /* fallthrough — pattern is literal, find by substring */
    const lowered = pattern.toLowerCase();
    for (const line of lines) {
      if (line.toLowerCase().includes(lowered)) return line.trim();
    }
  }
  return lines.find((l) => l.trim().length > 0)?.trim() ?? text.trim();
}

/** Expose lexicon objects for tests + audit. Do not mutate. */
export function getLexicon(lang: LexiconLanguage): LanguageLexicon {
  return LEXICONS[lang];
}
