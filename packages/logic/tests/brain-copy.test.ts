/**
 * @ollie/logic · brain · "speak in your words" — copy + actions unit tests
 *
 * Sprint 3. Covers the PURE pieces:
 *   - resolveLang coerces stored values → en/es/tr (default en)
 *   - copyKindOf maps category/module → coarse kind
 *   - buildCopyPrompt bakes in the calm/neutral voice + target language + offer
 *   - fallbackCopy is never blank, resolves all three languages, and matches
 *     Serra's locked milk example shape
 *   - the action descriptors carry trilingual labels + a serialisable payload
 */

import { describe, it, expect } from 'vitest';
import {
  resolveLang,
  copyKindOf,
  buildCopyPrompt,
  fallbackCopy,
  APP_LANGS,
  buildAddToGroceryListAction,
  actionLabel,
  type CopyFacts,
} from '../src/brain';

describe('resolveLang', () => {
  it('passes through the three shipping langs', () => {
    expect(resolveLang('en')).toBe('en');
    expect(resolveLang('es')).toBe('es');
    expect(resolveLang('tr')).toBe('tr');
  });
  it('strips region tags + casing', () => {
    expect(resolveLang('en-US')).toBe('en');
    expect(resolveLang('ES_419')).toBe('es');
    expect(resolveLang('TR')).toBe('tr');
  });
  it('defaults unknown / empty to en', () => {
    expect(resolveLang('fr')).toBe('en');
    expect(resolveLang('')).toBe('en');
    expect(resolveLang(null)).toBe('en');
    expect(resolveLang(undefined)).toBe('en');
  });
  it('exposes exactly en/es/tr', () => {
    expect([...APP_LANGS]).toEqual(['en', 'es', 'tr']);
  });
});

describe('copyKindOf', () => {
  it('maps the milk replenish category', () => {
    expect(copyKindOf({ category: 'grocery-replenish-needed', module: 'grocery' })).toBe('replenish');
  });
  it('maps protected kinds', () => {
    expect(copyKindOf({ category: 'deadline_passed' })).toBe('deadline');
    expect(copyKindOf({ category: 'missed' })).toBe('deadline');
    expect(copyKindOf({ category: 'late' })).toBe('bill');
    expect(copyKindOf({ category: 'spoiled' })).toBe('spoiled');
  });
  it('maps the finance duplicate-charge category (no longer generic)', () => {
    expect(copyKindOf({ category: 'duplicate', module: 'finance' })).toBe('duplicate');
  });
  it('maps period products to replenish', () => {
    expect(copyKindOf({ category: 'period_products', module: 'grocery' })).toBe('replenish');
  });
  it('falls back to generic', () => {
    expect(copyKindOf({ category: 'who-knows', module: 'work' })).toBe('generic');
    expect(copyKindOf({})).toBe('generic');
  });
});

describe('fallbackCopy — duplicate kind is calm + never the generic placeholder', () => {
  it('phrases a possible double charge as a soft question, never "generic"', () => {
    const dup = { kind: 'duplicate' as const, item: 'spotify', days: null, otherCount: null, action: null };
    for (const lang of ['en', 'es', 'tr'] as const) {
      const s = fallbackCopy(dup, lang);
      expect(s.length).toBeGreaterThan(0);
      expect(s.toLowerCase()).not.toContain('generic');
    }
    expect(fallbackCopy(dup, 'en')).toContain('spotify');
  });
});

describe('buildCopyPrompt', () => {
  const facts: CopyFacts = { kind: 'replenish', item: 'milk', days: 2, action: 'add_to_grocery_list' };

  it('targets the right language by name', () => {
    expect(buildCopyPrompt(facts, 'tr').system).toContain('Turkish');
    expect(buildCopyPrompt(facts, 'es').system).toContain('Spanish');
    expect(buildCopyPrompt(facts, 'en').system).toContain('English');
  });
  it('enforces the calm/neutral one-sentence + no-shame voice', () => {
    const { system } = buildCopyPrompt(facts, 'en');
    expect(system.toLowerCase()).toContain('calm');
    expect(system.toLowerCase()).toContain('one short');
    expect(system).toMatch(/never (nag|shame)/i);
    expect(system.toLowerCase()).toContain('never mention streaks');
  });
  it('mentions the offered action when present, omits when not', () => {
    expect(buildCopyPrompt(facts, 'en').system.toLowerCase()).toContain('shopping list');
    const noAction = buildCopyPrompt({ kind: 'spoiled', item: null }, 'en');
    expect(noAction.system.toLowerCase()).toContain('do not invent an action');
  });
  it('passes the facts into the user prompt', () => {
    const { user } = buildCopyPrompt(facts, 'en');
    expect(user).toContain('replenish');
    expect(user).toContain('milk');
    expect(user).toContain('days past: 2');
  });
});

describe('fallbackCopy — trilingual, never blank', () => {
  const milk: CopyFacts = { kind: 'replenish', item: 'milk', action: 'add_to_grocery_list' };

  it('produces Serra’s locked milk shape in TR', () => {
    // "süt büyük ihtimalle bitti. listene ekleyeyim mi?"
    const tr = fallbackCopy(milk, 'tr');
    expect(tr).toContain('milk');
    expect(tr).toContain('büyük ihtimalle bitti');
    expect(tr).toContain('listene ekleyeyim mi?');
  });
  it('produces the EN reference shape', () => {
    expect(fallbackCopy(milk, 'en')).toBe("you're probably out of milk. want it back on the list?");
  });
  it('produces ES', () => {
    expect(fallbackCopy(milk, 'es')).toContain('se te acabó milk');
    expect(fallbackCopy(milk, 'es')).toContain('¿lo pongo en la lista?');
  });
  it('handles the multi-item shape', () => {
    const many: CopyFacts = { kind: 'replenish', item: 'milk', otherCount: 2 };
    expect(fallbackCopy(many, 'en')).toContain('2 others');
    expect(fallbackCopy(many, 'tr')).toContain('2 şey daha');
  });
  it('every kind × lang is a non-empty calm sentence', () => {
    const kinds: CopyFacts['kind'][] = ['replenish', 'deadline', 'bill', 'spoiled', 'generic'];
    for (const kind of kinds) {
      for (const lang of APP_LANGS) {
        const s = fallbackCopy({ kind, item: 'x' }, lang);
        expect(s.length).toBeGreaterThan(0);
        expect(s).not.toContain('!'); // no gushy exclamation
      }
    }
  });
  it('never blanks on a missing item', () => {
    expect(fallbackCopy({ kind: 'replenish' }, 'en')).toContain('something');
    expect(fallbackCopy({ kind: 'replenish' }, 'tr')).toContain('bir şey');
  });
});

describe('action descriptors', () => {
  it('builds the grocery-list action with a localised label + payload', () => {
    const action = buildAddToGroceryListAction(['milk'], 'tr');
    expect(action).not.toBeNull();
    expect(action!.kind).toBe('add_to_grocery_list');
    expect(action!.label).toBe('listeye ekle');
    expect(action!.payload).toEqual({ kind: 'add_to_grocery_list', names: ['milk'] });
  });
  it('localises the accept label across languages', () => {
    expect(actionLabel('add_to_grocery_list', 'en')).toBe('add to list');
    expect(actionLabel('add_to_grocery_list', 'es')).toBe('añadir a la lista');
    expect(actionLabel('add_to_grocery_list', 'tr')).toBe('listeye ekle');
  });
  it('returns null when there is nothing to add', () => {
    expect(buildAddToGroceryListAction([], 'en')).toBeNull();
    expect(buildAddToGroceryListAction(['', '  '], 'en')).toBeNull();
  });
  it('trims + drops empty names', () => {
    const action = buildAddToGroceryListAction(['  milk ', '', 'eggs'], 'en');
    expect(action!.payload.kind).toBe('add_to_grocery_list');
    if (action!.payload.kind !== 'add_to_grocery_list') throw new Error('wrong kind');
    expect(action!.payload.names).toEqual(['milk', 'eggs']);
  });
});
