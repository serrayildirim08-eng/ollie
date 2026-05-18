/**
 * @ollie/logic · work · matter-routing — Phase 2 heuristic tests.
 *
 * Covers the four locked routing outcomes: clear / guess / new-matter
 * nudge / loose. No AI — pure deterministic arithmetic.
 */

import { describe, it, expect } from 'vitest';
import { createMatter } from '../src/work/matter';
import type { Matter } from '../src/work/matter';
import {
  routeDump,
  routeDumpBatch,
  mineNewMatterSuggestions,
  normalizeText,
  keyOccursIn,
  fuzzyScore,
  GUESS_THRESHOLD,
  NEW_MATTER_MIN_OCCURRENCES,
} from '../src/work/matter-routing';
import type { RoutableDump } from '../src/work/matter-routing';

const T0 = new Date('2026-05-18T09:00:00Z').getTime();

function dump(id: string, text: string): RoutableDump {
  return { dump_id: id, source_slice: 'dump', text, ts: T0 };
}

const yilmaz: Matter = createMatter({
  id: 'm-yilmaz',
  name: 'Yılmaz E-2',
  aliases: ['yılmaz dosyası', 'the yilmaz thing'],
  type: 'E-2 case',
  created_at: T0,
});
const acme: Matter = createMatter({
  id: 'm-acme',
  name: 'Acme website redesign',
  aliases: ['acme site'],
  type: 'web project',
  created_at: T0 + 1000,
});

describe('normalizeText', () => {
  it('folds Turkish dotless i and lower-cases', () => {
    expect(normalizeText('Yılmaz')).toBe('yilmaz');
    expect(normalizeText('İSTANBUL')).toBe('istanbul');
  });
  it('collapses whitespace', () => {
    expect(normalizeText('  a   b\tc ')).toBe('a b c');
  });
});

describe('keyOccursIn', () => {
  it('matches a whole word', () => {
    expect(keyOccursIn('call about acme today', 'acme')).toBe(true);
  });
  it('does not match a substring inside another word', () => {
    expect(keyOccursIn('we started the job', 'art')).toBe(false);
  });
  it('matches a multi-word run', () => {
    expect(keyOccursIn('ping yilmaz dosyasi before noon', normalizeText('yılmaz dosyası'))).toBe(true);
  });
});

describe('fuzzyScore', () => {
  it('scores full overlap as 1', () => {
    expect(fuzzyScore('acme website redesign meeting', 'acme website redesign')).toBe(1);
  });
  it('scores partial overlap as a fraction', () => {
    expect(fuzzyScore('acme website call', 'acme website redesign')).toBeCloseTo(2 / 3);
  });
  it('scores no overlap as 0', () => {
    expect(fuzzyScore('totally unrelated note', 'acme website redesign')).toBe(0);
  });
});

describe('routeDump — outcome 1: clear match', () => {
  it('files silently on an exact name hit', () => {
    const r = routeDump(dump('d1', 'draft the visa letter for Yılmaz E-2'), [yilmaz, acme]);
    expect(r.outcome).toBe('clear');
    expect(r.matter_id).toBe('m-yilmaz');
    expect(r.score).toBe(1);
  });

  it('files silently on an alias hit (Turkish-folded)', () => {
    const r = routeDump(dump('d1', 'need docs for yilmaz dosyasi asap'), [yilmaz, acme]);
    expect(r.outcome).toBe('clear');
    expect(r.matter_id).toBe('m-yilmaz');
  });

  it('prefers the longest matching key on overlap', () => {
    // both "acme site" and "acme website redesign" could appear; the
    // longer, more specific key wins.
    const r = routeDump(
      dump('d1', 'kickoff for the acme website redesign and acme site'),
      [acme],
    );
    expect(r.outcome).toBe('clear');
    expect(r.matched_key).toBe('acme website redesign');
  });
});

describe('routeDump — outcome 2: guess', () => {
  it('files as a marked guess on a fuzzy partial hit', () => {
    // "acme website" = 2/3 of "acme website redesign" → above threshold.
    const r = routeDump(dump('d1', 'quick acme website note'), [acme]);
    expect(r.outcome).toBe('guess');
    expect(r.matter_id).toBe('m-acme');
    expect(r.score).toBeGreaterThanOrEqual(GUESS_THRESHOLD);
    expect(r.score).toBeLessThan(1);
  });
});

describe('routeDump — outcome 4: loose', () => {
  it('leaves an unmatched dump loose', () => {
    const r = routeDump(dump('d1', 'remember to water the office plants'), [yilmaz, acme]);
    expect(r.outcome).toBe('loose');
    expect(r.matter_id).toBeNull();
    expect(r.score).toBe(0);
  });

  it('a single weak token is below the guess threshold → loose', () => {
    // only "acme" of three key tokens → 1/3, below 0.6.
    const r = routeDump(dump('d1', 'acme'), [acme]);
    expect(r.outcome).toBe('loose');
  });

  it('skips archived matters', () => {
    const archived = createMatter({
      id: 'm-old',
      name: 'Yılmaz E-2',
      created_at: T0,
      status: 'archived',
    });
    const r = routeDump(dump('d1', 'something for Yılmaz E-2'), [archived]);
    expect(r.outcome).toBe('loose');
  });
});

describe('mineNewMatterSuggestions — outcome 3: recurring unknown name', () => {
  it('proposes a name seen N times across distinct dumps', () => {
    const dumps = [
      dump('d1', 'call Beren Holdings about the lease'),
      dump('d2', 'Beren Holdings sent the contract'),
      dump('d3', 'follow up with Beren Holdings tomorrow'),
    ];
    const s = mineNewMatterSuggestions(dumps);
    expect(s).toHaveLength(1);
    expect(s[0].candidate).toBe('Beren Holdings');
    expect(s[0].occurrences).toBe(NEW_MATTER_MIN_OCCURRENCES);
    expect(s[0].dump_ids.sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('does not propose a name seen fewer than N times', () => {
    const dumps = [
      dump('d1', 'Beren Holdings called'),
      dump('d2', 'Beren Holdings emailed'),
    ];
    expect(mineNewMatterSuggestions(dumps)).toHaveLength(0);
  });

  it('counts a name repeated within ONE dump as a single occurrence', () => {
    const dumps = [dump('d1', 'Beren Holdings Beren Holdings Beren Holdings')];
    expect(mineNewMatterSuggestions(dumps)).toHaveLength(0);
  });

  it('does not propose recurring stop-words', () => {
    const dumps = [
      dump('d1', 'The report is late'),
      dump('d2', 'The client is waiting'),
      dump('d3', 'The deadline moved'),
    ];
    // "The" is sentence-initial-capped but a stop-word — no suggestion.
    expect(mineNewMatterSuggestions(dumps)).toHaveLength(0);
  });

  it('sorts suggestions most-frequent-first', () => {
    const dumps = [
      dump('d1', 'Alpha Corp note'),
      dump('d2', 'Alpha Corp note'),
      dump('d3', 'Alpha Corp note'),
      dump('d4', 'Zeta Group note'),
      dump('d5', 'Zeta Group note'),
      dump('d6', 'Zeta Group note'),
      dump('d7', 'Zeta Group note'),
    ];
    const s = mineNewMatterSuggestions(dumps);
    expect(s.map((x) => x.candidate)).toEqual(['Zeta Group', 'Alpha Corp']);
  });
});

describe('routeDumpBatch — the Phase 2 entry point', () => {
  it('routes a mixed batch and mines suggestions only from loose dumps', () => {
    const dumps = [
      dump('d1', 'visa letter for Yılmaz E-2'),          // clear → yilmaz
      dump('d2', 'quick acme website note'),             // guess → acme
      dump('d3', 'call Beren Holdings re lease'),        // loose, recurring
      dump('d4', 'Beren Holdings sent contract'),        // loose, recurring
      dump('d5', 'Beren Holdings follow up'),            // loose, recurring
      dump('d6', 'water the plants'),                    // loose, noise
    ];
    const { routes, suggestions } = routeDumpBatch(dumps, [yilmaz, acme]);

    expect(routes.find((r) => r.dump_id === 'd1')?.outcome).toBe('clear');
    expect(routes.find((r) => r.dump_id === 'd2')?.outcome).toBe('guess');
    expect(routes.find((r) => r.dump_id === 'd6')?.outcome).toBe('loose');

    // Only the loose dumps feed mining — Beren Holdings recurs 3×.
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].candidate).toBe('Beren Holdings');
    expect(suggestions[0].dump_ids.sort()).toEqual(['d3', 'd4', 'd5']);
  });

  it('handles an empty batch', () => {
    const { routes, suggestions } = routeDumpBatch([], [yilmaz]);
    expect(routes).toEqual([]);
    expect(suggestions).toEqual([]);
  });

  it('routes everything loose when there are no matters', () => {
    const { routes } = routeDumpBatch([dump('d1', 'anything')], []);
    expect(routes[0].outcome).toBe('loose');
  });
});
