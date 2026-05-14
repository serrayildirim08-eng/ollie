/**
 * @ollie/logic · finance · cancel URL catalog
 *
 * Direct deep-links to each service's cancel / manage-subscription page.
 * Used by the Audit Subscriptions surface to launch the provider's own
 * cancel flow when the user taps the cancel button on a row.
 *
 * Keys MUST match the keys used in `subscription-aliases.ts`. If a key
 * exists in the alias catalog but not here, the UI falls back to a
 * generic "manage subscriptions" affordance.
 *
 * Apple-managed subscriptions use the `subscriptions://` deep-link,
 * which on iOS opens the system Settings -> Subscriptions sheet. This
 * is the only legitimate way to surface cancel for in-app-purchase
 * subscriptions billed by Apple — third-party deep-links to the App
 * Store sub page do not exist as public API.
 */

/** iOS deep-link constant — opens Settings > Subscriptions on device. */
export const APPLE_SUBSCRIPTIONS_DEEP_LINK = 'https://apps.apple.com/account/subscriptions';

/**
 * Apple uses `https://apps.apple.com/account/subscriptions` as the
 * universal link that iOS rewrites to the Settings deep-link on device.
 * On the web it opens the App Store account page. Using the universal
 * link instead of `subscriptions://` keeps the URL parseable by the
 * Capacitor Browser plugin and by `new URL()` checks in tests.
 */

export const SUBSCRIPTION_CANCEL_URLS: Record<string, string> = {
  // ── streaming ─────────────────────────────────────────────────────
  netflix:           'https://www.netflix.com/youraccount/cancelplan',
  spotify:           'https://www.spotify.com/account/subscription/',
  'youtube-premium': 'https://www.youtube.com/paid_memberships',
  'youtube-music':   'https://www.youtube.com/paid_memberships',
  'disney-plus':     'https://www.disneyplus.com/account/subscription',
  'hbo-max':         'https://www.max.com/account/subscription',
  hulu:              'https://secure.hulu.com/account',
  'paramount-plus':  'https://www.paramountplus.com/account/manage-subscription/',
  peacock:           'https://www.peacocktv.com/account/plans',
  audible:           'https://www.audible.com/account/membership-details',
  'kindle-unlimited': 'https://www.amazon.com/kindleunlimited/membership',
  'amazon-prime':    'https://www.amazon.com/gp/prime/pipeline/membership',

  // ── apple-managed (in-app-purchase) ───────────────────────────────
  'apple-music':     APPLE_SUBSCRIPTIONS_DEEP_LINK,
  'apple-tv-plus':   APPLE_SUBSCRIPTIONS_DEEP_LINK,
  'apple-arcade':    APPLE_SUBSCRIPTIONS_DEEP_LINK,
  'apple-news-plus': APPLE_SUBSCRIPTIONS_DEEP_LINK,
  'apple-fitness':   APPLE_SUBSCRIPTIONS_DEEP_LINK,
  icloud:            APPLE_SUBSCRIPTIONS_DEEP_LINK,

  // ── productivity ──────────────────────────────────────────────────
  notion:            'https://www.notion.so/my-account',
  linear:            'https://linear.app/settings/billing',
  figma:             'https://www.figma.com/settings/billing',
  'adobe-cc':        'https://account.adobe.com/plans',
  'microsoft-365':   'https://account.microsoft.com/services/',
  'google-one':      'https://one.google.com/storage/management',
  dropbox:           'https://www.dropbox.com/account/plan',
  '1password':       'https://my.1password.com/billing',
  superhuman:        'https://mail.superhuman.com/settings/billing',
  hey:               'https://app.hey.com/subscription',
  slack:             'https://my.slack.com/admin/billing',
  loom:              'https://www.loom.com/settings/billing',
  zoom:              'https://zoom.us/billing',
  otter:             'https://otter.ai/account/subscription',

  // ── creative ──────────────────────────────────────────────────────
  lightroom:         'https://account.adobe.com/plans',
  photoshop:         'https://account.adobe.com/plans',
  canva:             'https://www.canva.com/settings/billing-and-teams',

  // ── wellness ──────────────────────────────────────────────────────
  headspace:         'https://www.headspace.com/subscription',
  calm:              'https://www.calm.com/profile/subscription',
  strava:            'https://www.strava.com/subscription/manage',
  whoop:             'https://www.whoop.com/membership',
  myfitnesspal:      'https://www.myfitnesspal.com/account/subscription',
  noom:              'https://www.noom.com/account/',

  // ── dating ────────────────────────────────────────────────────────
  hinge:             'https://hinge.co/account',
  tinder:            'https://tinder.com/account',
  bumble:            'https://bumble.com/get-started',

  // ── fitness ───────────────────────────────────────────────────────
  peloton:           'https://members.onepeloton.com/preferences/membership',
  classpass:         'https://classpass.com/account/billing',

  // ── news / writing ────────────────────────────────────────────────
  'linkedin-premium': 'https://www.linkedin.com/premium/manage/',
  nyt:               'https://www.nytimes.com/subscription/manage',
  wsj:               'https://customercenter.wsj.com/view/membership',
  medium:            'https://medium.com/me/membership',
  substack:          'https://substack.com/account/billing',
  patreon:           'https://www.patreon.com/settings/memberships',

  // ── ai tooling ────────────────────────────────────────────────────
  'chatgpt-plus':    'https://chat.openai.com/#settings/Subscription',
  'claude-pro':      'https://claude.ai/settings/billing',
  'github-copilot':  'https://github.com/settings/copilot',
};

/** Number of cancel URLs catalogued. Exported for telemetry / tests. */
export const SUBSCRIPTION_CANCEL_URL_COUNT = Object.keys(SUBSCRIPTION_CANCEL_URLS).length;

/**
 * Resolve the cancel URL for a subscription alias key. Returns null
 * when the key has no catalogued URL (the UI shows a "manage manually"
 * affordance instead).
 */
export function getCancelUrl(aliasKey: string | null | undefined): string | null {
  if (!aliasKey) return null;
  return SUBSCRIPTION_CANCEL_URLS[aliasKey] ?? null;
}

/** True if this alias key is billed by Apple (in-app purchase). */
export function isAppleManaged(aliasKey: string | null | undefined): boolean {
  if (!aliasKey) return false;
  return SUBSCRIPTION_CANCEL_URLS[aliasKey] === APPLE_SUBSCRIPTIONS_DEEP_LINK;
}
