/**
 * Crisis banner copy + worker→native contract tests (audit #1 + #2).
 *
 * #1: the worker serialises `@ollie/crisis-lexicon`'s CrisisSignal
 *     ({ detected, tier, languages, matches }). The native CrisisSignal type
 *     must accept that exact shape — earlier it declared { type, language },
 *     which the worker never sent, so the banner rendered `undefined`.
 * #2: banner copy must resolve in all three app languages, with a calmer
 *     "heavy" tone below tier 4 and an "urgent" tone at tier 4.
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

it('every app language has non-empty kicker / heavy / urgent / dismiss copy', () => {
  for (const lang of LANGS) {
    const c = CRISIS_COPY[lang];
    expect(c.kicker.length).toBeGreaterThan(0);
    expect(c.heavy.length).toBeGreaterThan(0);
    expect(c.urgent.length).toBeGreaterThan(0);
    expect(c.dismiss.length).toBeGreaterThan(0);
  }
});

it('tier < 4 uses the heavy tone; tier 4 uses the urgent tone', () => {
  for (const lang of LANGS) {
    expect(crisisBannerCopy(lang, 2).body).toBe(CRISIS_COPY[lang].heavy);
    expect(crisisBannerCopy(lang, 3).body).toBe(CRISIS_COPY[lang].heavy);
    expect(crisisBannerCopy(lang, 4).body).toBe(CRISIS_COPY[lang].urgent);
  }
});

it('resolves a real worker crisis signal into banner copy with no undefined (contract)', () => {
  for (const lang of LANGS) {
    const copy = crisisBannerCopy(lang, WORKER_SIGNAL.tier);
    expect(copy.kicker).toBeTruthy();
    expect(copy.body).toBeTruthy();
    expect(copy.dismiss).toBeTruthy();
    // the fields the OLD banner read no longer exist — guard against regression
    expect((WORKER_SIGNAL as unknown as { type?: unknown }).type).toBeUndefined();
    expect(WORKER_SIGNAL.languages.length).toBeGreaterThan(0);
  }
});

it('falls back to English for an unknown language', () => {
  const copy = crisisBannerCopy('de' as AppLang, 2);
  expect(copy.body).toBe(CRISIS_COPY.en.heavy);
});

it('the three languages produce distinct heavy copy (genuinely localised)', () => {
  const bodies = LANGS.map((l) => CRISIS_COPY[l].heavy);
  expect(new Set(bodies).size).toBe(3);
});
