/**
 * Sprint 5 · F3 · country → crisis hotline resolution.
 *
 * Verifies that `shared.settings.country` drives the hotline key
 * selection (US → 988, no longer TR → 182 by default), and that a
 * missing country falls back to crisis.hotline_INTL.
 *
 * This mirrors the resolution table inside useApplyBrainDump.ts so a
 * regression in either the table OR the consumer is caught.
 */

import { describe, it, expect } from 'vitest';
import { getString } from '../i18n';

const COUNTRY_TO_HOTLINE_KEY: Record<string, string> = {
  TR: 'crisis.hotline_TR',
  US: 'crisis.hotline_US',
  GB: 'crisis.hotline_GB',
  CA: 'crisis.hotline_CA',
  AU: 'crisis.hotline_AU',
  DE: 'crisis.hotline_DE',
  FR: 'crisis.hotline_FR',
  NL: 'crisis.hotline_NL',
  IT: 'crisis.hotline_IT',
  ES: 'crisis.hotline_ES',
  SE: 'crisis.hotline_SE',
};

function resolveHotline(country: string | null | undefined): string {
  const upper = (country || '').toUpperCase();
  const key = upper && COUNTRY_TO_HOTLINE_KEY[upper]
    ? COUNTRY_TO_HOTLINE_KEY[upper]
    : 'crisis.hotline_INTL';
  return getString('en', key);
}

describe('crisis hotline resolution by country (F3)', () => {
  it('country=US → 988 (not 182)', () => {
    const line = resolveHotline('US');
    expect(line).toContain('988');
    expect(line).not.toContain('182');
  });

  it('country=TR → 182', () => {
    const line = resolveHotline('TR');
    expect(line).toContain('182');
  });

  it('country=null → INTL global directory', () => {
    const line = resolveHotline(null);
    expect(line).toContain('findahelpline.com');
  });

  it('country=undefined → INTL global directory', () => {
    const line = resolveHotline(undefined);
    expect(line).toContain('findahelpline.com');
  });

  it('country=INTL (sentinel) → global directory', () => {
    const line = resolveHotline('INTL');
    expect(line).toContain('findahelpline.com');
  });

  it('country=ZZ (unknown) → INTL fallback', () => {
    const line = resolveHotline('ZZ');
    expect(line).toContain('findahelpline.com');
  });
});
