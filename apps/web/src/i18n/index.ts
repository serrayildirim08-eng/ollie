import en from './strings.en.json';
import enLiteral from './strings.en.literal.json';
import es from './strings.es.json';

const STRINGS = { en, 'en-literal': enLiteral, es } as const;

export type Locale = keyof typeof STRINGS;

export function getString(locale: Locale, path: string): string {
  const lookup = (root: unknown): string | undefined => {
    let node: unknown = root;
    for (const part of path.split('.')) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return typeof node === 'string' ? node : undefined;
  };

  return lookup(STRINGS[locale]) ?? lookup(STRINGS.en) ?? path;
}

/**
 * Variables for `${0}` / named `${token}` interpolation.
 *
 * Ported net-additively from the audit-infra commits so callers (e.g.
 * CycleModule) compile against a stable API ahead of the full i18next
 * migration. When that migration lands these signatures stay; only the
 * lookup mechanism behind them changes.
 */
export type InterpolationVars = Record<string, string | number>;

/**
 * Substitute every `${token}` in `template` with the matching entry in
 * `vars`. Unlike `String.prototype.replace(string, …)`, this replaces
 * ALL occurrences of a token.
 */
export function interpolate(template: string, vars?: InterpolationVars): string {
  if (!vars) return template;
  return template.replace(/\$\{([^}]+)\}/g, (whole, token: string) => {
    const v = vars[token];
    return v === undefined ? whole : String(v);
  });
}

/**
 * The CLDR plural category for `count` in `locale`. Driven by
 * `Intl.PluralRules` so callers can pick `_one` / `_other` (or finer
 * categories) themselves when the JSON branches by form.
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
 * CLDR-correct plural lookup. Given a base key and a count, picks the
 * right `<base>_<form>` string from the JSON bundle and runs interpolation.
 *
 * Resolution order for the form:
 *   1. `<base>_<cldr-category>` (e.g. `_one`, `_few`, `_many`, `_other`)
 *   2. `<base>_many`  (legacy convention used in the existing JSON)
 *   3. `<base>_other` (i18next-standard)
 *   4. `<base>` itself
 *
 * The count is injected as both `${0}` and the named `${count}` var so
 * either token style in the JSON fills in without the caller wiring it
 * twice.
 */
export function getPlural(
  locale: Locale,
  baseKey: string,
  count: number,
  vars?: InterpolationVars,
): string {
  const category = pluralCategory(locale, count);
  const candidates = [`${baseKey}_${category}`, `${baseKey}_many`, `${baseKey}_other`, baseKey];
  const merged: InterpolationVars = { 0: count, count, ...(vars ?? {}) };
  for (const key of candidates) {
    const raw = getString(locale, key);
    if (raw !== key) {
      return interpolate(raw, merged);
    }
  }
  return interpolate(baseKey, merged);
}
