/**
 * Medication cabinet · purpose map.
 *
 * Pure, deterministic categoriser: given a med / supplement name it returns
 * the cabinet "purpose" bucket the cabinet tab groups by — so the Layer-2 AI
 * never has to be on the critical path for the common, well-known names. The
 * dump router MAY still set an explicit purpose (the handler trusts that
 * first); this map is the local fallback that keeps the cabinet organised
 * even with no AI round-trip.
 *
 * Six buckets (matches the cabinet accordions + the mock ollie-medcabinet.html):
 *   sleep · mood · pain · digestion · vitamins · other
 *
 * Matching is by normalised-name substring against a small, high-signal word
 * list per purpose. The FIRST purpose (in PURPOSE_ORDER) with a hit wins, so
 * more-specific buckets are listed before the catch-all. Unknown → 'other'.
 *
 * No fabrication: the lists are the common OTC / supplement / Rx names; an
 * unknown name lands in 'other' rather than being guessed into a bucket.
 */

/** The six cabinet purpose buckets, in render order. */
export type MedPurpose =
  | 'sleep'
  | 'mood'
  | 'pain'
  | 'digestion'
  | 'vitamins'
  | 'other';

/** Render order + human label for each purpose (matches the mock). */
export const PURPOSE_ORDER: ReadonlyArray<{ key: MedPurpose; label: string }> = [
  { key: 'sleep', label: 'sleep' },
  { key: 'mood', label: 'mood' },
  { key: 'pain', label: 'pain & inflammation' },
  { key: 'digestion', label: 'digestion' },
  { key: 'vitamins', label: 'vitamins & minerals' },
  { key: 'other', label: 'other' },
];

export const MED_PURPOSES: readonly MedPurpose[] = PURPOSE_ORDER.map((p) => p.key);

/**
 * Keyword map — substring match against the normalised name. The FIRST purpose
 * in this list with a hit wins. Lists are intentionally small + high-signal;
 * the Layer-2 AI covers the long tail by passing an explicit purpose.
 */
const KEYWORD_PURPOSES: ReadonlyArray<{ purpose: MedPurpose; words: string[] }> = [
  {
    purpose: 'sleep',
    words: ['melatonin', 'magnesium', 'l-theanine', 'theanine', 'valerian', 'glycine'],
  },
  {
    purpose: 'mood',
    words: [
      'sertraline', 'omega-3', 'omega 3', 'omega3', 'fish oil', 'fluoxetine',
      'escitalopram', 'citalopram', 'bupropion', 'wellbutrin', 'lexapro',
      'prozac', 'zoloft', 'st johns wort', "st john's wort", 'ashwagandha',
    ],
  },
  {
    purpose: 'pain',
    words: [
      'ibuprofen', 'acetaminophen', 'paracetamol', 'tylenol', 'advil',
      'aspirin', 'naproxen', 'aleve', 'turmeric', 'curcumin',
    ],
  },
  {
    purpose: 'digestion',
    words: [
      'omeprazole', 'probiotic', 'probiotics', 'pepto', 'tums', 'antacid',
      'lansoprazole', 'famotidine', 'pepcid', 'lactase', 'digestive enzyme',
      'fiber', 'psyllium', 'metamucil',
    ],
  },
  {
    purpose: 'vitamins',
    words: [
      'vitamin d', 'vitamin b12', 'b12', 'vitamin b', 'iron', 'vitamin c',
      'vitamin a', 'vitamin e', 'vitamin k', 'multivitamin', 'zinc',
      'calcium', 'folate', 'folic acid', 'biotin', 'vitamin',
    ],
  },
];

/** Normalise a name the same way the rest of the module does. */
export function normalisePurposeKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Which purpose bucket does this med / supplement belong to?
 *   - keyword match on the normalised name (first match in list order wins).
 *   - else 'other' (the catch-all).
 *
 * Note: 'magnesium' deliberately routes to sleep (magnesium glycinate is the
 * common sleep-support form), NOT vitamins — the sleep list is scanned first.
 */
export function purposeFor(name: string): MedPurpose {
  const key = normalisePurposeKey(name);
  for (const { purpose, words } of KEYWORD_PURPOSES) {
    if (words.some((w) => key.includes(w))) return purpose;
  }
  return 'other';
}

/** Coerce a stored / router-supplied string into a known MedPurpose, else 'other'. */
export function coercePurpose(raw: unknown): MedPurpose {
  return MED_PURPOSES.includes(raw as MedPurpose) ? (raw as MedPurpose) : 'other';
}

/** Human label for a purpose key (for the accordion header). */
export function purposeLabel(purpose: MedPurpose): string {
  return PURPOSE_ORDER.find((p) => p.key === purpose)?.label ?? 'other';
}
