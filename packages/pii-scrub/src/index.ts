/**
 * @ollie/pii-scrub — locale-aware PII scrubbing for opt-in research pipeline.
 *
 * Three layers, run in order (most-confident first):
 *   1. Regex: email, phone (US/TR/NL/ES), URLs, GPS coords, postal addresses
 *   2. Numeric: 4+ digit sequences that look like account/SSN/passport
 *      (preserve money: $/€/₺/£ amounts, including 4-digit dollar amounts)
 *   3. Wordlist: top first/last names per locale → [NAME]
 *
 * Layer ordering matters:
 *   - URL first (URLs embed emails/phones)
 *   - email + GPS + address before phone (long digit runs)
 *   - phone before numeric (phone is more specific)
 *   - numeric before name (digits inside names are rare)
 *   - name last (most ambiguous)
 *
 * Preserves: cycle keywords, food, mood, work context, time references,
 * money amounts, brand names, sector keywords (the B2B signal lives here).
 *
 * Locale matters for the wordlist pass — names common in `tr` aren't in `en`.
 * The regex layer is locale-agnostic.
 *
 * Exports a `scrubPII(text, locale)` matching the brief, plus an internal
 * counts shape used by golden tests + observability.
 */

import { isLikelyName, isCommonCapitalizedWord, type Locale } from './wordlists';

export type { Locale } from './wordlists';

export type RedactionType = 'EMAIL' | 'PHONE' | 'ADDRESS' | 'NAME' | 'URL' | 'GPS' | 'NUMERIC';

export interface Redaction {
  type: RedactionType;
  original: string;
}

export interface ScrubResult {
  scrubbed: string;
  redactions: Redaction[];
}

// ─── regex layer ──────────────────────────────────────────────────────────────

// URL — strip path/query/fragment, keep scheme://host.
// Run FIRST so we don't accidentally scrub the email inside a URL.
const URL_REGEX = /\b(https?:\/\/)([\w.-]+\.[a-z]{2,})(\/\S*)?/gi;

// Email — basic local-part@domain.
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Phone — E.164, US, intl loose (TR/NL/ES). Requires 7+ digits AND at least
// one separator (space / dash / dot / paren) OR a leading +. Pure digit
// strings (e.g. SSN, account numbers) get caught by the numeric pass below,
// not the phone pass.
const PHONE_REGEX = /(?:\+\d{1,3}[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?|(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{2,4}[\s.-]\d{2,4}(?:[\s.-]?\d{2,4})?|\d{3}[\s.-]\d{3,4}[\s.-]\d{3,4})/g;

// GPS — decimal lat,lng with bounds.
const GPS_REGEX = /\b-?(?:[1-8]?\d(?:\.\d+)|90(?:\.0+)?)\s*,\s*-?(?:1[0-7]\d(?:\.\d+)|180(?:\.0+)?|[1-9]?\d(?:\.\d+))\b/g;

// Postal address — best-effort US/UK street format.
const ADDRESS_REGEX =
  /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy)\b\.?(?:,?\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*)?(?:,?\s+[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?/g;

// Numeric — runs of 4+ digits NOT prefixed by a money symbol or "$".
// We strip these as potential account/SSN/passport/card numbers. We allow
// money amounts (matched via lookbehind for currency or trailing 'k'/'M'/'%').
// JS supports lookbehind in modern engines; keep pattern simple.
const NUMERIC_REGEX = /(?<![$€₺£¥])(?<!\d[.,])\b\d{4,}\b(?![.,]\d|%|k\b|M\b)/g;

// Stop list for names that look like names but aren't.
const ADDRESS_NAME_STOPWORDS = new Set([
  'New York', 'New Jersey', 'Los Angeles', 'San Francisco', 'San Diego',
  'United States', 'United Kingdom',
]);

// ─── orchestrator ─────────────────────────────────────────────────────────────

export function scrubPII(text: string, locale: Locale): ScrubResult {
  const redactions: Redaction[] = [];
  let out = text;

  // 1. URL first
  out = out.replace(URL_REGEX, (match, scheme: string, host: string) => {
    redactions.push({ type: 'URL', original: match });
    return `${scheme}${host}`;
  });

  // 2. Email
  out = out.replace(EMAIL_REGEX, (match) => {
    redactions.push({ type: 'EMAIL', original: match });
    return '[EMAIL]';
  });

  // 3. GPS coords
  out = out.replace(GPS_REGEX, (match) => {
    redactions.push({ type: 'GPS', original: match });
    return '[GPS]';
  });

  // 4. Address (before phone — long digit runs in addresses can look like phones)
  out = out.replace(ADDRESS_REGEX, (match) => {
    if (ADDRESS_NAME_STOPWORDS.has(match)) return match;
    redactions.push({ type: 'ADDRESS', original: match });
    return '[ADDRESS]';
  });

  // 5. Phone (≥7 digits)
  out = out.replace(PHONE_REGEX, (match: string) => {
    const digitCount = (match.match(/\d/g) ?? []).length;
    if (digitCount < 7) return match;
    redactions.push({ type: 'PHONE', original: match });
    return '[PHONE]';
  });

  // 6. Numeric — 4+ digit sequences not adjacent to currency
  out = out.replace(NUMERIC_REGEX, (match) => {
    // Skip if this is clearly a year (1900-2099) — those are research signal
    const n = parseInt(match, 10);
    if (match.length === 4 && n >= 1900 && n <= 2099) return match;
    redactions.push({ type: 'NUMERIC', original: match });
    return '[NUMERIC]';
  });

  // 7. Names — wordlist pass (locale-aware)
  // Match word characters including diacritics for Spanish + Turkish.
  out = out.replace(/[A-Za-zÀ-ÿĞğŞşİıÇçÖöÜü]+/g, (word) => {
    if (word.length < 3) return word;
    if (isLikelyName(word, locale)) {
      redactions.push({ type: 'NAME', original: word });
      return '[NAME]';
    }
    return word;
  });

  // 7b. Names — capitalization heuristic (audit item #3).
  //
  // The wordlist pass only catches the ~300 names per locale that are
  // compiled in; a real name not on the list ("Tyrnauq", an uncommon
  // surname) passed straight through to the research corpus unredacted.
  //
  // Heuristic: a Capitalized word is likely a person name when it is part
  // of a Capitalized RUN of 2+ words (first + last) OR is preceded by a
  // name-introducing trigger ("met Sarah", "from Devendra"). We do NOT
  // flag a lone capitalized word with no such context — that is where
  // brand names (kept on purpose) and sentence-initial words live, so the
  // restriction keeps the false-positive rate low.
  //
  // Residual risk (documented, accepted for v0):
  //   - all-lowercase names with no wordlist hit still slip through
  //     (voice-to-text often lowercases) — wordlist remains the only net
  //     for that path;
  //   - a capitalized two-word brand at mid-sentence ("Crunchy Nut") can
  //     be over-redacted — rare, and over-redaction is the safe failure
  //     direction for a privacy gate;
  //   - sentence-initial single names ("Sarah came over.") are missed
  //     unless wordlisted — acceptable, single-token + sentence start is
  //     too FP-prone to flag.
  out = applyCapitalizedNameHeuristic(out, redactions);

  return { scrubbed: out, redactions };
}

// Words that are routinely capitalized but are NOT person names — sentence
// starters, weekdays, months, pronoun "I". Lowercased for comparison.
const CAP_NOT_NAME = new Set([
  'i', 'the', 'a', 'an', 'and', 'but', 'or', 'so', 'then', 'now', 'today',
  'tomorrow', 'yesterday', 'tonight', 'this', 'that', 'my', 'we', 'they',
  'he', 'she', 'it', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december',
  // Spanish / Turkish sentence starters + days
  'el', 'la', 'los', 'las', 'hoy', 'ayer', 'manana', 'lunes', 'martes',
  'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
  'bugun', 'yarin', 'dun', 'pazartesi', 'sali', 'carsamba', 'persembe',
  'cuma', 'cumartesi', 'pazar',
]);

// Trigger words that commonly precede a person name in a brain dump.
const NAME_TRIGGERS = new Set([
  'met', 'meet', 'meeting', 'with', 'from', 'told', 'tell', 'called',
  'call', 'calling', 'texted', 'text', 'emailed', 'saw', 'asked', 'ask',
  'thanks', 'thank', 'about', 'and', 'see', 'visit', 'visited',
  // es
  'con', 'de', 'llamo', 'vi', 'dijo',
  // tr
  'ile', 'aradi', 'dedi',
]);

/** True for a token like "Sarah" / "Öztürk" — leading uppercase, rest lower. */
function isCapitalizedToken(tok: string): boolean {
  if (tok.length < 3) return false;
  const first = tok[0];
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return false;
  const rest = tok.slice(1);
  return rest === rest.toLowerCase();
}

/**
 * Flag capitalized words that look like person names by context.
 * Operates on the already-regex-scrubbed text; rewrites name tokens to
 * [NAME] and pushes a NAME redaction for each.
 */
function applyCapitalizedNameHeuristic(text: string, redactions: Redaction[]): string {
  // Tokenise preserving separators so we can rebuild the string verbatim.
  const parts = text.split(/([^A-Za-zÀ-ÿĞğŞşİıÇçÖöÜü]+)/);
  // Even indexes are word tokens, odd indexes are separators.
  const words: string[] = [];
  for (let i = 0; i < parts.length; i += 2) words.push(parts[i] ?? '');

  // A word is a name CANDIDATE when it is a capitalized token we want to
  // consider redacting.
  const isNameWord = words.map(
    (w) => isCapitalizedToken(w) && !CAP_NOT_NAME.has(w.toLowerCase()) && !isCommonCapitalizedWord(w),
  );
  // A word is a name ANCHOR when, for run-detection, it counts as an
  // adjacent name — that is a candidate OR an already-redacted [NAME]
  // placeholder left by the wordlist pass. Treating the placeholder as an
  // anchor lets the OTHER token in a first+last pair still be caught
  // (e.g. wordlist redacts "Öztürk", heuristic still catches "Çağrı").
  const isAnchor = words.map((w, i) => {
    if (isNameWord[i]) return true;
    const before = parts[i * 2 - 1] ?? '';
    const after = parts[i * 2 + 1] ?? '';
    return w === 'NAME' && before.endsWith('[') && after.startsWith(']');
  });
  const flagged = new Array<boolean>(words.length).fill(false);

  for (let i = 0; i < words.length; i++) {
    if (!isNameWord[i]) continue;
    // (1) part of a capitalized run of 2+ name-like words (an adjacent
    // already-redacted [NAME] also counts as a run member).
    if (isAnchor[i - 1] || isAnchor[i + 1]) {
      flagged[i] = true;
      continue;
    }
    // (2) immediately preceded by a name-introducing trigger word.
    for (let j = i - 1; j >= 0; j--) {
      const prev = words[j];
      if (prev === '') continue; // skip empty token between separators
      if (NAME_TRIGGERS.has(prev.toLowerCase())) flagged[i] = true;
      break;
    }
  }

  for (let i = 0; i < words.length; i++) {
    if (!flagged[i]) continue;
    redactions.push({ type: 'NAME', original: words[i] });
    parts[i * 2] = '[NAME]';
  }
  return parts.join('');
}
