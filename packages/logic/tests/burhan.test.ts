/**
 * @ollie/logic · burhan — pure-function tests
 *
 * Constitutional rule check: append-only, deterministic placement,
 * stable across reloads.
 */

import { describe, it, expect } from 'vitest';
import {
  addEvent,
  positionFor,
  lastN,
  positionedAll,
  elementTypeFor,
  hashId,
  type BurhanEvent,
  type BurhanState,
} from '../src/burhan/index';

function ev(id: string, type: BurhanEvent['type'], ts: number): BurhanEvent {
  return { id, type, ts, source_module: 'test', source_event_id: id };
}

describe('logic/burhan', () => {
  describe('hashId', () => {
    it('is deterministic per input', () => {
      expect(hashId('cycle:period:1')).toBe(hashId('cycle:period:1'));
    });
    it('differs across inputs', () => {
      expect(hashId('a')).not.toBe(hashId('b'));
    });
  });

  describe('positionFor', () => {
    it('is deterministic per event id', () => {
      const e = ev('e1', 'flower', 1000);
      const a = positionFor(e);
      const b = positionFor(e);
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      expect(a.rot).toBe(b.rot);
      expect(a.scale).toBe(b.scale);
    });

    it('places elements inside the [0,1] band for their type', () => {
      for (const type of ['leaf', 'gold_leaf', 'fruit', 'flower', 'canopy_fruit'] as const) {
        const p = positionFor(ev(`${type}-1`, type, 0));
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
        expect(p.rot).toBeGreaterThanOrEqual(-25);
        expect(p.rot).toBeLessThanOrEqual(25);
        expect(p.scale).toBeGreaterThanOrEqual(0.85);
        expect(p.scale).toBeLessThanOrEqual(1.15);
      }
    });

    it('flowers stay in their canopy band (y ≤ 0.65)', () => {
      const p = positionFor(ev('f1', 'flower', 0));
      expect(p.y).toBeLessThanOrEqual(0.65);
    });
  });

  describe('addEvent', () => {
    it('appends to empty state', () => {
      const next = addEvent({ events: [] }, ev('e1', 'flower', 1));
      expect(next.events).toHaveLength(1);
      expect(next.events[0].id).toBe('e1');
    });

    it('does not mutate the input state', () => {
      const state: BurhanState = { events: [] };
      addEvent(state, ev('e1', 'flower', 1));
      expect(state.events).toHaveLength(0);
    });

    it('dedupes by id (idempotent)', () => {
      let s: BurhanState = { events: [] };
      s = addEvent(s, ev('e1', 'flower', 1));
      s = addEvent(s, ev('e1', 'flower', 1));
      s = addEvent(s, ev('e1', 'flower', 1));
      expect(s.events).toHaveLength(1);
    });

    it('preserves insertion order', () => {
      let s: BurhanState = { events: [] };
      s = addEvent(s, ev('a', 'leaf', 1));
      s = addEvent(s, ev('b', 'fruit', 2));
      s = addEvent(s, ev('c', 'flower', 3));
      expect(s.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    });

    it('refuses entries without an id', () => {
      const next = addEvent({ events: [] }, { id: '', type: 'flower', ts: 1, source_module: '', source_event_id: '' });
      expect(next.events).toHaveLength(0);
    });
  });

  describe('lastN', () => {
    it('returns the most recent N events by ts (descending)', () => {
      const state: BurhanState = {
        events: [
          ev('a', 'leaf', 10),
          ev('b', 'leaf', 30),
          ev('c', 'leaf', 20),
        ],
      };
      const last2 = lastN(state, 2);
      expect(last2.map((e) => e.id)).toEqual(['b', 'c']);
    });

    it('clamps n=0 → empty', () => {
      const state: BurhanState = { events: [ev('a', 'leaf', 1)] };
      expect(lastN(state, 0)).toEqual([]);
    });
  });

  describe('positionedAll', () => {
    it('positions every event', () => {
      const state: BurhanState = {
        events: [ev('a', 'leaf', 1), ev('b', 'flower', 2)],
      };
      const positioned = positionedAll(state);
      expect(positioned).toHaveLength(2);
      expect(positioned[0].x).toBeGreaterThanOrEqual(0);
    });
  });

  describe('elementTypeFor', () => {
    it('maps source events to element types', () => {
      expect(elementTypeFor('cycle:period_logged')).toBe('flower');
      expect(elementTypeFor('finance:subscription_cancelled')).toBe('fruit');
      expect(elementTypeFor('admin:appointment_completed')).toBe('leaf');
      expect(elementTypeFor('finance:bill_paid_on_time')).toBe('gold_leaf');
      expect(elementTypeFor('body:doctor_visit_completed')).toBe('canopy_fruit');
    });

    it('returns null for unmapped events', () => {
      expect(elementTypeFor('void:braindump:submitted')).toBeNull();
    });
  });

  describe('constitutional: no decay', () => {
    it('module exports no decay/remove/reset function', async () => {
      const mod = await import('../src/burhan/index');
      const banned = ['decay', 'removeEvent', 'reset', 'expire', 'shrink', 'fade'];
      for (const name of banned) {
        expect((mod as Record<string, unknown>)[name]).toBeUndefined();
      }
    });
  });
});
