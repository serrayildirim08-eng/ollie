/**
 * @ollie/orchestrator · braindump-dispatch tests
 *
 * End-to-end keyword → store mutation coverage. 15+ keywords across
 * work, goals, grocery, body, sleep, habits, finance, cycle, pets,
 * admin. Confirms applyRoute() lands brain-dump text in the right
 * slice — not in a generic <module>.items bucket.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { routeBrainDump, dispatchAction } from '../src/braindump-dispatch';
import type { GroceryPurchaseEvent } from '../src/braindump-dispatch';

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

  it('"pay the rent" → finance.bills (finance sub-classification)', () => {
    routeBrainDump('pay the rent', store, FIXED_NOW);
    // Görev 2: dispatchAction now carries the finance sub-classifier that
    // used to be UI-only. "rent" matches BILL_RE → finance.bills, NOT a
    // generic finance.items bucket.
    const bills = store.get<GenericItem[]>('finance', 'bills', []);
    expect(bills.length).toBeGreaterThan(0);
    expect(store.get<GenericItem[]>('finance', 'items', [])).toHaveLength(0);
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

// ─── Grocery purchase history (05-ADAPTIVE-REPLENISHMENT spec) ───────────────
//
// recordGroceryPurchase callback is injected via DispatchOptions. Tests use a
// memory recorder so no network call is required.
//
// NOTE: kind='add' AI-routing tests are async (the AI path is fire-and-forget).
// We use a manual mock for callGroceryRoute via _setAiProxyBaseUrl + a local
// fetch mock so the async path resolves in the test event loop.

describe('dispatchAction · grocery purchase history callbacks', () => {
  let store: ReturnType<typeof makeStore>;
  let recorded: GroceryPurchaseEvent[];
  let recordGroceryPurchase: (e: GroceryPurchaseEvent) => void;

  beforeEach(() => {
    store = makeStore();
    recorded = [];
    recordGroceryPurchase = (e) => recorded.push(e);
  });

  // TC1: kind='log' (pantry_add) → 1 event, source=pantry_add
  it('kind=log fires recordGroceryPurchase with source=pantry_add', () => {
    dispatchAction(
      { module: 'grocery', action: 'log', data: 'bought milk' },
      store,
      FIXED_NOW,
      { recordGroceryPurchase },
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].source).toBe('pantry_add');
    expect(recorded[0].canonical).toBe('bought milk');
    expect(recorded[0].ts).toBe(FIXED_NOW);
  });

  // TC5: multiple kind='log' calls → multiple events, each with own ts
  it('multiple kind=log calls produce independent events', () => {
    dispatchAction(
      { module: 'grocery', action: 'log', data: 'eggs' },
      store,
      FIXED_NOW,
      { recordGroceryPurchase },
    );
    dispatchAction(
      { module: 'grocery', action: 'log', data: 'butter' },
      store,
      FIXED_NOW + 1000,
      { recordGroceryPurchase },
    );
    expect(recorded).toHaveLength(2);
    expect(recorded[0].canonical).toBe('eggs');
    expect(recorded[0].ts).toBe(FIXED_NOW);
    expect(recorded[1].canonical).toBe('butter');
    expect(recorded[1].ts).toBe(FIXED_NOW + 1000);
  });

  // TC2: AI returns items[{target:'pantry', canonical:'milk'}] → 1 event, source=ai_inferred
  it('kind=add AI pantry result fires recordGroceryPurchase with source=ai_inferred', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: 'cache_hit',
        latencyMs: 50,
        language: 'en',
        classification: {
          items: [{ name: 'milk', canonical: 'milk', category: 'dairy', intent: 'buy', target: 'pantry' }],
        },
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    dispatchAction(
      { module: 'grocery', action: 'add', data: 'got milk' },
      store,
      FIXED_NOW,
      { recordGroceryPurchase, aiProxyBaseUrl: 'https://test-proxy' },
    );

    // Let the async AI path settle
    await new Promise((r) => setTimeout(r, 10));

    globalThis.fetch = originalFetch;

    // Exactly 1 event, pantry item
    const pantryEvents = recorded.filter((e) => e.source === 'ai_inferred');
    expect(pantryEvents).toHaveLength(1);
    expect(pantryEvents[0].canonical).toBe('milk');
    expect(pantryEvents[0].source).toBe('ai_inferred');
  });

  // TC3: AI returns 2 items (1 pantry, 1 shopping) → 1 event for pantry only
  it('kind=add with mixed targets fires 1 event for pantry item only', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: 'gemini_miss',
        latencyMs: 200,
        language: 'en',
        classification: {
          items: [
            { name: 'milk', canonical: 'milk', category: 'dairy', intent: 'buy', target: 'pantry' },
            { name: 'eggs', canonical: 'eggs', category: 'protein', intent: 'buy', target: 'shopping' },
          ],
        },
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    dispatchAction(
      { module: 'grocery', action: 'add', data: 'milk and eggs' },
      store,
      FIXED_NOW,
      { recordGroceryPurchase, aiProxyBaseUrl: 'https://test-proxy' },
    );

    await new Promise((r) => setTimeout(r, 10));
    globalThis.fetch = originalFetch;

    const pantryEvents = recorded.filter((e) => e.source === 'ai_inferred');
    expect(pantryEvents).toHaveLength(1);
    expect(pantryEvents[0].canonical).toBe('milk');
    // shopping item must NOT produce an event
    expect(recorded.filter((e) => e.canonical === 'eggs')).toHaveLength(0);
  });

  // TC4: AI fails (returns null) → 0 events
  it('kind=add when AI fails produces 0 purchase events', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    dispatchAction(
      { module: 'grocery', action: 'add', data: 'some groceries' },
      store,
      FIXED_NOW,
      { recordGroceryPurchase, aiProxyBaseUrl: 'https://test-proxy' },
    );

    await new Promise((r) => setTimeout(r, 20));
    globalThis.fetch = originalFetch;

    expect(recorded).toHaveLength(0);
  });

  // Callback omitted → no throw
  it('kind=log without recordGroceryPurchase opt does not throw', () => {
    expect(() =>
      dispatchAction(
        { module: 'grocery', action: 'log', data: 'rice' },
        store,
        FIXED_NOW,
        {},
      ),
    ).not.toThrow();
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

// ─── Görev 2: union coverage — finance sub-slices + body.episodes ─────────────
//
// These exercise the merged-in logic that used to live ONLY in
// apps/web/src/hooks/applyRoute.ts. Confirms the consolidated dispatchAction
// is a true superset.

describe('dispatchAction · finance sub-classification (merged from applyRoute)', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  const fin = (slice: string) => store.get<GenericItem[]>('finance', slice, []);

  it('"canva $20 monthly" → finance.subscriptions', () => {
    dispatchAction({ module: 'finance', action: 'log', data: 'canva $20 monthly' }, store, FIXED_NOW);
    expect(fin('subscriptions')).toHaveLength(1);
    expect(fin('items')).toHaveLength(0);
  });

  it('"paid $80 late fee on my card" → finance.adhd_tax', () => {
    dispatchAction({ module: 'finance', action: 'log', data: 'paid $80 late fee on my card' }, store, FIXED_NOW);
    expect(fin('adhd_tax')).toHaveLength(1);
  });

  it('"rent $800 every month" → finance.bills', () => {
    dispatchAction({ module: 'finance', action: 'log', data: 'rent $800 every month' }, store, FIXED_NOW);
    expect(fin('bills')).toHaveLength(1);
  });

  it('"save $100 toward laptop" → finance.goals', () => {
    dispatchAction({ module: 'finance', action: 'log', data: 'save $100 toward laptop' }, store, FIXED_NOW);
    expect(fin('goals')).toHaveLength(1);
  });

  it('"got paid $5000" → finance.records', () => {
    dispatchAction({ module: 'finance', action: 'log', data: 'got paid $5000' }, store, FIXED_NOW);
    expect(fin('records')).toHaveLength(1);
  });

  it('finance text with no markers → finance.transactions', () => {
    dispatchAction({ module: 'finance', action: 'log', data: 'thinking about money' }, store, FIXED_NOW);
    expect(fin('transactions')).toHaveLength(1);
  });
});

describe('dispatchAction · body.episodes (merged from applyRoute)', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it('"migraine today" → body.episodes (not body.items)', () => {
    dispatchAction({ module: 'body', action: 'log', data: 'migraine today' }, store, FIXED_NOW);
    expect(store.get<GenericItem[]>('body', 'episodes', [])).toHaveLength(1);
    expect(store.get<GenericItem[]>('body', 'items', [])).toHaveLength(0);
  });

  it('"took my magnesium" → body.supplements', () => {
    dispatchAction({ module: 'body', action: 'log', data: 'took my magnesium' }, store, FIXED_NOW);
    expect(store.get<GenericItem[]>('body', 'supplements', [])).toHaveLength(1);
  });

  it('unclassified body input → body.items', () => {
    dispatchAction({ module: 'body', action: 'log', data: 'went for a walk' }, store, FIXED_NOW);
    expect(store.get<GenericItem[]>('body', 'items', [])).toHaveLength(1);
  });
});
