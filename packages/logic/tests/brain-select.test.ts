/**
 * @ollie/logic · brain · the selection discipline — unit tests
 *
 * Covers Serra's 3 locked decisions on the pure core:
 *   1. surface the top 2–3 across her whole life (never a wall)
 *   3. low capacity raises the bar moderately (small/deferrable drop, urgent survives)
 *   + snooze/dismiss filtering, deferability map, scoring, deterministic order.
 */

import { describe, it, expect } from 'vitest';
import {
  selectNoticings,
  scoreNoticing,
  deferabilityOf,
  thresholdFor,
  MAX_NOTICINGS,
  type NoticingCandidate,
} from '../src/brain';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

/** Convenience builder for a candidate. */
function cand(over: Partial<NoticingCandidate> & { id: string }): NoticingCandidate {
  return { module: 'grocery', copy: over.id, ...over };
}

// ─── deferability map (cold-start) ─────────────────────────────────────────

describe('deferabilityOf', () => {
  it('protects hard deadlines, meds, bills, health (0)', () => {
    expect(deferabilityOf(cand({ id: 'a', category: 'deadline_passed' }))).toBe(0);
    expect(deferabilityOf(cand({ id: 'b', module: 'medication' }))).toBe(0);
    expect(deferabilityOf(cand({ id: 'c', category: 'bill_due' }))).toBe(0);
    expect(deferabilityOf(cand({ id: 'd', module: 'admin', category: 'renewal' }))).toBe(0);
    expect(deferabilityOf(cand({ id: 'e', module: 'body', category: 'symptom_in_phase' }))).toBe(0);
  });

  it('lets chores / groceries / social rest (1)', () => {
    expect(deferabilityOf(cand({ id: 'a', category: 'grocery-replenish-needed' }))).toBe(1);
    expect(deferabilityOf(cand({ id: 'b', module: 'grocery', category: 'stale-shopping-list' }))).toBe(1);
    expect(deferabilityOf(cand({ id: 'c', module: 'habits' }))).toBe(1);
    expect(deferabilityOf(cand({ id: 'd', module: 'journal' }))).toBe(1);
  });

  it('category match wins over module default', () => {
    // grocery module defaults deferrable, but a "due" category protects.
    expect(deferabilityOf(cand({ id: 'a', module: 'grocery', category: 'something_due' }))).toBe(0);
  });
});

// ─── scoring ───────────────────────────────────────────────────────────────

describe('scoreNoticing', () => {
  it('an overdue protected item scores highest', () => {
    const s = scoreNoticing(cand({ id: 'a', module: 'admin', category: 'deadline', urgencyAt: NOW - DAY }), NOW);
    // urgency 3 (overdue) + deferability floor 1 = 4
    expect(s.parts.urgency).toBe(3);
    expect(s.parts.deferability).toBe(1);
    expect(s.score).toBe(4);
  });

  it('a freely-deferrable noticing with no deadline scores low', () => {
    const s = scoreNoticing(cand({ id: 'a', category: 'grocery-replenish-needed' }), NOW);
    expect(s.score).toBe(0); // urgency 0 + deferability 0
  });

  it('urgency tapers with distance to the deadline', () => {
    const near = scoreNoticing(cand({ id: 'a', category: 'deadline', urgencyAt: NOW + 0.5 * DAY }), NOW);
    const far = scoreNoticing(cand({ id: 'b', category: 'deadline', urgencyAt: NOW + 10 * DAY }), NOW);
    expect(near.parts.urgency).toBeGreaterThan(far.parts.urgency);
  });
});

// ─── DECISION 1 · the 2–3 cap ──────────────────────────────────────────────

describe('selectNoticings · the 2–3 cap', () => {
  it('never surfaces more than 3 even when many clear the bar', () => {
    const many: NoticingCandidate[] = Array.from({ length: 8 }, (_, i) =>
      cand({ id: `d${i}`, module: 'admin', category: 'deadline', urgencyAt: NOW - i * DAY }),
    );
    const out = selectNoticings(many, NOW);
    expect(out.length).toBe(MAX_NOTICINGS);
    expect(out.length).toBe(3);
  });

  it('a trivial capture (e.g. "bought tomatoes") produces 0', () => {
    // A bare grocery add with no run-out date is a deferrable, no-urgency
    // noticing — below the bar, surfaces nothing.
    const out = selectNoticings(
      [cand({ id: 'g1', module: 'grocery', category: 'grocery-add', copy: 'tomatoes' })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('a replenish noticing (run-out passed) clears the bar and surfaces', () => {
    // The real fix: a "milk ran low" noticing carries the past run-out time as
    // urgencyAt, so it scores ~1.5 (overdue × deferrable weight) and clears the
    // normal bar — a bare add with no run-out (above) stays at 0 and doesn't.
    const out = selectNoticings(
      [cand({ id: 'milk', module: 'grocery', category: 'grocery-replenish-needed', urgencyAt: NOW - DAY })],
      NOW,
    );
    expect(out.map((n) => n.id)).toEqual(['milk']);
  });
});

// ─── DECISION 3 · low-capacity moderate suppression ────────────────────────

describe('selectNoticings · low-capacity suppression', () => {
  const deadline = cand({ id: 'deadline', module: 'admin', category: 'deadline', urgencyAt: NOW - DAY });
  // A grocery replenish "milk ran low" the day after predicted run-out:
  // deferrable, slight urgency — clears the normal bar but not the raised one.
  const milk = cand({
    id: 'milk',
    module: 'grocery',
    category: 'grocery-replenish-needed',
    urgencyAt: NOW - 1 * DAY,
  });

  it('medium capacity surfaces both the deadline and the small grocery note', () => {
    const out = selectNoticings([deadline, milk], NOW, { capacity: 'medium' });
    expect(out.map((n) => n.id).sort()).toEqual(['deadline', 'milk']);
  });

  it('low capacity drops the small grocery note but keeps the urgent deadline', () => {
    const out = selectNoticings([deadline, milk], NOW, { capacity: 'low' });
    expect(out.map((n) => n.id)).toEqual(['deadline']);
  });

  it('low bar is moderate, not silence — a med dose still surfaces', () => {
    const med = cand({ id: 'med', module: 'medication', category: 'dose', urgencyAt: NOW });
    const out = selectNoticings([med, milk], NOW, { capacity: 'low' });
    expect(out.map((n) => n.id)).toEqual(['med']);
  });

  it('thresholdFor raises only on low', () => {
    expect(thresholdFor('low')).toBeGreaterThan(thresholdFor('medium'));
    expect(thresholdFor('medium')).toBe(thresholdFor('high'));
  });
});

// ─── snooze / dismiss filtering ────────────────────────────────────────────

describe('selectNoticings · snooze + dismiss filtering', () => {
  const a = cand({ id: 'a', module: 'admin', category: 'deadline', urgencyAt: NOW - DAY });
  const b = cand({ id: 'b', module: 'admin', category: 'deadline', urgencyAt: NOW - 2 * DAY });
  const c = cand({ id: 'c', module: 'admin', category: 'deadline', urgencyAt: NOW - 3 * DAY });

  it('excludes snoozed/dismissed ids, letting the next-ranked fill the slot', () => {
    const all = selectNoticings([a, b, c], NOW);
    expect(all).toHaveLength(3);
    // Postpone `a` and `b` → only `c` remains (the next-ranked surfaces).
    const filtered = selectNoticings([a, b, c], NOW, { excludeIds: ['a', 'b'] });
    expect(filtered.map((n) => n.id)).toEqual(['c']);
  });

  it('de-dupes candidates sharing an id (own + shared merge)', () => {
    const out = selectNoticings([a, { ...a }], NOW);
    expect(out).toHaveLength(1);
  });
});

// ─── deterministic ordering ────────────────────────────────────────────────

describe('selectNoticings · deterministic order', () => {
  it('ranks by score, then urgency, then oldest, then id', () => {
    const out = selectNoticings(
      [
        cand({ id: 'soonest', module: 'admin', category: 'deadline', urgencyAt: NOW - 3 * DAY }),
        cand({ id: 'soon', module: 'admin', category: 'deadline', urgencyAt: NOW + 2 * DAY }),
      ],
      NOW,
    );
    expect(out[0]!.id).toBe('soonest');
  });
});
