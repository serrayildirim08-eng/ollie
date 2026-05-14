/**
 * @ollie/orchestrator · braindump-dispatch tests
 *
 * End-to-end keyword → store mutation coverage. 15+ keywords across
 * work, goals, grocery, body, sleep, habits, finance, cycle, pets,
 * admin. Confirms applyRoute() lands brain-dump text in the right
 * slice — not in a generic <module>.items bucket.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { routeBrainDump, dispatchAction } from '../src/braindump-dispatch';

const FIXED_NOW = new Date('2026-05-14T12:00:00Z').getTime();

function makeStore() {
  return createStore(createMemoryAdapter());
}

type WorkTask = { id: string; title: string; created_at: number };
type Meeting = { id: string; title: string; start_at: number; end_at: number };
type Goal = { id: string; title: string; created_at: number; status: string };
type GroceryItem = { id: string; name: string; ts: number; checked: boolean };
type GenericItem = { id: string; text: string; ts: number };

describe('routeBrainDump — work module', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('"meeting with client friday" → work.meetings', () => {
    const r = routeBrainDump('meeting with client friday', store, FIXED_NOW);
    expect(r.modulesHit).toContain('work');
    const meetings = store.get<Meeting[]>('work', 'meetings', []);
    expect(meetings).toHaveLength(1);
    expect(meetings[0].title).toContain('meeting');
  });

  it('"deadline tuesday on the deck" → work.tasks', () => {
    routeBrainDump('deadline tuesday on the deck', store, FIXED_NOW);
    const tasks = store.get<WorkTask[]>('work', 'tasks', []);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].created_at).toBe(FIXED_NOW);
  });

  it('"need to focus on the report" → work.tasks', () => {
    routeBrainDump('need to focus on the report', store, FIXED_NOW);
    const tasks = store.get<WorkTask[]>('work', 'tasks', []);
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('Turkish "toplantı yarın" → work.meetings', () => {
    routeBrainDump('toplantı yarın', store, FIXED_NOW);
    const meetings = store.get<Meeting[]>('work', 'meetings', []);
    expect(meetings).toHaveLength(1);
  });

  it('"presentation next week" → work.tasks', () => {
    routeBrainDump('presentation next week', store, FIXED_NOW);
    const tasks = store.get<WorkTask[]>('work', 'tasks', []);
    expect(tasks).toHaveLength(1);
  });
});

describe('routeBrainDump — goals module', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('"goal: ship beta this quarter" → goals.items active', () => {
    routeBrainDump('goal: ship beta this quarter', store, FIXED_NOW);
    const goals = store.get<Goal[]>('goals', 'items', []);
    expect(goals).toHaveLength(1);
    expect(goals[0].status).toBe('active');
  });

  it('"dream of moving to barcelona" → goals.items', () => {
    routeBrainDump('dream of moving to barcelona', store, FIXED_NOW);
    const goals = store.get<Goal[]>('goals', 'items', []);
    expect(goals).toHaveLength(1);
  });

  it('"milestone: 5kg muscle" → goals.items', () => {
    routeBrainDump('milestone: 5kg muscle', store, FIXED_NOW);
    const goals = store.get<Goal[]>('goals', 'items', []);
    expect(goals).toHaveLength(1);
  });
});

describe('routeBrainDump — grocery + body + cycle + finance', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('"buy eggs and milk" → grocery.items', () => {
    routeBrainDump('buy eggs and milk', store, FIXED_NOW);
    const items = store.get<GroceryItem[]>('grocery', 'items', []);
    expect(items.length).toBeGreaterThan(0);
  });

  it('"water intake 3 glasses today" → body.water_log', () => {
    // The fallback-route keyword for body is "water intake" (not bare
    // "water" — that's too ambiguous: "water plants", "boiling water").
    routeBrainDump('water intake 3 glasses today', store, FIXED_NOW);
    const log = store.get<Array<{ ts: number }>>('body', 'water_log', []);
    expect(log.length).toBeGreaterThan(0);
  });

  it('"exercise: walked 30 min" → habits.items', () => {
    routeBrainDump('exercise: walked 30 min', store, FIXED_NOW);
    const habits = store.get<GenericItem[]>('habits', 'items', []);
    expect(habits.length).toBeGreaterThan(0);
  });

  it('"pay the rent" → finance.bills', () => {
    routeBrainDump('pay the rent', store, FIXED_NOW);
    const bills = store.get<GenericItem[]>('finance', 'bills', []);
    // applyRoute slices into finance sub-keys; rent matches BILL_RE
    // in apps/web — but in @ollie/orchestrator/dispatch we route the
    // raw text into finance.items (no finance parsing dep). Accept
    // either landing zone.
    const itemsFallback = store.get<GenericItem[]>('finance', 'items', []);
    expect(bills.length + itemsFallback.length).toBeGreaterThan(0);
  });

  it('"started my period yesterday" → cycle.items started', () => {
    routeBrainDump('started my period yesterday', store, FIXED_NOW);
    const items = store.get<Array<{ action: string; text: string }>>('cycle', 'items', []);
    expect(items.some((i) => i.action === 'started')).toBe(true);
  });
});

describe('routeBrainDump — pets / admin / sleep', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('"tontin needs hay" → pets.items', () => {
    routeBrainDump('tontin needs hay', store, FIXED_NOW);
    const pets = store.get<GenericItem[]>('pets', 'items', []);
    expect(pets.length).toBeGreaterThan(0);
  });

  it('"renew passport" → admin.items', () => {
    routeBrainDump('renew passport', store, FIXED_NOW);
    const admin = store.get<GenericItem[]>('admin', 'items', []);
    expect(admin.length).toBeGreaterThan(0);
  });

  it('"so tired tonight, going to bed" → sleep.items', () => {
    routeBrainDump('so tired tonight, going to bed', store, FIXED_NOW);
    const sleep = store.get<GenericItem[]>('sleep', 'items', []);
    expect(sleep.length).toBeGreaterThan(0);
  });
});

describe('routeBrainDump — questions / unknown / answer-route', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('question text returns isAnswer + no writes', () => {
    const r = routeBrainDump('when is my next bill due?', store, FIXED_NOW);
    expect(r.isAnswer).toBe(true);
    expect(r.actions).toHaveLength(0);
  });

  it('gibberish lands in dump.items', () => {
    routeBrainDump('asdf qwerty zxcv', store, FIXED_NOW);
    const dump = store.get<GenericItem[]>('dump', 'items', []);
    expect(dump.length).toBeGreaterThan(0);
  });
});

describe('dispatchAction direct', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('synthetic work meeting action lands in work.meetings', () => {
    dispatchAction(
      { module: 'work', action: 'add', data: 'meeting with maya 3pm' },
      store,
      FIXED_NOW,
    );
    const meetings = store.get<Meeting[]>('work', 'meetings', []);
    expect(meetings).toHaveLength(1);
    expect(meetings[0].start_at).toBe(FIXED_NOW);
    expect(meetings[0].end_at).toBe(FIXED_NOW + 30 * 60_000);
  });

  it('synthetic goals action lands in goals.items active', () => {
    dispatchAction(
      { module: 'goals', action: 'add', data: 'run a marathon' },
      store,
      FIXED_NOW,
    );
    const goals = store.get<Goal[]>('goals', 'items', []);
    expect(goals).toHaveLength(1);
    expect(goals[0].status).toBe('active');
    expect(goals[0].created_at).toBe(FIXED_NOW);
  });
});
