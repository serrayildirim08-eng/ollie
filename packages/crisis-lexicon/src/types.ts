/**
 * @ollie/crisis-lexicon · types
 *
 * Tier system aligned with Crisis Text Line public taxonomy
 * + 988 Suicide & Crisis Lifeline guidance
 * + WHO Public Health Action for the Prevention of Suicide (2012)
 * + Klonsky & May 2014 (Three-Step Theory, 3ST) ideation→action framework.
 *
 * Error on the side of FALSE POSITIVES over false negatives.
 */

export type LexiconLanguage = 'tr' | 'en' | 'es';

/** 1 = ambiguous distress / 2 = ideation / 3 = method-seeking / 4 = imminent. */
export type SeverityTier = 1 | 2 | 3 | 4;

export interface LexiconEntry {
  /** Pattern source. */
  pattern: string;
  /** 'literal' = case-insensitive substring match. 'regex' = applied with `flags`. */
  type: 'literal' | 'regex';
  /** RegExp flags when `type === 'regex'`. Default 'i'. */
  flags?: string;
  /** Short note explaining the entry. Lives in JSON for greppability. */
  note?: string;
  /** Clinical citation ids that justify the entry (see `citations` block). */
  sources?: string[];
}

export interface Citation {
  id: string;
  title: string;
  url?: string;
  year?: number;
}

export interface LanguageLexicon {
  language: LexiconLanguage;
  version: string;
  last_reviewed_by: string;
  last_reviewed_at: string; // ISO date — when @serra last approved
  tiers: {
    /** Ambiguous distress — single-step from baseline. */
    '1': LexiconEntry[];
    /** Ideation — explicit thought of dying / self-harm. */
    '2': LexiconEntry[];
    /** Method-seeking — exploring how / what means. */
    '3': LexiconEntry[];
    /** Imminent — temporal commitment + means in hand. */
    '4': LexiconEntry[];
  };
  /**
   * False-positive guards. If a fragment matches an exclusion AND a tier,
   * the match is dropped UNLESS another non-excluded match also fires.
   * Literal substring, case-insensitive.
   */
  exclusions: string[];
  citations: Citation[];
}

export interface CrisisSignal {
  detected: true;
  /** Highest tier matched across all language lexicons run on this text. */
  tier: SeverityTier;
  /** Which lexicons fired. */
  languages: LexiconLanguage[];
  /** First matched entry per lexicon, for audit. */
  matches: Array<{
    language: LexiconLanguage;
    tier: SeverityTier;
    pattern: string;
    line: string;
  }>;
}

export interface CrisisDetectOptions {
  /**
   * Languages to test against. If omitted, runs ALL three in parallel
   * (required by router brief: mixed-language fragments must check ALL).
   */
  languages?: LexiconLanguage[];
}
