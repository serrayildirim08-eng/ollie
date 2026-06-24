/**
 * Medication cabinet · purpose-map tests.
 *
 * The map is the deterministic fallback that organises the cabinet by purpose
 * with no AI round-trip. Pins the locked name→purpose decisions from the build
 * roadmap + the mock.
 */

import { describe, it, expect } from 'vitest';
import {
  purposeFor,
  coercePurpose,
  purposeLabel,
  MED_PURPOSES,
  PURPOSE_ORDER,
} from './purposeMap';

describe('purposeFor', () => {
  it('sleep: melatonin / magnesium / l-theanine', () => {
    expect(purposeFor('melatonin')).toBe('sleep');
    expect(purposeFor('magnesium')).toBe('sleep');
    expect(purposeFor('magnesium glycinate')).toBe('sleep');
    expect(purposeFor('l-theanine')).toBe('sleep');
  });

  it('mood: sertraline / omega-3', () => {
    expect(purposeFor('sertraline')).toBe('mood');
    expect(purposeFor('omega-3')).toBe('mood');
    expect(purposeFor('Omega 3 fish oil')).toBe('mood');
  });

  it('pain: ibuprofen / acetaminophen', () => {
    expect(purposeFor('ibuprofen')).toBe('pain');
    expect(purposeFor('acetaminophen')).toBe('pain');
    expect(purposeFor('Advil')).toBe('pain');
  });

  it('digestion: omeprazole / probiotic', () => {
    expect(purposeFor('omeprazole')).toBe('digestion');
    expect(purposeFor('probiotic')).toBe('digestion');
    expect(purposeFor('daily probiotics')).toBe('digestion');
  });

  it('vitamins: vitamin d / b12 / iron', () => {
    expect(purposeFor('vitamin d')).toBe('vitamins');
    expect(purposeFor('vitamin b12')).toBe('vitamins');
    expect(purposeFor('b12')).toBe('vitamins');
    expect(purposeFor('iron')).toBe('vitamins');
  });

  it('unknown → other', () => {
    expect(purposeFor('mystery pill')).toBe('other');
    expect(purposeFor('adderall')).toBe('other');
    expect(purposeFor('')).toBe('other');
  });

  it('normalises case + whitespace before matching', () => {
    expect(purposeFor('  MELATONIN  ')).toBe('sleep');
    expect(purposeFor('Vitamin   D')).toBe('vitamins');
  });

  it('sleep wins over vitamins for magnesium (scan order)', () => {
    // magnesium is technically a mineral, but the sleep list is scanned first
    // because magnesium glycinate is the common sleep-support form.
    expect(purposeFor('magnesium')).toBe('sleep');
  });
});

describe('coercePurpose', () => {
  it('passes through valid purposes', () => {
    for (const p of MED_PURPOSES) {
      expect(coercePurpose(p)).toBe(p);
    }
  });

  it('falls back to other for junk', () => {
    expect(coercePurpose('nonsense')).toBe('other');
    expect(coercePurpose(undefined)).toBe('other');
    expect(coercePurpose(42)).toBe('other');
  });
});

describe('purposeLabel', () => {
  it('returns the human label for each purpose', () => {
    expect(purposeLabel('pain')).toBe('pain & inflammation');
    expect(purposeLabel('vitamins')).toBe('vitamins & minerals');
    expect(purposeLabel('sleep')).toBe('sleep');
  });

  it('PURPOSE_ORDER ends in the other catch-all', () => {
    expect(PURPOSE_ORDER[PURPOSE_ORDER.length - 1]!.key).toBe('other');
  });
});
