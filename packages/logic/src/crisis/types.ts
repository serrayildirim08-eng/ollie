/** Language of a crisis match — drives which response copy is shown. */
export type CrisisLang = 'en' | 'es' | 'tr';

export interface CrisisDetectResult {
  match: boolean;
  /** The matched line (first line containing the match), or empty string if no match. */
  line: string;
  /**
   * Language to answer in. `'tr'` when a Turkish phrase matched (the only
   * signal that the user wants Turkish — the app UI itself is en/es only);
   * otherwise the caller-supplied app locale. `'en'` when there is no match.
   */
  lang: CrisisLang;
}

/**
 * Country hotline entry. `secondary` is null when no secondary line exists for
 * that country (e.g. INTL directory). Both label fields describe the service.
 */
export interface CrisisHotline {
  primary: string;
  primary_label: string;
  secondary: string | null;
  secondary_label: string | null;
}
