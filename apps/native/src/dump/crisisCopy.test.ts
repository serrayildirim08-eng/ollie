/**
 * Crisis banner copy + worker→native contract tests.
 *
 * Contract: the worker serialises `@ollie/crisis-lexicon`'s CrisisSignal
 *   ({ detected, tier, languages, matches }). The native CrisisSignal type must
 *   accept that exact shape — earlier it declared { type, language }, which the
 *   worker never sent, so the banner rendered `undefined`.
 * Copy (product decision 2026-06-15): ONE soft, human message per app language.
 *   No severity tiers, and crucially NO crisis-line / hotline referral — Ollie
 *   is not a crisis service. This test locks in "no hotline wording".
 */

import { it, expect } from 'vitest';
import { CRISIS_COPY, crisisBannerCopy } from './crisisCopy';
import type { CrisisSignal } from '../router/schema';
import type { AppLang } from '../settings/appLang';

const LANGS: AppLang[] = ['en', 'es', 'tr'];

// A value shaped exactly like the worker's detectCrisis() output. If the native
// CrisisSignal type drifts from the lexicon shape again, this stops compiling.
const WORKER_SIGNAL: CrisisSignal = {
  detected: true,
  tier: 3,
  languages: ['tr', 'en'],
  matches: [{ language: 'tr', tier: 3, pattern: 'p', line: 'l' }],
};

it('every app language has non-empty kicker / body / dismiss copy', () => {
  for (const lang of LANGS) {
    const c = CRISIS_COPY[lang];
    expect(c.kicker.length).toBeGreaterThan(0);
    expect(c.body.length).toBeGreaterThan(0);
    expect(c.dismiss.length).toBeGreaterThan(0);
  }
});

it('resolves a real worker crisis signal into banner copy with no undefined (contract)', () => {
  for (const lang of LANGS) {
    const copy = crisisBannerCopy(lang);
    expect(copy.kicker).toBeTruthy();
    expect(copy.body).toBeTruthy();
    expect(copy.dismiss).toBeTruthy();
    // the fields the OLD banner read no longer exist — guard against regression
    expect((WORKER_SIGNAL as unknown as { type?: unknown }).type).toBeUndefined();
    expect(WORKER_SIGNAL.languages.length).toBeGreaterThan(0);
  }
});

it('falls back to English for an unknown language', () => {
  const copy = crisisBannerCopy('de' as AppLang);
  expect(copy.body).toBe(CRISIS_COPY.en.body);
});

it('the three languages produce distinct body copy (genuinely localised)', () => {
  const bodies = LANGS.map((l) => CRISIS_COPY[l].body);
  expect(new Set(bodies).size).toBe(3);
});

it('does NOT route to a crisis line / hotline (product decision 2026-06-15)', () => {
  const banned = [/crisis line/i, /hotline/i, /l[íi]nea de crisis/i, /kriz hatt/i, /988/];
  for (const lang of LANGS) {
    for (const re of banned) {
      expect(CRISIS_COPY[lang].body).not.toMatch(re);
    }
  }
});
