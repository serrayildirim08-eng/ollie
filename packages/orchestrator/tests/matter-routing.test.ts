/**
 * @ollie/orchestrator · matter-routing — Phase 2 store-bound tests.
 *
 * Confirms the routing pass reads dumps from work.tasks / work.meetings
 * / dump.items, files them into work.matters, drains the loose area, and
 * produces new-matter suggestions — idempotently. No AI.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createMatter } from '@ollie/logic/work';
import type { Matter } from '@ollie/logic/work';
import {
  runMatterRoutingPass,
  collectRoutableDumps,
  createMatterRoutingOrchestrator,
} from '../src/matter-routing';
import type { LooseDumpRef } from '../src/matter-routing';

const T0 = new Date('2026-05-18T12:00:00Z').getTime();

function makeStore() {
  return createStore(createMemoryAdapter());
}

function seedMatter(store: ReturnType<typeof makeStore>, m: Matter): void {
  const cur = store.get<Matter[]>('work', 'matters', []) ?? [];
  store.set('work', 'matters', [...cur, m]);
}

const yilmaz = createMatter({
  id: 'm-yilmaz',
  name: 'Yılmaz E-2',
  aliases: ['yılmaz dosyası'],
  type: 'E-2 case',
  created_at: T0,
});
const acme = createMatter({
  id: 'm-acme',
  name: 'Acme website redesign',
  aliases: ['acme site'],
  type: 'web project',
  created_at: T0,
});

describe('collectRoutableDumps', () => {
  it('pulls from work.tasks, work.meetings and dump.items', () => {
    const store = makeStore();
    store.set('work', 'tasks', [{ id: 't1', title: 'task one', created_at: T0 }]);
    store.set('work', 'meetings', [{ id: 'm1', title: 'meeting two', start_at: T0 }]);
    store.set('dump', 'items', [{ id: 'd1', text: 'dump three', ts: T0 }]);

    const dumps = collectRoutableDumps(store);
    expect(dumps).toHaveLength(3);
    expect(dumps.map((d) => d.source_slice).sort()).toEqual(['dump', 'work', 'work']);
    expect(dumps.find((d) => d.dump_id === 't1')?.text).toBe('task one');
  });

  it('skips rows missing id or text', () => {
    const store = makeStore();
    store.set('work', 'tasks', [
      { id: 't1', title: 'ok', created_at: T0 },
      { title: 'no id', created_at: T0 },
      { id: 't3', created_at: T0 },
    ]);
    expect(collectRoutableDumps(store)).toHaveLength(1);
  });
});

describe('runMatterRoutingPass', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('files a clear-match dump into its matter', () => {
    seedMatter(store, yilmaz);
    store.set('dump', 'items', [{ id: 'd1', text: 'visa letter for Yılmaz E-2', ts: T0 }]);

    const res = runMatterRoutingPass(store, T0);
    expect(res.clear).toBe(1);
    expect(res.filed).toBe(1);

    const matters = store.get<Matter[]>('work', 'matters', []);
    expect(matters[0].dumps).toHaveLength(1);
    expect(matters[0].dumps[0]).toMatchObject({ dump_id: 'd1', origin: 'clear', score: 1 });
  });

  it('files a fuzzy dump as a marked guess', () => {
    seedMatter(store, acme);
    store.set('dump', 'items', [{ id: 'd1', text: 'quick acme website note', ts: T0 }]);

    const res = runMatterRoutingPass(store, T0);
    expect(res.guess).toBe(1);

    const matters = store.get<Matter[]>('work', 'matters', []);
    expect(matters[0].dumps[0].origin).toBe('guess');
    expect(matters[0].dumps[0].score).toBeLessThan(1);
  });

  it('parks an unmatched dump in the loose area', () => {
    seedMatter(store, yilmaz);
    store.set('dump', 'items', [{ id: 'd1', text: 'water the office plants', ts: T0 }]);

    const res = runMatterRoutingPass(store, T0);
    expect(res.loose).toBe(1);
    expect(res.filed).toBe(0);

    const loose = store.get<LooseDumpRef[]>('work', 'matter_loose_dumps', []);
    expect(loose).toHaveLength(1);
    expect(loose[0]).toMatchObject({ dump_id: 'd1', parked_at: T0 });
  });

  it('produces a new-matter suggestion for a recurring unknown name', () => {
    store.set('dump', 'items', [
      { id: 'd1', text: 'call Beren Holdings about lease', ts: T0 },
      { id: 'd2', text: 'Beren Holdings sent the contract', ts: T0 },
      { id: 'd3', text: 'follow up Beren Holdings tomorrow', ts: T0 },
    ]);

    const res = runMatterRoutingPass(store, T0);
    expect(res.suggestions).toBe(1);

    const suggestions = store.get<Array<{ candidate: string; occurrences: number }>>(
      'work', 'matter_suggestions', [],
    );
    expect(suggestions[0].candidate).toBe('Beren Holdings');
    expect(suggestions[0].occurrences).toBe(3);
  });

  it('is idempotent — a second pass does not double-file', () => {
    seedMatter(store, yilmaz);
    store.set('dump', 'items', [{ id: 'd1', text: 'docs for Yılmaz E-2', ts: T0 }]);

    runMatterRoutingPass(store, T0);
    const res2 = runMatterRoutingPass(store, T0 + 1000);
    expect(res2.filed).toBe(0);

    const matters = store.get<Matter[]>('work', 'matters', []);
    expect(matters[0].dumps).toHaveLength(1);
  });

  it('loose area self-drains once a matter is added that matches it', () => {
    // Dump arrives before any matter exists → loose.
    store.set('dump', 'items', [{ id: 'd1', text: 'kickoff for Acme website redesign', ts: T0 }]);
    runMatterRoutingPass(store, T0);
    expect(store.get<LooseDumpRef[]>('work', 'matter_loose_dumps', [])).toHaveLength(1);

    // User confirms the Acme matter → next pass routes the loose dump.
    seedMatter(store, acme);
    const res = runMatterRoutingPass(store, T0 + 5000);
    expect(res.filed).toBe(1);
    expect(store.get<LooseDumpRef[]>('work', 'matter_loose_dumps', [])).toHaveLength(0);

    const matters = store.get<Matter[]>('work', 'matters', []);
    expect(matters[0].dumps).toHaveLength(1);
  });

  it('does not mutate the existing WorkModule slices (tasks / meetings)', () => {
    seedMatter(store, yilmaz);
    const tasks = [{ id: 't1', title: 'work for Yılmaz E-2', created_at: T0 }];
    store.set('work', 'tasks', tasks);

    runMatterRoutingPass(store, T0);
    // tasks slice untouched — matter system runs side-by-side.
    expect(store.get('work', 'tasks', [])).toEqual(tasks);
  });

  it('no matters and no dumps → clean no-op', () => {
    const res = runMatterRoutingPass(store, T0);
    expect(res).toEqual({ filed: 0, clear: 0, guess: 0, loose: 0, suggestions: 0 });
    expect(store.get('work', 'matterRoutingLastRunAt', 0)).toBe(T0);
  });
});

describe('createMatterRoutingOrchestrator', () => {
  it('routeNow runs a pass and is wired through init/teardown', () => {
    const store = makeStore();
    seedMatter(store, yilmaz);
    store.set('dump', 'items', [{ id: 'd1', text: 'brief for Yılmaz E-2', ts: T0 }]);

    const orch = createMatterRoutingOrchestrator(store, { now: () => T0 });
    orch.init();
    const res = orch.routeNow();
    expect(res.filed).toBe(1);
    orch.teardown();
    // teardown is idempotent.
    expect(() => orch.teardown()).not.toThrow();
  });

  it('init is idempotent', () => {
    const store = makeStore();
    const orch = createMatterRoutingOrchestrator(store, { now: () => T0 });
    orch.init();
    expect(() => orch.init()).not.toThrow();
    orch.teardown();
  });
});
