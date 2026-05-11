export interface CrisisDetectResult {
  match: boolean;
  /** The matched line (first line containing the match), or empty string if no match. */
  line: string;
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
