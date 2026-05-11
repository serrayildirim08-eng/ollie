/**
 * Smoke tests for applyRoute() — no React render needed.
 *
 * Imports applyRoute from applyRoute.ts (pure, no top-level side-effects)
 * so the browser store singleton never initialises during tests.
 * Uses a memory store from @ollie/store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { applyRoute } from './applyRoute';

type GroceryItem = { id: string; name: string; ts: number; checked: boolean };
type PantryItem = { id: string; name: string; ts: number; boughtTs: number };
type GenericItem = { id: string; text: string; ts: number };
type CycleItem = { ts: number; action: string; text: string };
type WaterEntry = { ts: number };

function makeStore() {
  return createStore(createMemoryAdapter());
}

describe('applyRoute · grocery', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('appends an item to grocery.items on add', () => {
    applyRoute({ module: 'grocery', action: 'add', data: 'eggs' }, store);
    const items = store.get<GroceryItem[]>('grocery', 'items', []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'eggs', checked: false });
    expect(typeof items[0].id).toBe('string');
    expect(items[0].id.length).toBeGreaterThan(0);
  });

  it('accumulates multiple grocery items', () => {
    applyRoute({ module: 'grocery', action: 'add', data: 'milk' }, store);
    applyRoute({ module: 'grocery', action: 'add', data: 'bread' }, store);
    const items = store.get<GroceryItem[]>('grocery', 'items', []);
    expect(items).toHaveLength(2);
    expect(items.map(i => i.name)).toEqual(['milk', 'bread']);
  });

  it('"buy eggs" routes to grocery.items', () => {
    applyRoute({ module: 'grocery', action: 'add', data: 'buy eggs' }, store);
    const items = store.get<GroceryItem[]>('grocery', 'items', []);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('buy eggs');
  });

  it('"bought" action routes to grocery.pantry', () => {
    applyRoute({ module: 'grocery', action: 'log', data: 'butter' }, store);
    const pantry = store.get<PantryItem[]>('grocery', 'pantry', []);
    const items = store.get<GroceryItem[]>('grocery', 'items', []);
    expect(pantry).toHaveLength(1);
    expect(pantry[0].name).toBe('butter');
    expect(items).toHaveLength(0);
  });
});

describe('applyRoute · cycle', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('appends a cycle started event', () => {
    applyRoute({ module: 'cycle', action: 'started', data: 'period started' }, store);
    const items = store.get<CycleItem[]>('cycle', 'items', []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: 'started', text: 'period started' });
  });

  it('appends a cycle symptom event', () => {
    applyRoute({ module: 'cycle', action: 'symptom', data: 'cramps' }, store);
    const items = store.get<CycleItem[]>('cycle', 'items', []);
    expect(items[0]).toMatchObject({ action: 'symptom', text: 'cramps' });
  });

  it('"period started" → cycle.items with action started', () => {
    applyRoute({ module: 'cycle', action: 'started', data: 'period started' }, store);
    const items = store.get<CycleItem[]>('cycle', 'items', []);
    expect(items[0].action).toBe('started');
    expect(store.get<GenericItem[]>('cycle', 'items', [])).toHaveLength(1);
  });
});

describe('applyRoute · astrology → dump', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('routes astrology log action to dump.items', () => {
    applyRoute({ module: 'astrology', action: 'log', data: 'mercury retrograde' }, store);
    const dumpItems = store.get<GenericItem[]>('dump', 'items', []);
    const astroItems = store.get<GenericItem[]>('astrology', 'items', []);
    expect(dumpItems).toHaveLength(1);
    expect(dumpItems[0].text).toBe('mercury retrograde');
    expect(astroItems).toHaveLength(0);
  });
});

describe('applyRoute · finance sub-slices', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('"canva $20 monthly" → finance.subscriptions', () => {
    applyRoute({ module: 'finance', action: 'log', data: 'canva $20 monthly' }, store);
    const subs = store.get<GenericItem[]>('finance', 'subscriptions', []);
    expect(subs).toHaveLength(1);
    expect(subs[0].text).toBe('canva $20 monthly');
    expect(store.get<GenericItem[]>('finance', 'items', [])).toHaveLength(0);
  });

  it('"paid $80 late fee" → finance.adhd_tax', () => {
    // "late fee" is in ADHD_TAX_MARKERS.late_fee — parseFinanceDump sets is_adhd_tax: true
    applyRoute({ module: 'finance', action: 'log', data: 'paid $80 late fee on my card' }, store);
    const tax = store.get<GenericItem[]>('finance', 'adhd_tax', []);
    expect(tax).toHaveLength(1);
    expect(tax[0].text).toBe('paid $80 late fee on my card');
  });

  it('"spent $40 impulsively on a gadget" → finance.adhd_tax', () => {
    applyRoute(
      { module: 'finance', action: 'log', data: 'spent $40 impulsively on a gadget' },
      store,
    );
    const tax = store.get<GenericItem[]>('finance', 'adhd_tax', []);
    expect(tax).toHaveLength(1);
    expect(tax[0].text).toBe('spent $40 impulsively on a gadget');
  });

  it('"rent $800 every month" → finance.bills', () => {
    applyRoute({ module: 'finance', action: 'log', data: 'rent $800 every month' }, store);
    const bills = store.get<GenericItem[]>('finance', 'bills', []);
    expect(bills).toHaveLength(1);
    expect(bills[0].text).toBe('rent $800 every month');
  });

  it('"save $100 toward laptop" → finance.goals', () => {
    applyRoute({ module: 'finance', action: 'log', data: 'save $100 toward laptop' }, store);
    const goals = store.get<GenericItem[]>('finance', 'goals', []);
    expect(goals).toHaveLength(1);
  });

  it('"got paid $5000" → finance.records', () => {
    applyRoute({ module: 'finance', action: 'log', data: 'got paid $5000' }, store);
    const records = store.get<GenericItem[]>('finance', 'records', []);
    expect(records).toHaveLength(1);
  });

  it('"bought eggs $4" → finance.records', () => {
    applyRoute({ module: 'finance', action: 'log', data: 'bought eggs $4' }, store);
    const records = store.get<GenericItem[]>('finance', 'records', []);
    expect(records).toHaveLength(1);
  });
});

describe('applyRoute · body sub-slices', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('"drank a glass of water" → body.water_log', () => {
    applyRoute({ module: 'body', action: 'log', data: 'drank a glass of water' }, store);
    const log = store.get<WaterEntry[]>('body', 'water_log', []);
    expect(log).toHaveLength(1);
    expect(typeof log[0].ts).toBe('number');
    expect(store.get<GenericItem[]>('body', 'items', [])).toHaveLength(0);
  });

  it('"took my magnesium" → body.supplements', () => {
    applyRoute({ module: 'body', action: 'log', data: 'took my magnesium' }, store);
    const sups = store.get<GenericItem[]>('body', 'supplements', []);
    expect(sups).toHaveLength(1);
    expect(sups[0].text).toBe('took my magnesium');
  });

  it('"migraine today" → body.episodes', () => {
    applyRoute({ module: 'body', action: 'log', data: 'migraine today' }, store);
    const eps = store.get<GenericItem[]>('body', 'episodes', []);
    expect(eps).toHaveLength(1);
    expect(eps[0].text).toBe('migraine today');
  });

  it('unclassified body input → body.items', () => {
    applyRoute({ module: 'body', action: 'log', data: 'went for a walk' }, store);
    const items = store.get<GenericItem[]>('body', 'items', []);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('went for a walk');
  });
});

describe('applyRoute · generic modules', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('writes sleep items', () => {
    applyRoute({ module: 'sleep', action: 'log', data: 'slept 6h' }, store);
    const items = store.get<GenericItem[]>('sleep', 'items', []);
    expect(items[0].text).toBe('slept 6h');
  });

  it('"random thought" → dump.items', () => {
    applyRoute({ module: 'dump', action: 'log', data: 'random thought' }, store);
    const items = store.get<GenericItem[]>('dump', 'items', []);
    expect(items[0].text).toBe('random thought');
  });

  it('writes pets items', () => {
    applyRoute({ module: 'pets', action: 'add', data: 'buy hay for tontin' }, store);
    const items = store.get<GenericItem[]>('pets', 'items', []);
    expect(items[0].text).toBe('buy hay for tontin');
  });
});
