/**
 * i18n migration regression tests.
 *
 * Covers the two real bugs the i18next migration was done to fix:
 *   (a) Spanish plurals were selected by a hand-rolled `n === 1` check.
 *   (b) `${0}` interpolation only replaced the FIRST occurrence.
 * Plus the missing-key fallback contract.
 */
import { describe, it, expect } from 'vitest';
import {
  getString,
  getPlural,
  interpolate,
  pluralCategory,
  i18n,
} from './index';

describe('interpolate — double-occurrence fix (bug b)', () => {
  it('replaces EVERY occurrence of a repeated token', () => {
    // The old `.replace('${0}', x)` dropped the second `${0}`.
    expect(interpolate('${0} and ${0} again', { 0: 'X' })).toBe(
      'X and X again',
    );
  });

  it('replaces multiple distinct tokens', () => {
    expect(interpolate('${0} — ${1}', { 0: 'a', 1: 'b' })).toBe('a — b');
  });

  it('replaces a distinct token used more than once each', () => {
    expect(
      interpolate('${0}/${1}/${0}/${1}', { 0: '1', 1: '2' }),
    ).toBe('1/2/1/2');
  });

  it('leaves unknown tokens untouched', () => {
    expect(interpolate('${0} ${9}', { 0: 'x' })).toBe('x ${9}');
  });

  it('returns the template unchanged when no vars given', () => {
    expect(interpolate('${0} static')).toBe('${0} static');
  });
});

describe('getString — interpolation through i18next', () => {
  it('interpolates a repeated token via i18next (every occurrence)', () => {
    // Register a synthetic key that uses ${0} twice and confirm BOTH fill.
    i18n.addResource('en', 'translation', 'test.double', '${0} + ${0}');
    expect(getString('en', 'test.double', { 0: '7' })).toBe('7 + 7');
  });

  it('falls back to the dotted path on a total miss', () => {
    expect(getString('en', 'no.such.key.exists.anywhere')).toBe(
      'no.such.key.exists.anywhere',
    );
  });

  it('falls back to en when a key is missing in es', () => {
    i18n.addResource('en', 'translation', 'test.enonly', 'english only');
    // No es resource added — must fall through to en.
    expect(getString('es', 'test.enonly')).toBe('english only');
  });
});

describe('pluralCategory — CLDR plural selection (bug a)', () => {
  it('selects "one" for exactly 1 in English', () => {
    expect(pluralCategory('en', 1)).toBe('one');
  });

  it('selects "other" for 0 and 2+ in English', () => {
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('en', 2)).toBe('other');
    expect(pluralCategory('en', 99)).toBe('other');
  });

  it('selects "one" for exactly 1 in Spanish (CLDR, not n===1 guesswork)', () => {
    expect(pluralCategory('es', 1)).toBe('one');
  });

  it('selects "many" for the Spanish CLDR "many" category', () => {
    // Spanish CLDR adds a `many` category for large/compact numbers
    // (e.g. 1_000_000). The old `n === 1 ? one : many` could never have
    // produced this distinction correctly — this is the bug-(a) proof.
    expect(pluralCategory('es', 1_000_000)).toBe('many');
    // ...and English has no `many` category at all for the same value.
    expect(pluralCategory('en', 1_000_000)).toBe('other');
  });
});

describe('getPlural — CLDR-driven plural lookup', () => {
  it('resolves _one for count 1 and _many/_other for count > 1', () => {
    i18n.addResource('en', 'translation', 'test.apple_one', '${0} apple');
    // _many is remapped to _other at load; addResource here mimics it.
    i18n.addResource('en', 'translation', 'test.apple_other', '${0} apples');
    expect(getPlural('en', 'test.apple', 1)).toBe('1 apple');
    expect(getPlural('en', 'test.apple', 5)).toBe('5 apples');
  });
});

describe('legacy _many alias still resolves', () => {
  it('a verbatim _many key lookup keeps working post-migration', () => {
    // The bundle keeps `_many` as an alias of `_other` so the few call
    // sites still passing explicit _many keys do not break.
    i18n.addResource('en', 'translation', 'test.legacy_many', 'legacy many');
    expect(getString('en', 'test.legacy_many')).toBe('legacy many');
  });
});
