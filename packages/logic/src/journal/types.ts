/**
 * @ollie/logic · journal types
 *
 * No I/O. No DOM. No wall-clock reads.
 */

// ─── Span ─────────────────────────────────────────────────────────────

export interface Span {
  start: number;
  end: number;
}

export interface SpanWithText extends Span {
  text: string;
}

// ─── Extraction ───────────────────────────────────────────────────────

export interface TimeAnchor {
  iso: string | null;
  text: string;
}

export interface ModuleHint {
  module: string;
  hint: string | null;
}

export interface JournalEntry {
  span: Span;
  summary: string | null;
  people: string[];
  places: string[];
  emotions: string[];
  questions: string[];
  decisions: string[];
  time_anchors: TimeAnchor[];
  module_hints: ModuleHint[];
}

export interface ExtractionPrompt {
  system: string;
  messages: Array<{ role: 'user'; content: string }>;
  max_tokens: number;
  model: string;
}

export interface RuleBasedResult {
  state: 'extracted-rule-based';
  extractor_version: 'rule-1';
  text_rendered: string;
  summary: string | null;
  emotions: string[];
  people: string[];
  places: string[];
  questions: string[];
  decisions: string[];
  time_anchors: TimeAnchor[];
  module_hints: ModuleHint[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Stored entry (full, with ts) ────────────────────────────────────

export interface StoredEntry {
  ts: number;
  text_rendered?: string;
  text?: string;
  data?: string;
  raw_span?: Span;
  [key: string]: unknown;
}

// ─── Resurface ────────────────────────────────────────────────────────

export interface ResurfaceBuckets {
  weekAgo: StoredEntry[];
  monthAgo: StoredEntry[];
  seasonAgo: StoredEntry[];
  yearAgo: StoredEntry[];
}

export interface AnniversaryBucket {
  offsetDays: number;
  offsetLabel: string;
  entries: StoredEntry[];
}

export interface PhaseAnniversaryResult {
  entry: StoredEntry;
  cycleDay: number;
  daysSince: number;
}

export interface SemanticEchoResult {
  entry: StoredEntry;
  score: number;
  daysSince: number;
}

export interface RecentlyShownRecord {
  ts: number;
  seenAt: number;
}

// ─── Cycle input (for phase anniversaries) ───────────────────────────

export interface CycleRecord {
  cycleStartTs: number;
  cycleEndTs?: number;
  cycleLengthDays?: number;
}

// ─── Search ───────────────────────────────────────────────────────────

export interface MatchHighlight {
  term: string;
  start: number;
  end: number;
}

export interface SearchResult {
  entry: StoredEntry;
  score: number;
  matches: MatchHighlight[];
}

// ─── MMR ──────────────────────────────────────────────────────────────

export interface MMROpts {
  lambda?: number;
  maxOut?: number;
}

export interface ResurfaceSemanticOpts {
  max?: number;
  minDaysOld?: number;
}

// ─── User entities (for rule-based extraction) ───────────────────────

export interface UserEntities {
  people?: string[];
  places?: string[];
}
