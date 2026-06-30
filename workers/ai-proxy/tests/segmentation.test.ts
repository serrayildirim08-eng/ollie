/**
 * Pass-1 segmentation — the list-vs-clause distinction.
 *
 * REGRESSION ANCHOR (prod 2026-06-30): Serra dumped a 3-item shopping list and
 * only 1 item was captured. Root cause: pass-1 split the enumeration at its
 * list-joiner conjunction ("ve"/"and"), so the buy verb attached to only one
 * fragment and the bare-noun fragments fell to dump_only and were lost.
 *
 * The fix makes pass-1 split at a conjunction ONLY when BOTH sides carry their
 * own verb (are clause-like). A list joiner / compound name joins a bare noun
 * phrase, so the enumeration is kept whole and reaches the classifier with its
 * buy verb — then routes to ONE grocery action whose item string the client's
 * splitGroceryList itemizes.
 *
 * These tests assert the deterministic guarantee: the list is NOT shattered
 * (so nothing can fall to dump_only), while genuine multi-intent dumps still
 * split.
 */

import { describe, expect, it } from 'vitest';
import { pass1Segment } from '../src/router/segmentation';

const texts = (dump: string, locale = 'tr') =>
  pass1Segment(dump, locale).fragments.map((f) => f.text);

describe('pass1Segment — grocery/shopping list stays ONE fragment (not shattered to dump_only)', () => {
  it('TR: "süt, yumurta ve ekmek almam lazım" → one fragment with all 3 items + the buy verb', () => {
    const frags = texts('süt, yumurta ve ekmek almam lazım');
    expect(frags).toHaveLength(1);
    const [only] = frags;
    for (const item of ['süt', 'yumurta', 'ekmek']) {
      expect(only).toContain(item);
    }
    // The buy verb stays attached → the classifier sees a buy-list, not orphans.
    expect(only).toMatch(/almam lazım/);
  });

  it('EN: "I need milk, eggs and bread" → one fragment with all 3 items + "need"', () => {
    const frags = texts('I need milk, eggs and bread', 'en');
    expect(frags).toHaveLength(1);
    for (const item of ['milk', 'eggs', 'bread']) {
      expect(frags[0]).toContain(item);
    }
    expect(frags[0]).toMatch(/need/);
  });

  it('EN: "milk, eggs, batteries, detergent to buy" → one fragment, all 4 items incl. non-food', () => {
    const result = pass1Segment('milk, eggs, batteries, detergent to buy', 'en');
    expect(result.fragments).toHaveLength(1);
    const frag = result.fragments[0];
    for (const item of ['milk', 'eggs', 'batteries', 'detergent']) {
      expect(frag.text).toContain(item);
    }
    // A pure enumeration must NOT be handed to the pass-2 LLM, which could
    // shatter it back into orphan noun fragments (the original failure mode).
    expect(frag.needsPass2).toBe(false);
  });

  it('EN no-comma list: "I need milk and eggs" → kept whole (verb on one side only)', () => {
    const frags = texts('I need milk and eggs', 'en');
    expect(frags).toHaveLength(1);
    expect(frags[0]).toBe('I need milk and eggs');
  });
});

describe('pass1Segment — genuine multi-intent still splits', () => {
  it('REGRESSION: "bought milk and called mom" → 2 fragments (verb on BOTH sides)', () => {
    const frags = texts('bought milk and called mom', 'en');
    expect(frags).toHaveLength(2);
    expect(frags[0]).toMatch(/bought milk/);
    expect(frags[1]).toMatch(/called mom/);
  });

  it('TR: "süt aldım ve eve gittim" → 2 fragments', () => {
    const frags = texts('süt aldım ve eve gittim');
    expect(frags).toHaveLength(2);
    expect(frags[0]).toMatch(/süt aldım/);
    expect(frags[1]).toMatch(/eve gittim/);
  });

  it('three clauses split into three: "bought milk and called mom and texted dad"', () => {
    const frags = texts('bought milk and called mom and texted dad', 'en');
    expect(frags).toHaveLength(3);
  });
});

describe('pass1Segment — compound product names are NEVER split at their internal "and"', () => {
  it('"mac and cheese" stays one fragment', () => {
    expect(texts('mac and cheese', 'en')).toEqual(['mac and cheese']);
  });

  it('"salt and pepper" stays one fragment', () => {
    expect(texts('salt and pepper', 'en')).toEqual(['salt and pepper']);
  });

  it('compound inside a buy intent: "got mac and cheese and milk" keeps the compound intact', () => {
    // "mac and cheese" is a bare compound (no verb either side of its internal
    // "and") → kept; the outer "and milk" also joins a bare noun → kept. The
    // whole buy-list stays one fragment.
    const frags = texts('got mac and cheese and milk', 'en');
    expect(frags).toHaveLength(1);
    expect(frags[0]).toContain('mac and cheese');
    expect(frags[0]).toContain('milk');
  });
});
