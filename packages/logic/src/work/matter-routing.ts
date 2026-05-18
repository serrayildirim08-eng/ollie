/**
 * @ollie/logic · work · matter-routing (Phase 2 — dump → matter, no AI)
 *
 * Pure, deterministic, FREE routing heuristics. There is NO AI / LLM
 * call here and none anywhere in Phase 2 — the entire layer is free
 * arithmetic. (The spec reserves an AI fallback for genuinely ambiguous
 * dumps as a Phase-2-later option; this build does the cheap-first
 * deterministic layer only — "the cheapest call is the one not made".)
 *
 * Spec: design/clean-slate-2026-05-18-v2/WORK-VISION.md — Phase 2.
 *
 * Four routing outcomes (locked 2026-05-18):
 *   1. CLEAR match     → file silently (origin 'clear').
 *   2. GUESS           → file as a MARKED guess (origin 'guess'), one-tap
 *                        to correct.
 *   3. NEW-MATTER nudge → a recurring unknown name seen N times → propose
 *                        a new matter (gentle, one-tap; never auto-create).
 *   4. LOOSE           → no match → leave unassigned in the quiet
 *                        loose/unsorted area.
 *
 * Routing is BATCH, not per-dump — `routeDumpBatch` processes a list.
 * Routing NEVER interrupts the user; this module only computes results.
 *
 * Everything here is pure: inputs → outputs, no I/O, no DOM, no
 * wall-clock reads (time is always a parameter).
 */

import type { Matter } from './matter';
import { matterKeys } from './matter';

// ─── Tunables ─────────────────────────────────────────────────────────

/**
 * A fuzzy score at/above this is a GUESS (filed, marked). Below it the
 * dump is LOOSE. A whole-word/alias hit always scores 1.0 (CLEAR) and
 * bypasses fuzzy entirely.
 */
export const GUESS_THRESHOLD = 0.6;

/**
 * How many times an unrecognised candidate name must recur across the
 * batch before it becomes a "new matter?" suggestion. The spec wants a
 * nudge only for a name that genuinely repeats — one mention is noise.
 */
export const NEW_MATTER_MIN_OCCURRENCES = 3;

/** Shortest token length considered a routing-worthy name candidate. */
const MIN_CANDIDATE_LEN = 3;

// ─── Inputs / outputs ─────────────────────────────────────────────────

/** One dump handed to the router. Text is the raw user note. */
export interface RoutableDump {
  /** id of the source dump row. */
  dump_id: string;
  /** store slice the row lives in (e.g. "dump", "work"). */
  source_slice: string;
  /** raw user text. */
  text: string;
  /** ms timestamp the dump was captured. */
  ts: number;
}

export type RouteOutcomeKind = 'clear' | 'guess' | 'loose';

/** Result of routing one dump. */
export interface DumpRouteResult {
  dump_id: string;
  source_slice: string;
  /** clear / guess → matched; loose → no match. */
  outcome: RouteOutcomeKind;
  /** id of the matched matter; null for loose. */
  matter_id: string | null;
  /** 0..1 match score. 1.0 for clear; the fuzzy score for guess; 0 loose. */
  score: number;
  /** the matter key (name/alias) that matched, for UI explanation. */
  matched_key?: string;
}

/**
 * A proposed new matter — a recurring unrecognised name. The UI surfaces
 * this as a gentle one-tap "is this a matter?" nudge; it is NEVER
 * auto-created (spec: "the user never builds a matter from a blank
 * form; they confirm what Ollie noticed").
 */
export interface NewMatterSuggestion {
  /** the recurring candidate name, in its most-common surface form. */
  candidate: string;
  /** normalised lookup key (lower-cased). */
  key: string;
  /** how many dumps in the batch mentioned it. */
  occurrences: number;
  /** dump ids that mentioned it — the dumps a confirmed matter adopts. */
  dump_ids: string[];
}

/** Full result of a batch routing pass. */
export interface BatchRouteResult {
  /** one entry per input dump, in input order. */
  routes: DumpRouteResult[];
  /** recurring-unknown-name suggestions, most-frequent first. */
  suggestions: NewMatterSuggestion[];
}

// ─── Text normalisation ───────────────────────────────────────────────

/**
 * Lower-case + collapse whitespace. Turkish-aware: the dotless/dotted i
 * pair is folded so "Yılmaz" and "yilmaz" match. Used on both matter
 * keys and dump text before comparison.
 */
export function normalizeText(text: string): string {
  // Fold the Turkish dotted/dotless i pair BEFORE toLowerCase: lowering
  // 'İ' (U+0130) yields 'i' + a combining dot (U+0307), so the fold must
  // run on the upper-case form first.
  return text
    .replace(/[İıI]/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word-character set incl. Latin-1 + Turkish letters and digits. */
const WORD_CHARS = /[a-z0-9ğüşöçâîû]+/gi;

/**
 * Tokenise normalised text into word tokens. Punctuation is dropped.
 */
function tokenize(normalized: string): string[] {
  return normalized.match(WORD_CHARS) ?? [];
}

// ─── Matching primitives ──────────────────────────────────────────────

/**
 * True if `key` (a normalised, possibly multi-word matter key) occurs as
 * a whole token / token-run inside the normalised dump text. This is the
 * CLEAR-match test — exact name/alias presence.
 */
export function keyOccursIn(normalizedText: string, normalizedKey: string): boolean {
  if (normalizedKey.length === 0) return false;
  // Word-boundary-padded substring search so "art" does not match
  // "started". Spaces in the text/key already act as boundaries.
  const padded = ` ${normalizedText} `;
  return padded.includes(` ${normalizedKey} `);
}

/**
 * Token-overlap fuzzy score in 0..1 for a multi-word key vs dump text.
 * Score = (matched key tokens) / (total key tokens). A single-word key
 * therefore scores 0 or 1 — single words rely on `keyOccursIn` for the
 * clear path and contribute little fuzzy signal. Used only to grade a
 * GUESS once the clear path has missed.
 */
export function fuzzyScore(normalizedText: string, normalizedKey: string): number {
  const keyTokens = tokenize(normalizedKey);
  if (keyTokens.length === 0) return 0;
  const textTokens = new Set(tokenize(normalizedText));
  let hit = 0;
  for (const t of keyTokens) {
    if (textTokens.has(t)) hit += 1;
  }
  return hit / keyTokens.length;
}

// ─── Single-dump routing ──────────────────────────────────────────────

/**
 * Route ONE dump against the current matter set. Pure.
 *
 * Algorithm (cheapest-first):
 *   1. CLEAR — any matter key occurs verbatim in the text → score 1.0.
 *      Ties broken by the longest matched key (most specific), then by
 *      matter `created_at` (oldest wins) for determinism.
 *   2. GUESS/LOOSE — otherwise take the best fuzzy token-overlap score
 *      across all keys. ≥ GUESS_THRESHOLD → guess; below → loose.
 *
 * Archived matters are skipped — routing only targets active matters.
 */
export function routeDump(dump: RoutableDump, matters: Matter[]): DumpRouteResult {
  const text = normalizeText(dump.text);
  const base = { dump_id: dump.dump_id, source_slice: dump.source_slice };

  let clearMatterId: string | null = null;
  let clearKey = '';
  let clearKeyLen = -1;
  let clearCreatedAt = Infinity;

  let bestFuzzyId: string | null = null;
  let bestFuzzyKey = '';
  let bestFuzzyScore = 0;

  for (const matter of matters) {
    if (matter.status !== 'active') continue;
    for (const rawKey of matterKeys(matter)) {
      const key = normalizeText(rawKey);
      if (key.length === 0) continue;

      if (keyOccursIn(text, key)) {
        // Prefer the longest key; tie-break on oldest matter.
        if (
          key.length > clearKeyLen ||
          (key.length === clearKeyLen && matter.created_at < clearCreatedAt)
        ) {
          clearMatterId = matter.id;
          clearKey = key;
          clearKeyLen = key.length;
          clearCreatedAt = matter.created_at;
        }
        continue;
      }

      const score = fuzzyScore(text, key);
      if (score > bestFuzzyScore) {
        bestFuzzyScore = score;
        bestFuzzyId = matter.id;
        bestFuzzyKey = key;
      }
    }
  }

  if (clearMatterId !== null) {
    return { ...base, outcome: 'clear', matter_id: clearMatterId, score: 1, matched_key: clearKey };
  }

  if (bestFuzzyId !== null && bestFuzzyScore >= GUESS_THRESHOLD) {
    return {
      ...base,
      outcome: 'guess',
      matter_id: bestFuzzyId,
      score: bestFuzzyScore,
      matched_key: bestFuzzyKey,
    };
  }

  return { ...base, outcome: 'loose', matter_id: null, score: 0 };
}

// ─── Recurring-unknown-name mining (new-matter suggestions) ────────────

/**
 * English/Turkish stop-words excluded from name-candidate mining so a
 * recurring "the"/"and"/"için" never becomes a "new matter?" nudge.
 */
const STOP_WORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'has', 'had', 'are',
  'was', 'were', 'will', 'from', 'into', 'out', 'about', 'need', 'needs',
  'want', 'todo', 'task', 'call', 'email', 'meeting', 'today', 'tomorrow',
  'week', 'month', 'day', 'send', 'check', 'done', 'still', 'also', 'just',
  'ile', 'için', 'icin', 'ama', 'veya', 'bir', 'bu', 'şu', 'su', 've',
  'gibi', 'kadar', 'daha', 'çok', 'cok', 'olan', 'var', 'yok',
]);

/**
 * Capitalised-word run extractor over the ORIGINAL (un-normalised) text.
 * Proper nouns — case names, client names — are typically capitalised;
 * a run of capitalised words ("Yılmaz E2", "Acme Corp") is one candidate
 * name. Lower-cased single common words are not candidates.
 */
function extractNameCandidates(originalText: string): string[] {
  const out: string[] = [];
  // A token starting with an upper-case letter (Latin or Turkish),
  // optionally followed by more capitalised / numeric tokens.
  const run =
    /[A-ZĞÜŞİÖÇ][\wğüşıöçâîû'-]*(?:\s+[A-ZĞÜŞİÖÇ0-9][\wğüşıöçâîû'-]*)*/g;
  const matches = originalText.match(run) ?? [];
  for (const m of matches) {
    const trimmed = m.trim();
    if (trimmed.length < MIN_CANDIDATE_LEN) continue;
    // Drop a single stop-word that happened to be sentence-initial-capped.
    const tokens = tokenize(normalizeText(trimmed));
    if (tokens.length === 0) continue;
    if (tokens.length === 1 && STOP_WORDS.has(tokens[0])) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * Mine the dumps that did NOT route to any matter for recurring unknown
 * names. A candidate seen in ≥ NEW_MATTER_MIN_OCCURRENCES distinct
 * dumps becomes a `NewMatterSuggestion`.
 *
 * `unroutedDumps` should be the dumps whose route outcome is `loose`
 * (clear/guess dumps are already filed and must not seed suggestions).
 * Returns suggestions sorted most-frequent-first, then alphabetically
 * for stable output.
 */
export function mineNewMatterSuggestions(
  unroutedDumps: RoutableDump[],
): NewMatterSuggestion[] {
  // key → { surface-form counts, dump ids }
  const acc = new Map<
    string,
    { forms: Map<string, number>; dumpIds: Set<string> }
  >();

  for (const dump of unroutedDumps) {
    const candidates = extractNameCandidates(dump.text);
    // De-dupe within one dump so a name repeated in a single note still
    // counts as ONE occurrence (occurrence == distinct dumps).
    const seenKeysThisDump = new Set<string>();
    for (const cand of candidates) {
      const key = normalizeText(cand);
      if (key.length < MIN_CANDIDATE_LEN) continue;
      let entry = acc.get(key);
      if (!entry) {
        entry = { forms: new Map(), dumpIds: new Set() };
        acc.set(key, entry);
      }
      entry.forms.set(cand, (entry.forms.get(cand) ?? 0) + 1);
      if (!seenKeysThisDump.has(key)) {
        entry.dumpIds.add(dump.dump_id);
        seenKeysThisDump.add(key);
      }
    }
  }

  const suggestions: NewMatterSuggestion[] = [];
  for (const [key, entry] of acc) {
    const occurrences = entry.dumpIds.size;
    if (occurrences < NEW_MATTER_MIN_OCCURRENCES) continue;
    // Most-common surface form is the display candidate.
    let candidate = key;
    let best = -1;
    for (const [form, n] of entry.forms) {
      if (n > best) { best = n; candidate = form; }
    }
    suggestions.push({
      candidate,
      key,
      occurrences,
      dump_ids: [...entry.dumpIds],
    });
  }

  suggestions.sort((a, b) =>
    b.occurrences - a.occurrences || a.key.localeCompare(b.key),
  );
  return suggestions;
}

// ─── Batch routing ────────────────────────────────────────────────────

/**
 * Route a whole batch of dumps in one pass. This is the Phase 2 entry
 * point — routing is batch, not per-dump.
 *
 *   1. Every dump is routed against `matters`.
 *   2. The dumps that came back `loose` are mined for recurring unknown
 *      names → `suggestions`.
 *
 * Pure: no store reads, no clock. The orchestrator wrapper owns I/O.
 */
export function routeDumpBatch(
  dumps: RoutableDump[],
  matters: Matter[],
): BatchRouteResult {
  const routes = dumps.map((d) => routeDump(d, matters));

  const looseIds = new Set(
    routes.filter((r) => r.outcome === 'loose').map((r) => r.dump_id),
  );
  const looseDumps = dumps.filter((d) => looseIds.has(d.dump_id));
  const suggestions = mineNewMatterSuggestions(looseDumps);

  return { routes, suggestions };
}
