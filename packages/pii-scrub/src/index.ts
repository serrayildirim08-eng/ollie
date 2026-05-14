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

import { isLikelyName, type Locale } from './wordlists';

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

  return { scrubbed: out, redactions };
}
