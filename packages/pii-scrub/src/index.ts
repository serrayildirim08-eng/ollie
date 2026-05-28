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
import { isBrand } from './brand-allowlist';

export type { Locale } from './wordlists';

export type RedactionType =
  | 'EMAIL'
  | 'PHONE'
  | 'ADDRESS'
  | 'NAME'
  | 'URL'
  | 'GPS'
  | 'NUMERIC'
  | 'MEDICAL'
  | 'MEDICATION'
  | 'SEXUAL'
  | 'MENTAL_HEALTH';

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

// ─── sensitive-category regexes ───────────────────────────────────────────────
//
// These fire BEFORE the name pass so a phrase like "cancer diagnosis for John"
// redacts the condition first; the name pass then redacts "John" independently.
// Brand names are exempt — checked via isBrand() inside the match callbacks.

// MEDICAL — symptoms, diagnoses, body parts in a clinical context, conditions.
// Phrase-level match: "diagnosed with X", "suffers from X", "X diagnosis", etc.
// We intentionally cast a wide net (over-redaction is the safe direction).
const MEDICAL_CONDITIONS = [
  // oncology
  'cancer', 'tumor', 'tumour', 'carcinoma', 'lymphoma', 'leukemia', 'leukaemia',
  'melanoma', 'sarcoma', 'glioma', 'mesothelioma',
  // cardiovascular
  'heart attack', 'myocardial infarction', 'stroke', 'angina', 'arrhythmia',
  'hypertension', 'atherosclerosis', 'aneurysm',
  // endocrine / metabolic
  'diabetes', 'diabetic', 'insulin resistance', 'hypothyroidism', 'hyperthyroidism',
  'thyroid', 'cushing', 'addison',
  // respiratory
  'asthma', 'copd', 'pneumonia', 'tuberculosis', 'bronchitis', 'emphysema',
  'pulmonary fibrosis',
  // gastrointestinal
  'crohn', "crohn's", 'colitis', 'ibs', 'celiac', 'coeliac', 'ulcer',
  'gastritis', 'cirrhosis', 'hepatitis',
  // neurological
  'epilepsy', 'seizure', 'alzheimer', "alzheimer's", 'parkinson', "parkinson's",
  'multiple sclerosis', 'ms diagnosis', 'neuropathy',
  // reproductive / gynaecological
  'endometriosis', 'pcos', 'ovarian cyst', 'fibroids', 'miscarriage',
  'ectopic pregnancy',
  // musculoskeletal
  'fibromyalgia', 'lupus', 'rheumatoid arthritis', 'osteoporosis',
  // infectious
  'hiv', 'aids', 'herpes', 'hepatitis b', 'hepatitis c', 'syphilis',
  'gonorrhea', 'gonorrhoea', 'chlamydia',
  // tr equivalents — high-frequency in Turkish voice input
  'diyabet', 'kanser', 'tümör', 'tansiyon', 'astım', 'sara', 'felç',
  'kalp krizi', 'lösemi', 'tiroid',
];

// Build a regex that matches the condition words/phrases — word-boundary aware.
// Longer phrases first (avoids "ms" eating "multiple sclerosis").
const SORTED_MEDICAL = [...MEDICAL_CONDITIONS].sort((a, b) => b.length - a.length);
const MEDICAL_REGEX = new RegExp(
  `\\b(${SORTED_MEDICAL.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

// MEDICATION — drug names (brand + generic). NOT comprehensive pharma DB —
// covers the most common drugs likely to appear in ADHD/wellness brain dumps.
// Brand pharma names are NOT in the brand allowlist by design (Pfizer is, but
// "Ritalin 10mg" reveals a personal prescription).
const MEDICATION_NAMES = [
  // ADHD
  'ritalin', 'concerta', 'adderall', 'vyvanse', 'strattera', 'intuniv',
  'methylphenidate', 'amphetamine', 'dexedrine', 'focalin',
  // antidepressants / anxiolytics
  'prozac', 'zoloft', 'lexapro', 'wellbutrin', 'effexor', 'cymbalta',
  'fluoxetine', 'sertraline', 'escitalopram', 'bupropion', 'venlafaxine',
  'duloxetine', 'citalopram', 'paroxetine', 'paxil',
  'xanax', 'valium', 'ativan', 'klonopin', 'alprazolam', 'diazepam',
  'lorazepam', 'clonazepam',
  // antipsychotics / mood stabilisers
  'lithium', 'lamictal', 'lamotrigine', 'seroquel', 'quetiapine',
  'risperdal', 'risperidone', 'abilify', 'aripiprazole', 'zyprexa',
  // sleep
  'ambien', 'lunesta', 'zolpidem', 'eszopiclone', 'melatonin',
  // pain / other common
  'oxycodone', 'oxycontin', 'hydrocodone', 'vicodin', 'codeine', 'tramadol',
  'metformin', 'lisinopril', 'atorvastatin', 'levothyroxine', 'omeprazole',
  // tr common prescription names
  'beloc', 'coraspin', 'lasix', 'glucophage', 'euthyrox', 'lustral',
  'cipralex', 'xanor', 'rivotril',
];

const SORTED_MEDICATIONS = [...MEDICATION_NAMES].sort((a, b) => b.length - a.length);
const MEDICATION_REGEX = new RegExp(
  `\\b(${SORTED_MEDICATIONS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

// SEXUAL — explicit sexual content + behaviour descriptions that should never
// appear in the research corpus.
const SEXUAL_PATTERNS = [
  // acts (clinical + colloquial — ordered long-first)
  'sexual intercourse', 'sexual activity', 'sexual assault', 'sexual abuse',
  'masturbation', 'masturbating', 'pornography', 'porn', 'onlyfans',
  'erectile dysfunction', 'vaginal', 'penile', 'genitals', 'genitalia',
  'clitoris', 'penis', 'vagina', 'testicles', 'vulva', 'anal sex',
  'oral sex', 'anal', 'blowjob', 'handjob', 'fingering',
  // slang (add more via allowlist-exception if a brand happens to match)
  'sexting', 'nudes', 'dick pic', 'cum', 'orgasm', 'ejaculation',
  'foreplay', 'fetish', 'bdsm', 'kink',
  // tr
  'seks', 'cinsel ilişki', 'mastürbasyon', 'müstehcen',
];

const SORTED_SEXUAL = [...SEXUAL_PATTERNS].sort((a, b) => b.length - a.length);
const SEXUAL_REGEX = new RegExp(
  `\\b(${SORTED_SEXUAL.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

// MENTAL HEALTH — diagnoses, ideation, crisis terms. Especially important given
// Ollie has a crisis detection subsystem; this layer ensures those terms are
// stripped from the B2B research corpus even when the crisis detector doesn't
// fire (i.e. low-intensity mentions in journalling context).
const MENTAL_HEALTH_TERMS = [
  // diagnoses
  'bipolar disorder', 'bipolar', 'schizophrenia', 'schizophrenic',
  'borderline personality', 'bpd', 'ptsd', 'post-traumatic stress',
  'ocd', 'obsessive compulsive', 'eating disorder', 'anorexia', 'bulimia',
  'binge eating', 'dissociation', 'dissociative',
  // mood states used clinically
  'major depression', 'clinical depression', 'depressive episode',
  'manic episode', 'psychosis', 'psychotic episode', 'paranoia',
  'panic attack', 'panic disorder',
  // ideation / crisis (high-sensitivity — always scrub)
  'suicidal ideation', 'suicidal thoughts', 'suicide attempt', 'self-harm',
  'self harm', 'cutting myself', 'hurting myself', 'want to die',
  'kill myself', 'end my life', 'not worth living',
  // general mental health vocabulary that reveals diagnosis
  'therapist said', 'my therapist', 'my psychiatrist', 'psychiatrist told',
  'on antidepressants', 'on medication for', 'diagnosed with depression',
  'diagnosed with anxiety', 'diagnosed with adhd', 'diagnosed with autism',
  'autism spectrum', 'autistic',
  // tr
  'intihar', 'kendime zarar', 'depresyon teşhisi', 'bipolar bozukluk',
  'panik atak', 'anksiyete bozukluğu', 'obsesif kompulsif',
];

const SORTED_MENTAL_HEALTH = [...MENTAL_HEALTH_TERMS].sort((a, b) => b.length - a.length);
const MENTAL_HEALTH_REGEX = new RegExp(
  `\\b(${SORTED_MENTAL_HEALTH.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

// Stop list for names that look like names but aren't.
const ADDRESS_NAME_STOPWORDS = new Set([
  'New York', 'New Jersey', 'Los Angeles', 'San Francisco', 'San Diego',
  'United States', 'United Kingdom',
]);

// ─── orchestrator ─────────────────────────────────────────────────────────────

export function scrubPII(text: string, locale: Locale): ScrubResult {
  const redactions: Redaction[] = [];
  let out = text;

  // 0a. MENTAL_HEALTH — run first: high-sensitivity crisis terms must not be
  //     accidentally absorbed by a later, weaker pass (e.g. "suicide" eaten
  //     by MEDICAL before we can tag it MENTAL_HEALTH). Brand check is a
  //     no-op here but kept for symmetry.
  out = out.replace(MENTAL_HEALTH_REGEX, (match) => {
    if (isBrand(match)) return match;
    redactions.push({ type: 'MENTAL_HEALTH', original: match });
    return '[MENTAL_HEALTH]';
  });

  // 0b. MEDICAL — diagnoses, conditions, clinical terms.
  out = out.replace(MEDICAL_REGEX, (match) => {
    if (isBrand(match)) return match;
    redactions.push({ type: 'MEDICAL', original: match });
    return '[MEDICAL]';
  });

  // 0c. MEDICATION — drug names. Pharma brand names are kept in the brand
  //     allowlist at the company level (Pfizer, Bayer) but NOT at the product
  //     level (Ritalin, Xanax) because a product name reveals a prescription.
  out = out.replace(MEDICATION_REGEX, (match) => {
    if (isBrand(match)) return match;
    redactions.push({ type: 'MEDICATION', original: match });
    return '[MEDICATION]';
  });

  // 0d. SEXUAL — explicit content terms.
  out = out.replace(SEXUAL_REGEX, (match) => {
    if (isBrand(match)) return match;
    redactions.push({ type: 'SEXUAL', original: match });
    return '[SEXUAL]';
  });

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

  // 7. Names — wordlist pass (locale-aware).
  // Brand names are explicitly exempt — they are research signal.
  out = out.replace(/[A-Za-zÀ-ÿĞğŞşİıÇçÖöÜü]+/g, (word) => {
    if (word.length < 3) return word;
    if (isBrand(word)) return word;
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
    (w) =>
      isCapitalizedToken(w) &&
      !CAP_NOT_NAME.has(w.toLowerCase()) &&
      !isCommonCapitalizedWord(w) &&
      !isBrand(w),
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
