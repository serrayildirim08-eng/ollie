/**
 * apps/web · i18n (i18next)
 *
 * Migrated 2026-05-18 from a hand-rolled `getString` lookup to i18next +
 * react-i18next. The migration fixes two real bugs the old code shipped:
 *
 *   (a) PLURALS — the old code picked `_one` / `_many` by hand with
 *       `n === 1 ? one : many`. That is wrong for any language whose
 *       CLDR plural set is not {one, other}, and it bypassed CLDR even
 *       for Spanish. i18next selects the plural category from the CLDR
 *       rules for the active locale. We keep the existing `_one`/`_many`
 *       JSON convention by remapping `_many` → i18next's `_other` suffix
 *       at load time (see `toI18nextBundle`).
 *
 *   (b) INTERPOLATION — the old code did `.replace('${0}', x)`, and
 *       String.prototype.replace with a string pattern only replaces the
 *       FIRST occurrence. A string that used `${0}` twice silently
 *       dropped the second. i18next's interpolation replaces EVERY
 *       occurrence. We configure i18next's interpolation delimiters to
 *       `${` … `}` so the existing `${0}` / `${1}` tokens in the JSON
 *       keep working unchanged.
 *
 * Public API is deliberately UNCHANGED so the ~60 existing call sites do
 * not have to be rewritten:
 *   - `getString(locale, path, vars?)` — plain lookup + interpolation
 *   - `Locale` type
 * New helpers layered on top:
 *   - `interpolate(template, vars)` — fix-(b)-correct token substitution
 *   - `getPlural(locale, baseKey, count, vars?)` — CLDR plural lookup
 *   - `i18n` — the configured i18next instance (for react-i18next)
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './strings.en.json';
import enLiteral from './strings.en.literal.json';
import es from './strings.es.json';

/**
 * Supported locales. `en-literal` is the "say it plainly" register used
 * by a few surfaces — i18next treats it as its own language.
 */
export type Locale = 'en' | 'es' | 'en-literal';

const RAW_BUNDLES: Record<Locale, Record<string, unknown>> = {
  en: en as Record<string, unknown>,
  es: es as Record<string, unknown>,
  'en-literal': enLiteral as Record<string, unknown>,
};

/**
 * Recursively prepare a JSON bundle for i18next.
 *
 * The JSON files author plurals as `<base>_one` / `<base>_many`. i18next's
 * CLDR plural resolution expects `<base>_one` / `<base>_other`. We emit
 * BOTH suffixes for every `_many` key:
 *
 *   - `<base>_other` — what `getPlural()` / i18next's `count` resolves to,
 *     so plural selection is CLDR-correct for every locale (bug-(a) fix).
 *   - `<base>_many`  — kept as a verbatim alias so the handful of legacy
 *     call sites still doing `getString(locale, '<base>_many')` keep
 *     working during the incremental migration to `getPlural()`.
 *
 * `_one` and `_zero` are already i18next-native and pass through unchanged.
 */
function toI18nextBundle(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toI18nextBundle);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const prepared = toI18nextBundle(value);
      out[key] = prepared;
      if (key.endsWith('_many')) {
        out[`${key.slice(0, -'_many'.length)}_other`] = prepared;
      }
    }
    return out;
  }
  return node;
}

const IS_DEV = (() => {
  try {
    return Boolean(
      (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
    );
  } catch {
    return false;
  }
})();

/**
 * Missing-key handler. The old `getString` returned the raw dotted path
 * (e.g. `cycle.record.title`) straight into the UI when a key was absent
 * — a silent content bug that shipped the key name to users. i18next
 * still falls back to `en`, but on a genuine miss we warn loudly in dev
 * so it gets caught before release; in prod we stay quiet (the `en`
 * fallback below is the safety net).
 */
function missingKeyHandler(
  lngs: readonly string[],
  _ns: string,
  key: string,
): void {
  if (IS_DEV && typeof console !== 'undefined') {
    console.warn(
      `[i18n] missing key "${key}" for locale(s) [${lngs.join(', ')}] — ` +
        'falling back to en. Add it to strings.<locale>.json.',
    );
  }
}

i18next.use(initReactI18next).init({
  resources: {
    en: { translation: toI18nextBundle(RAW_BUNDLES.en) as object },
    es: { translation: toI18nextBundle(RAW_BUNDLES.es) as object },
    'en-literal': {
      translation: toI18nextBundle(RAW_BUNDLES['en-literal']) as object,
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  // Keys are dotted paths into nested objects; '.' is the separator and
  // there is no namespace prefix in our paths.
  keySeparator: '.',
  nsSeparator: false,
  interpolation: {
    // React already escapes — and our values are plain UI copy, not HTML.
    escapeValue: false,
    // Keep the legacy `${0}` token syntax working. Unlike the old
    // String.replace, i18next replaces EVERY occurrence (bug-(b) fix).
    prefix: '${',
    suffix: '}',
  },
  // Surface real misses in dev; never throw.
  saveMissing: false,
  missingKeyHandler,
  returnNull: false,
  returnEmptyString: false,
});

export const i18n = i18next;

/** Variables for `${0}` / named `${token}` interpolation. */
export type InterpolationVars = Record<string, string | number>;

/**
 * Substitute every `${token}` in `template` with the matching entry in
 * `vars`. Unlike `String.prototype.replace(string, …)`, this replaces ALL
 * occurrences of a token — the fix for the old double-interpolation bug.
 *
 * Exposed standalone so callers holding a raw template string (not a key)
 * get the same correct behavior.
 */
export function interpolate(template: string, vars?: InterpolationVars): string {
  if (!vars) return template;
  return template.replace(/\$\{([^}]+)\}/g, (whole, token: string) => {
    const v = vars[token];
    return v === undefined ? whole : String(v);
  });
}

/**
 * Look up a translated string by dotted path.
 *
 * @param locale active locale; unknown locales fall back to `en`.
 * @param path   dotted key path, e.g. `cycle.record.title`.
 * @param vars   optional interpolation vars. Numeric `${0}` tokens map to
 *               keys `'0'`, `'1'`, … ; named tokens map by name.
 *
 * Backward-compatible with the pre-i18next signature: `getString(locale,
 * path)` still works. On a total miss the dotted path is returned (same
 * as before) so nothing crashes.
 */
export function getString(
  locale: Locale,
  path: string,
  vars?: InterpolationVars,
): string {
  const value = i18next.t(path, {
    lng: locale,
    ...(vars ?? {}),
    // If even the `en` fallback lacks the key, return the path itself —
    // preserves the old contract that getString never returns undefined.
    defaultValue: path,
  });
  return typeof value === 'string' ? value : path;
}

/**
 * The CLDR plural category for `count` in `locale` — one of `zero`,
 * `one`, `two`, `few`, `many`, `other`. Driven by `Intl.PluralRules`,
 * the same CLDR data i18next uses. Exposed for the rare caller whose JSON
 * uses different interpolation tokens per plural form and therefore needs
 * to branch on the category itself rather than let i18next interpolate.
 */
export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  const lng = locale === 'en-literal' ? 'en' : locale;
  try {
    return new Intl.PluralRules(lng).select(count);
  } catch {
    return new Intl.PluralRules('en').select(count);
  }
}

/**
 * CLDR-correct plural lookup. Given a base key (no `_one`/`_many` suffix)
 * and a count, i18next resolves the right plural form for `locale` using
 * the CLDR rules — NOT a hand-rolled `n === 1` check.
 *
 * The JSON authors keep writing `<base>_one` / `<base>_many`; the load-time
 * remap turns `_many` into i18next's `_other`, so `getPlural(locale,
 * 'cycle.next.cycles_logged', n)` resolves `cycles_logged_one` /
 * `cycles_logged_other` automatically.
 *
 * The count is also injected as the `${0}` interpolation var (and as the
 * named `count` var) so a template like `"${0} cycles logged"` fills in
 * without the caller wiring it twice.
 */
export function getPlural(
  locale: Locale,
  baseKey: string,
  count: number,
  vars?: InterpolationVars,
): string {
  const value = i18next.t(baseKey, {
    lng: locale,
    count,
    '0': count,
    ...(vars ?? {}),
    defaultValue: baseKey,
  });
  return typeof value === 'string' ? value : baseKey;
}
