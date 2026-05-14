/**
 * @ollie/logic · finance · subscription aliases catalog
 *
 * Maps canonical subscription service keys to arrays of search terms used
 * to scan brain-dump entries for mentions of the service.
 *
 * Matching rules (enforced by the consumer in subscription-dormancy.ts):
 *   - Case-insensitive
 *   - Word-boundary matched (so "spot" does not match "spotify" and
 *     "music" alone does not match "apple music")
 *   - Multi-word terms must appear as contiguous words
 *
 * Ambiguity rule: any term shorter than 4 characters or made entirely of
 * common English / Spanish words is BANNED. Generic single-words like
 * "music", "pro", "premium", "plus", "cloud" never appear as standalone
 * terms — they only appear inside multi-word phrases that include the
 * brand prefix ("apple music", "youtube premium"). Brand-only aliases
 * are fine when the brand itself is uncommon as a word ("netflix",
 * "spotify", "headspace").
 *
 * Apple-managed subs (Apple Music, iCloud, Apple Arcade, Apple TV+,
 * Apple News+, Fitness+) are listed with their full-brand phrase so we
 * can route their cancel button to the iOS subscriptions deep-link in
 * cancel-urls.ts.
 *
 * The keys here are stable identifiers used as cross-reference keys in
 * cancel-urls.ts and (optionally) on StoredSub rows via a future
 * `alias_key` field. Do NOT rename keys without a migration.
 */

export const SUBSCRIPTION_ALIASES: Record<string, readonly string[]> = {
  // ── streaming ─────────────────────────────────────────────────────
  netflix:           ['netflix', 'nflx'],
  spotify:           ['spotify'],
  'apple-music':     ['apple music'],
  'youtube-premium': ['youtube premium', 'yt premium'],
  'youtube-music':   ['youtube music', 'yt music'],
  'disney-plus':     ['disney+', 'disney plus'],
  'hbo-max':         ['hbo max', 'hbo', 'max streaming'],
  hulu:              ['hulu'],
  'paramount-plus':  ['paramount+', 'paramount plus'],
  peacock:           ['peacock tv', 'peacock streaming'],
  audible:           ['audible'],
  'kindle-unlimited': ['kindle unlimited'],
  'apple-tv-plus':   ['apple tv+', 'apple tv plus'],
  'amazon-prime':    ['amazon prime', 'prime video'],

  // ── productivity ──────────────────────────────────────────────────
  notion:            ['notion'],
  linear:            ['linear app', 'linear.app'],
  figma:             ['figma'],
  'adobe-cc':        ['adobe cc', 'adobe creative cloud', 'creative cloud', 'adobe'],
  'microsoft-365':   ['microsoft 365', 'office 365', 'm365'],
  'google-one':      ['google one'],
  dropbox:           ['dropbox'],
  '1password':       ['1password', '1pass'],
  bear:              ['bear app', 'bear notes'],
  things:            ['things 3', 'things app'],
  superhuman:        ['superhuman'],
  hey:               ['hey email', 'hey.com'],
  slack:             ['slack'],
  loom:              ['loom video'],
  zoom:              ['zoom pro', 'zoom one'],
  otter:             ['otter ai', 'otter.ai'],

  // ── creative ──────────────────────────────────────────────────────
  procreate:         ['procreate'],
  lightroom:         ['lightroom'],
  photoshop:         ['photoshop'],
  canva:             ['canva'],

  // ── wellness ──────────────────────────────────────────────────────
  headspace:         ['headspace'],
  calm:              ['calm app', 'calm meditation'],
  aaptiv:            ['aaptiv'],
  strava:            ['strava'],
  whoop:             ['whoop'],
  myfitnesspal:      ['myfitnesspal', 'mfp'],
  noom:              ['noom'],

  // ── dating ────────────────────────────────────────────────────────
  hinge:             ['hinge'],
  tinder:            ['tinder'],
  bumble:            ['bumble'],

  // ── fitness ───────────────────────────────────────────────────────
  peloton:           ['peloton'],
  'apple-fitness':   ['apple fitness+', 'apple fitness plus'],
  classpass:         ['classpass'],

  // ── icloud + apple-managed ────────────────────────────────────────
  icloud:            ['icloud+', 'icloud plus', 'icloud storage'],
  'apple-arcade':    ['apple arcade'],
  'apple-news-plus': ['apple news+', 'apple news plus'],

  // ── news / writing ────────────────────────────────────────────────
  'linkedin-premium': ['linkedin premium'],
  nyt:               ['nyt', 'new york times'],
  wsj:               ['wsj', 'wall street journal'],
  medium:            ['medium.com'],
  substack:          ['substack'],
  patreon:           ['patreon'],
  onlyfans:          ['onlyfans'],

  // ── ai tooling ────────────────────────────────────────────────────
  'chatgpt-plus':    ['chatgpt plus', 'chatgpt pro', 'openai plus'],
  'claude-pro':      ['claude pro', 'claude max'],
  'github-copilot':  ['github copilot', 'copilot'],
} as const;

export type SubscriptionAliasKey = keyof typeof SUBSCRIPTION_ALIASES;

/**
 * Compile a per-key matcher from the alias catalog. Each pattern is a
 * word-boundary regex, case-insensitive. Pre-compiled at module load
 * because the catalog is static.
 *
 * Word-boundary handling: we use `(?:^|[^a-z0-9])` + `(?:[^a-z0-9]|$)`
 * rather than `\b` because `\b` does not work for terms that include
 * non-word characters like `+` (e.g. "disney+", "paramount+"). The
 * custom boundary also correctly rejects "netflixed" matching "netflix".
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_ALIASES).map(([key, terms]) => [
    key,
    terms.map((t) => new RegExp(
      `(?:^|[^a-z0-9])${escapeRegex(t.toLowerCase())}(?:[^a-z0-9]|$)`,
      'i',
    )),
  ]),
);

/**
 * Return the alias-catalog key matched by a free-text needle (typically
 * a stored subscription `name`), or null if no catalog entry matches.
 *
 * Used to bind a user's locally-named subscription ("Spotty Premium")
 * to its canonical catalog key ("spotify") so we can look up the cancel
 * URL and so brain-dump scans use the right term list.
 */
export function matchAliasKey(needle: string): string | null {
  if (!needle) return null;
  const low = needle.toLowerCase();
  for (const [key, regs] of Object.entries(COMPILED)) {
    for (const r of regs) {
      if (r.test(low)) return key;
    }
  }
  return null;
}

/**
 * Count brain-dump entries that mention any term for the given alias
 * key. Returns last-mention timestamp + count. If the key is unknown,
 * returns null (caller should surface inconclusive in the UI).
 */
export interface MentionScan {
  lastMentionAt: number | null;
  countInWindow: number;
}

export function scanMentions(
  aliasKey: string,
  dumps: ReadonlyArray<{ ts: number; text: string }>,
  windowStart: number,
): MentionScan | null {
  const regs = COMPILED[aliasKey];
  if (!regs) return null;
  let lastTs: number | null = null;
  let count = 0;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number' || typeof d.text !== 'string') continue;
    if (d.ts < windowStart) continue;
    for (const r of regs) {
      if (r.test(d.text)) {
        count += 1;
        if (lastTs === null || d.ts > lastTs) lastTs = d.ts;
        break; // one hit per dump entry is enough
      }
    }
  }
  return { lastMentionAt: lastTs, countInWindow: count };
}

/** Number of catalog entries. Exported for telemetry / tests. */
export const SUBSCRIPTION_ALIAS_COUNT = Object.keys(SUBSCRIPTION_ALIASES).length;
