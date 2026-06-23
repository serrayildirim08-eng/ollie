/**
 * @ollie/orchestrator · chores orchestrator tests
 *
 * Coverage:
 *   - writes patternsLastComputedAt + an empty patterns slice on init
 *   - a recurring chore past its cadence becomes a "chore due" offer card with
 *     the mark_chore_done action attached (the cadence-due detection)
 *   - a recurring chore done within its cadence yields NO offer
 *   - one-off chores never produce an offer
 *   - the offer copy + facts are shaped for the brain gatherer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers } from '@ollie/events';
import {
  createChoresOrchestrator,
  isRecordDue,
  buildChoreDueCopy,
  type ChoreRecord,
  type ChorePattern,
} from '../src/chores';

const NOW = new Date('2026-06-23T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

function record(over: Partial<ChoreRecord>): ChoreRecord {
  return {
    id: over.id ?? 'c1',
    name: over.name ?? 'vacuum',
    kind: over.kind ?? 'recurring',
    cadenceDays: over.cadenceDays ?? 7,
    lastDoneAt: over.lastDoneAt ?? null,
    done: over.done ?? false,
    createdAt: over.createdAt ?? 0,
  };
}

describe('chores orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createChoresOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createChoresOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('writes patternsLastComputedAt + empty patterns on init (no chores)', () => {
    store.set('chores', 'registry', [] as ChoreRecord[]);
    orch.init();
    expect(store.get<number>('chores', 'patternsLastComputedAt', 0)).toBe(NOW);
    expect(store.get<ChorePattern[]>('chores', 'patterns', [])).toEqual([]);
  });

  it('emits a chore-due offer for a recurring chore past its cadence', () => {
    store.set('chores', 'registry', [
      record({ id: 'c1', name: 'vacuum', cadenceDays: 7, lastDoneAt: NOW - 8 * DAY_MS }),
    ]);
    orch.init();
    const patterns = store.get<ChorePattern[]>('chores', 'patterns', []) ?? [];
    expect(patterns).toHaveLength(1);
    const p = patterns[0]!;
    expect(p.category).toBe('chore_due');
    expect(p.actionKind).toBe('mark_chore_done');
    expect(p.choreId).toBe('c1');
    expect(p.choreName).toBe('vacuum');
    expect(p.pattern).toBe('chore-due:c1');
    expect(p.copy).toContain('vacuum');
    expect(p.copy).toContain('7 days');
  });

  it('a never-done recurring chore is immediately due', () => {
    store.set('chores', 'registry', [
      record({ id: 'c2', name: 'water plants', cadenceDays: 3, lastDoneAt: null }),
    ]);
    orch.init();
    const patterns = store.get<ChorePattern[]>('chores', 'patterns', []) ?? [];
    expect(patterns.map((p) => p.choreId)).toContain('c2');
  });

  it('no offer when the recurring chore was done within its cadence', () => {
    store.set('chores', 'registry', [
      record({ id: 'c3', name: 'mop', cadenceDays: 7, lastDoneAt: NOW - 2 * DAY_MS }),
    ]);
    orch.init();
    const patterns = store.get<ChorePattern[]>('chores', 'patterns', []) ?? [];
    expect(patterns).toHaveLength(0);
  });

  it('one-off chores never produce an offer', () => {
    store.set('chores', 'registry', [
      record({ id: 'c4', name: 'clean the garage', kind: 'one_off', cadenceDays: null }),
    ]);
    orch.init();
    expect(store.get<ChorePattern[]>('chores', 'patterns', [])).toEqual([]);
  });
});

describe('chores pure helpers', () => {
  it('isRecordDue honours cadence + last-done', () => {
    expect(isRecordDue(record({ lastDoneAt: NOW - 8 * DAY_MS }), NOW)).toBe(true);
    expect(isRecordDue(record({ lastDoneAt: NOW - 2 * DAY_MS }), NOW)).toBe(false);
    expect(isRecordDue(record({ lastDoneAt: null }), NOW)).toBe(true);
    expect(isRecordDue(record({ kind: 'one_off', cadenceDays: null }), NOW)).toBe(false);
  });

  it('buildChoreDueCopy is calm + names the cadence', () => {
    const copy = buildChoreDueCopy('vacuum', 7);
    expect(copy).toContain('vacuum');
    expect(copy).toContain('7 days');
    expect(copy).toMatch(/add to today\?$/);
  });
});
