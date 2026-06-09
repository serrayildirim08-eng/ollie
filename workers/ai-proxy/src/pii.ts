/**
 * PII scrubber — worker-local regex layer.
 *
 * NOTE (Sprint B' pivot 2026-05-14): the canonical scrubber moved to
 * `@ollie/pii-scrub` which adds locale-aware name wordlists + a numeric
 * pass and ships with a 100-sample golden test. This file is retained
 * as the belt-and-suspenders second pass inside the worker so we never
 * forward raw text to Anthropic even if a misconfigured client calls
 * /label with un-scrubbed input. Keep these two implementations in sync
 * for the regex layer; the package version is the source of truth.
 *
 * Layer 2 = Anthropic system prompt during enrichment + labeling.
 *
 * Order matters: URL must run before email/phone (URLs may embed both).
 * Replacement tokens are bracketed so the LLM can recognize and preserve
 * them downstream when extracting structured signals.
 *
 * Brands are NOT scrubbed — they are the highest-value B2B signal.
 *
 * Medical / body-module terms are NOT scrubbed either. This scrubber
 * targets identity PII (names, addresses, phones, emails, GPS, URLs)
 * only — there is no MEDICAL / MEDICATION regex category. Common body
 * terms like "ibuprofen", "advil", "headache", "panic attack", "asthma",
 * "migraine", "ADHD", "vitamin D", "magnesium" pass through unchanged,
 * which is exactly what /route/body Layer 2 needs to classify accurately.
 * The Anthropic-side prompt layer (label.ts) does NOT add medical
 * filtering either. If a future scrubber adds medical categories, it
 * MUST allowlist these terms first — see body.config.ts for the rationale.
 */

export interface ScrubResult {
  scrubbed: string;
  /** Counts per token type — exposed for tests + observability. */
  hits: {
    name: number;
    phone: number;
    email: number;
    address: number;
    gps: number;
    url: number;
  };
}

// ─── individual patterns ──────────────────────────────────────────────────────

// Full URLs — strip path/query/fragment, keep scheme://host.
// Run FIRST so we don't accidentally scrub the email inside a URL.
const URL_REGEX = /\b(https?:\/\/)([\w.-]+\.[a-z]{2,})(\/\S*)?/gi;

// Email — basic local-part@domain. We don't try to be RFC-perfect.
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Phone — covers:
//   E.164:        +14155551234
//   US:           (415) 555-1234, 415-555-1234, 415.555.1234, 4155551234
//   intl loose:   +90 532 123 45 67, 0532 123 4567
// Requires at least 7 digits to avoid grabbing prices like "$1234".
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-]?)\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?/g;

// GPS — decimal lat,lng. e.g. "37.7749,-122.4194" or "37.7749, -122.4194".
// Bounds: lat -90..90, lng -180..180. Pattern is lat first then lng.
const GPS_REGEX = /\b-?(?:[1-8]?\d(?:\.\d+)|90(?:\.0+)?)\s*,\s*-?(?:1[0-7]\d(?:\.\d+)|180(?:\.0+)?|[1-9]?\d(?:\.\d+))\b/g;

// Postal address — best-effort. We match:
//   <number> <street word(s)> <street-type>
//   <number> <street word(s)> <street-type>, <city>, <STATE> <ZIP>
// Street types: St/Street, Ave/Avenue, Rd/Road, Blvd, Dr, Ln, Way, Ct, Pl, Pkwy, Hwy
const ADDRESS_REGEX = /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy)\b\.?(?:,?\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*)?(?:,?\s+[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?/g;

// Names — basic Western "First Last" pattern, requires both words to start
// with a capital letter and be 2+ letters. We accept false negatives (lower-
// case names, single names, non-Latin scripts). Anthropic layer catches more.
//
// We avoid matching at the start of a sentence by only firing inside
// running text (preceded by whitespace, not by sentence terminators like ., !, ?, or newline).
// We also skip month names + days to avoid scrubbing "Friday May 14".
const NAME_REGEX = /(?<=[a-z,;:]\s)([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/g;

// Stop list — words that look like First Last but aren't names. We could
// add more, but the cost of a false positive on these specific cases is
// noticeable in audit traces, so this is the minimal hit list.
const NAME_STOPWORDS = new Set([
  'New York', 'New Jersey', 'Los Angeles', 'San Francisco', 'San Diego',
  'United States', 'United Kingdom',
]);

// ─── orchestrator ─────────────────────────────────────────────────────────────

export function scrubPII(input: string): ScrubResult {
  const hits = { name: 0, phone: 0, email: 0, address: 0, gps: 0, url: 0 };
  let out = input;

  // 1. URL first — strip path/query/fragment, keep scheme://host.
  out = out.replace(URL_REGEX, (_m, scheme: string, host: string) => {
    hits.url++;
    return `${scheme}${host}`;
  });

  // 2. Email
  out = out.replace(EMAIL_REGEX, () => {
    hits.email++;
    return '[EMAIL]';
  });

  // 3. GPS coords (before phone — phone might otherwise eat the digits)
  out = out.replace(GPS_REGEX, () => {
    hits.gps++;
    return '[GPS]';
  });

  // 4. Address (before phone — long digit runs in addresses can look like phones)
  out = out.replace(ADDRESS_REGEX, () => {
    hits.address++;
    return '[ADDRESS]';
  });

  // 5. Phone
  out = out.replace(PHONE_REGEX, (match: string) => {
    // Require at least 7 digits to fire — avoids grabbing "$1,234.56".
    const digitCount = (match.match(/\d/g) ?? []).length;
    if (digitCount < 7) return match;
    hits.phone++;
    return '[PHONE]';
  });

  // 6. Names (last — they're the most ambiguous)
  out = out.replace(NAME_REGEX, (match: string) => {
    if (NAME_STOPWORDS.has(match)) return match;
    hits.name++;
    return '[NAME]';
  });

  return { scrubbed: out, hits };
}
