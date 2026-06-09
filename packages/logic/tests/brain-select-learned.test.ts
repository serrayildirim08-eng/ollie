/**
 * @ollie/logic · brain · select ✕ learned-map integration — unit tests
 *
 * Proves the Sprint-2 selection actually CONSULTS the Sprint-4 learned map: the
 * same candidate is surfaced or suppressed differently once a 'protect' /
 * 'ok-to-defer' verdict (or a user pin) resolves over the cold-start default —
 * WITHOUT any change to how callers that omit the resolver behave.
 */

import { describe, it, expect } from 'vitest';
import {
  selectNoticings,
  scoreNoticing,
  resolveDeferability,
  verdictToDeferability,
  learnBucket,
  type NoticingCandidate,
  type LearnedMap,
  type DeferabilityResolver,
} from '../src/brain';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function cand(over: Partial<NoticingCandidate> & { id: string }): NoticingCandidate {
  return { module: 'grocery', copy: over.id, ...over };
}

/**
 * Build the resolver the native side will build: given a candidate, key it to
 * a coarse (category/module) bucket + a fine (category:item) bucket, resolve
 * the learned map, and return the numeric deferability (or null = cold-start).
 */
function resolverFor(map: LearnedMap): DeferabilityResolver {
  return (candidate) => {
    const coarse = (candidate.category ?? candidate.module ?? '').toString();
    const item = candidate.facts?.items?.[0];
    const fine = item ? `${coarse}:${item}` : null;
    const resolved = resolveDeferability(map, fine, coarse);
    return verdictToDeferability(resolved.deferability);
  };
}

// ─── the seam is consulted ─────────────────────────────────────────────────

describe('selectNoticings · consults the learned map', () => {
  // A grocery replenish "milk ran low" the day after run-out: cold-start
  // DEFERABLE, slight urgency → it normally rests on a low-capacity day.
  const milk = cand({
    id: 'milk',
    module: 'grocery',
    category: 'grocery-replenish-needed',
    urgencyAt: NOW - 1 * DAY,
    facts: { items: ['milk'], days: 1 },
  });

  it('with NO resolver, behaves exactly as cold-start (milk rests on low capacity)', () => {
    const out = selectNoticings([milk], NOW, { capacity: 'low' });
    expect(out.map((n) => n.id)).toEqual([]);
  });

  it("a learned 'protect' verdict makes the SAME candidate surface on a low day", () => {
    // She kept deferring milk and it kept spoiling → learned protect for milk.
    const map: LearnedMap = {
      verdicts: { 'grocery-replenish-needed:milk': learnBucket({ deferCount: 8, harmCount: 6 }) },
    };
    const out = selectNoticings([milk], NOW, {
      capacity: 'low',
      resolveDeferability: resolverFor(map),
    });
    expect(out.map((n) => n.id)).toEqual(['milk']);
  });

  it("a learned 'ok-to-defer' verdict suppresses a candidate the cold-start would surface", () => {
    // A renewal-ish note the cold-start protects, but she's safely deferred this
    // exact kind many times with zero harm → learned ok-to-defer.
    const softRenewal = cand({
      id: 'soft',
      module: 'admin',
      category: 'renewal',
      urgencyAt: NOW - 1 * DAY, // mildly overdue
    });
    // cold-start: renewal is PROTECT (0) → with overdue urgency it surfaces.
    const cold = selectNoticings([softRenewal], NOW, { capacity: 'medium' });
    expect(cold.map((n) => n.id)).toEqual(['soft']);

    const map: LearnedMap = {
      verdicts: { renewal: learnBucket({ deferCount: 12, harmCount: 0 }) }, // ok-to-defer
    };
    const learned = selectNoticings([softRenewal], NOW, {
      capacity: 'low', // raised bar + now-deferrable → drops
      resolveDeferability: resolverFor(map),
    });
    expect(learned.map((n) => n.id)).toEqual([]);
  });

  it('a USER PIN overrides both learned + cold-start at score time', () => {
    // milk learned ok-to-defer, cold-start deferable — but she pinned protect.
    const map: LearnedMap = {
      verdicts: { 'grocery-replenish-needed:milk': learnBucket({ deferCount: 10, harmCount: 0 }) },
      pins: { 'grocery-replenish-needed:milk': 'protect' },
    };
    const out = selectNoticings([milk], NOW, {
      capacity: 'low',
      resolveDeferability: resolverFor(map),
    });
    expect(out.map((n) => n.id)).toEqual(['milk']);
  });
});

// ─── scoreNoticing honours the resolver directly ───────────────────────────

describe('scoreNoticing · resolver shifts the deferability part', () => {
  const milk = cand({ id: 'milk', category: 'grocery-replenish-needed', urgencyAt: NOW });

  it('a protect verdict raises the deferability floor vs cold-start', () => {
    const cold = scoreNoticing(milk, NOW);
    const protectResolver: DeferabilityResolver = () => 0;
    const learned = scoreNoticing(milk, NOW, protectResolver);
    expect(learned.parts.deferability).toBeGreaterThan(cold.parts.deferability);
    expect(learned.score).toBeGreaterThan(cold.score);
  });

  it('returning null keeps the cold-start default', () => {
    const cold = scoreNoticing(milk, NOW);
    const passthrough: DeferabilityResolver = () => null;
    const same = scoreNoticing(milk, NOW, passthrough);
    expect(same.score).toBe(cold.score);
  });
});
