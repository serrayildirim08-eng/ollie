/**
 * apps/web · country detection (Sprint 5 · F3)
 *
 * Browser-locale → ISO country code. Used by onboarding to seed
 * `shared.settings.country` so the crisis hotline path picks the right
 * line (US → 988, etc.). Pure utility — no React, no store.
 */

export interface SupportedCountry {
  code: string;
  label: string;
}

/** ISO codes that map to a localised crisis hotline string. INTL is the catch-all. */
export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  { code: 'AU', label: 'australia' },
  { code: 'CA', label: 'canada' },
  { code: 'DE', label: 'germany' },
  { code: 'ES', label: 'spain' },
  { code: 'FR', label: 'france' },
  { code: 'GB', label: 'united kingdom' },
  { code: 'IT', label: 'italy' },
  { code: 'NL', label: 'netherlands' },
  { code: 'SE', label: 'sweden' },
  { code: 'TR', label: 'türkiye' },
  { code: 'US', label: 'united states' },
  { code: 'INTL', label: 'somewhere else' },
];

/** Best-effort country code from browser locale. Returns INTL if unknown. */
export function detectCountryFromLocale(): string {
  try {
    if (typeof navigator === 'undefined') return 'INTL';
    const candidates: string[] = [];
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
    for (const raw of candidates) {
      // e.g. "en-US", "fr-CA", "tr-TR", "es-419"
      const region = raw.split(/[-_]/)[1]?.toUpperCase();
      if (region && SUPPORTED_COUNTRIES.some((c) => c.code === region)) {
        return region;
      }
    }
  } catch { /* fall through */ }
  return 'INTL';
}
