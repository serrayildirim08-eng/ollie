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
type GenericItem = { id: string; text: string; ts: number };
type CycleItem = { ts: number; action: string; text: string };

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

describe('applyRoute · generic modules', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('writes sleep items', () => {
    applyRoute({ module: 'sleep', action: 'log', data: 'slept 6h' }, store);
    const items = store.get<GenericItem[]>('sleep', 'items', []);
    expect(items[0].text).toBe('slept 6h');
  });

  it('writes dump items', () => {
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
