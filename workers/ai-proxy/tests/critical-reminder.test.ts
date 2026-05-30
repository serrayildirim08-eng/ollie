/**
 * critical-reminder.test.ts — smoke test for isCriticalReminder().
 *
 * Backs the Plan B push-default gate (locked 2026-05-30 by Serra):
 * pantry rows for these canonicals default to remind_me=true on insert;
 * everything else defaults to silent shopping-list add only.
 *
 * Coverage:
 *   - wellness category → critical (zoloft would-be / actually-shipped
 *     vitamin c, melatonin, ibuprofen, eye drops)
 *   - pet category → critical (dog kibble, cat litter, flea treatment)
 *   - personal_care subset → critical (tampons, contact solution, diapers)
 *   - aliases resolve to canonical category check (tampones → tampons → true)
 *   - non-critical canonicals → false (milk, coffee, bar soap)
 *   - garbage in → false (empty / non-string / unknown)
 */

import { describe, it, expect } from 'vitest';
import {
  isCriticalReminder,
  CRITICAL_REMINDER_CANONICAL,
} from '../src/modules/grocery.config';

describe('isCriticalReminder · wellness category default', () => {
  it.each([
    'vitamin c',
    'vitamin d',
    'multivitamin',
    'melatonin',
    'ibuprofen',
    'tylenol',
    'aspirin',
    'eye drops',
    'cough syrup',
    'probiotic',
    'fish oil',
    'hand sanitizer',
  ])('%s → true (wellness)', (canon) => {
    expect(isCriticalReminder(canon)).toBe(true);
  });
});

describe('isCriticalReminder · pet category default', () => {
  it.each([
    'dry kibble',
    'cat kibble',
    'dog kibble',
    'wet food can',
    'cat litter',
    'flea treatment',
    'tick treatment',
    'pet vitamins',
    'cat treats',
    'dog treats',
    'fish food',
  ])('%s → true (pet)', (canon) => {
    expect(isCriticalReminder(canon)).toBe(true);
  });
});

describe('isCriticalReminder · personal_care explicit subset', () => {
  it.each([
    'tampons',
    'pads',
    'panty liners',
    'liners',
    'menstrual cup',
    'diapers',
    'baby wipes',
    'contact solution',
    'contacts',
  ])('%s → true (explicit critical set)', (canon) => {
    expect(isCriticalReminder(canon)).toBe(true);
  });
});

describe('isCriticalReminder · alias resolution', () => {
  it('Turkish "tampon" → tampons → true', () => {
    expect(isCriticalReminder('tampon')).toBe(true);
  });

  it('Spanish "tampones" → tampons → true', () => {
    expect(isCriticalReminder('tampones')).toBe(true);
  });

  it('Spanish "vitamina c" → vitamin c → true (wellness)', () => {
    expect(isCriticalReminder('vitamina c')).toBe(true);
  });

  it('Turkish "kedi maması" → cat kibble → true (pet)', () => {
    expect(isCriticalReminder('kedi maması')).toBe(true);
  });

  it('Spanish "arena para gato" → cat litter → true (pet)', () => {
    expect(isCriticalReminder('arena para gato')).toBe(true);
  });

  it('Spanish "pañal" → diapers → true (explicit critical set)', () => {
    expect(isCriticalReminder('pañal')).toBe(true);
  });
});

describe('isCriticalReminder · NOT critical (regression guard)', () => {
  it.each([
    'milk',
    'coffee',
    'bar soap',          // personal_care but NOT in critical set
    'shampoo',           // personal_care but NOT in critical set
    'toothpaste',        // personal_care but NOT in critical set
    'apple',
    'chicken',
    'rice',
    'olive oil',
    'bread',
    'wine',
  ])('%s → false', (canon) => {
    expect(isCriticalReminder(canon)).toBe(false);
  });
});

describe('isCriticalReminder · case-insensitivity + whitespace', () => {
  it('uppercase / mixed case canonical', () => {
    expect(isCriticalReminder('TAMPONS')).toBe(true);
    expect(isCriticalReminder('Vitamin C')).toBe(true);
    expect(isCriticalReminder('Dog Kibble')).toBe(true);
  });

  it('surrounding whitespace tolerated', () => {
    expect(isCriticalReminder('  tampons  ')).toBe(true);
    expect(isCriticalReminder('\tvitamin c\n')).toBe(true);
  });
});

describe('isCriticalReminder · garbage input', () => {
  it('empty string → false', () => {
    expect(isCriticalReminder('')).toBe(false);
  });

  it('whitespace only → false', () => {
    expect(isCriticalReminder('   ')).toBe(false);
  });

  it('non-string → false', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isCriticalReminder(null as any)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isCriticalReminder(undefined as any)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isCriticalReminder(42 as any)).toBe(false);
  });

  it('unknown canonical not in any list → false', () => {
    expect(isCriticalReminder('xyzzy-not-a-real-item')).toBe(false);
  });
});

describe('CRITICAL_REMINDER_CANONICAL set shape', () => {
  it('contains the documented period products', () => {
    expect(CRITICAL_REMINDER_CANONICAL.has('tampons')).toBe(true);
    expect(CRITICAL_REMINDER_CANONICAL.has('pads')).toBe(true);
    expect(CRITICAL_REMINDER_CANONICAL.has('menstrual cup')).toBe(true);
  });

  it('contains the documented baby supplies', () => {
    expect(CRITICAL_REMINDER_CANONICAL.has('diapers')).toBe(true);
    expect(CRITICAL_REMINDER_CANONICAL.has('baby wipes')).toBe(true);
    expect(CRITICAL_REMINDER_CANONICAL.has('baby formula')).toBe(true);
  });

  it('contains contact lens canonicals', () => {
    expect(CRITICAL_REMINDER_CANONICAL.has('contact solution')).toBe(true);
    expect(CRITICAL_REMINDER_CANONICAL.has('contacts')).toBe(true);
  });

  it('does NOT contain non-critical personal_care items', () => {
    expect(CRITICAL_REMINDER_CANONICAL.has('shampoo')).toBe(false);
    expect(CRITICAL_REMINDER_CANONICAL.has('bar soap')).toBe(false);
  });
});
