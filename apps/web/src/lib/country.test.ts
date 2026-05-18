/**
 * Sprint 5 · F3 · onboarding country auto-detection.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectCountryFromLocale } from './country';

const original = {
  language: typeof navigator !== 'undefined' ? navigator.language : '',
  languages: typeof navigator !== 'undefined' ? [...(navigator.languages ?? [])] : [],
};

function setNavigator(language: string, languages: string[]): void {
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    get: () => language,
  });
  Object.defineProperty(navigator, 'languages', {
    configurable: true,
    get: () => languages,
  });
}

afterEach(() => {
  setNavigator(original.language, original.languages);
  vi.restoreAllMocks();
});

describe('detectCountryFromLocale (F3)', () => {
  it('en-US → US', () => {
    setNavigator('en-US', ['en-US']);
    expect(detectCountryFromLocale()).toBe('US');
  });

  it('tr-TR → TR', () => {
    setNavigator('tr-TR', ['tr-TR']);
    expect(detectCountryFromLocale()).toBe('TR');
  });

  it('fr-CA → CA', () => {
    setNavigator('fr-CA', ['fr-CA']);
    expect(detectCountryFromLocale()).toBe('CA');
  });

  it('en-GB → GB', () => {
    setNavigator('en-GB', ['en-GB']);
    expect(detectCountryFromLocale()).toBe('GB');
  });

  it('falls through navigator.languages list', () => {
    setNavigator('en', ['en', 'es-ES']);
    expect(detectCountryFromLocale()).toBe('ES');
  });

  it('unknown region → INTL', () => {
    setNavigator('zh-CN', ['zh-CN']);
    expect(detectCountryFromLocale()).toBe('INTL');
  });

  it('no region tag → INTL', () => {
    setNavigator('en', ['en']);
    expect(detectCountryFromLocale()).toBe('INTL');
  });
});
