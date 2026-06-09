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
import { routeBrainDump, dispatchAction, applyGroceryMutations } from '../src/braindump-dispatch';
import type { GroceryPurchaseEvent, GroceryMutationEntry, GroceryRoutedItem } from '../src/braindump-dispatch';

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

  // Phantom-fix (2026-05-21): habits brain-dump text now lands in the
  // slice HabitsApp/HabitsModule actually read (`shared.habits_v2`, the
  // StoredHabit[] list), not the unread `habits.items` bucket.
  it('"exercise: walked 30 min" → shared.habits_v2 (NOT habits.items)', () => {
    routeBrainDump('exercise: walked 30 min', store, FIXED_NOW);
    const habits = store.get<Array<{ name: string; cueTime: string }>>(
      'shared', 'habits_v2', [],
    );
    expect(habits.length).toBeGreaterThan(0);
    expect(habits[0].name).toContain('exercise');
    expect(store.get<GenericItem[]>('habits', 'items', [])).toHaveLength(0);
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

  // Phantom-fix (2026-05-21): pets brain-dump text now lands in the slice
  // the UI actually reads (`pets.observations`, not `pets.items`).
  it('"tontin needs hay" → pets.observations (NOT pets.items)', () => {
    routeBrainDump('tontin needs hay', store, FIXED_NOW);
    const obs = store.get<Array<{ id: string; text: string; pet_id: string; tags: string[] }>>(
      'pets', 'observations', [],
    );
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].text).toContain('tontin');
    expect(obs[0].pet_id).toBe(''); // unattached until user resolves
    expect(Array.isArray(obs[0].tags)).toBe(true);
    // The phantom slice MUST stay empty — that was the silent-loss path.
    expect(store.get<GenericItem[]>('pets', 'items', [])).toHaveLength(0);
  });

  // Phantom-fix: admin → admin.tasks (the slice AdminApp/AdminModule read).
  it('"renew passport" → admin.tasks (NOT admin.items)', () => {
    routeBrainDump('renew passport', store, FIXED_NOW);
    const tasks = store.get<Array<{ id: string; label: string; state: string; status: string }>>(
      'admin', 'tasks', [],
    );
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].label).toContain('renew passport');
    expect(tasks[0].state).toBe('open');
    expect(store.get<GenericItem[]>('admin', 'items', [])).toHaveLength(0);
  });

  it('"so tired tonight, going to bed" → sleep.items', () => {
    routeBrainDump('so tired tonight, going to bed', store, FIXED_NOW);
    const sleep = store.get<GenericItem[]>('sleep', 'items', []);
    expect(sleep.length).toBeGreaterThan(0);
  });
});

// ─── Phantom-fix (2026-05-21) ─────────────────────────────────────────────────
//
// Five modules used to silently lose brain-dump input: the dispatcher's
// default fallthrough wrote to `<module>.items`, but the UI didn't read it.
// Coverage below pins each fix to the slice the UI actually subscribes to,
// plus the "no UI surface → dump.items" reroute for health + reminders.

describe('phantom-fix · explicit handlers land in UI-read slices', () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  // ── pets ─────────────────────────────────────────────────────────────
  it('synthetic pets action lands in pets.observations with StoredObservation shape', () => {
    dispatchAction(
      { module: 'pets', action: 'add', data: 'guinea pig hay refilled' },
      store, FIXED_NOW,
    );
    type Obs = {
      id: string; pet_id: string; text: string; tags: string[];
      kind: string; created_at: number; occurred_at: number;
    };
    const obs = store.get<Obs[]>('pets', 'observations', []);
    expect(obs).toHaveLength(1);
    expect(obs[0].kind).toBe('note');
    expect(obs[0].created_at).toBe(FIXED_NOW);
    expect(obs[0].occurred_at).toBe(FIXED_NOW);
    expect(obs[0].tags).toEqual([]);
    expect(store.get<unknown[]>('pets', 'items', [])).toHaveLength(0);
  });

  // ── admin ────────────────────────────────────────────────────────────
  it('synthetic admin action lands in admin.tasks with AdminItem shape', () => {
    dispatchAction(
      { module: 'admin', action: 'add', data: 'book dentist' },
      store, FIXED_NOW,
    );
    type Task = {
      id: string; label: string; title: string;
      state: string; status: string; created_at: number; ts: number;
    };
    const tasks = store.get<Task[]>('admin', 'tasks', []);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].label).toBe('book dentist');
    expect(tasks[0].title).toBe('book dentist');
    expect(tasks[0].state).toBe('open');
    expect(tasks[0].status).toBe('open');
    expect(tasks[0].created_at).toBe(FIXED_NOW);
    expect(tasks[0].ts).toBe(FIXED_NOW);
    expect(store.get<unknown[]>('admin', 'items', [])).toHaveLength(0);
  });

  // ── habits ───────────────────────────────────────────────────────────
  it('synthetic habits action lands in shared.habits_v2 with StoredHabit shape', () => {
    dispatchAction(
      { module: 'habits', action: 'add', data: 'stretch after coffee' },
      store, FIXED_NOW,
    );
    type Habit = {
      id: string; name: string; cue: string;
      cueTime: 'morning' | 'anytime' | 'evening';
      completions: Array<{ ts: number }>;
    };
    const habits = store.get<Habit[]>('shared', 'habits_v2', []);
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('stretch after coffee');
    expect(habits[0].cueTime).toBe('anytime');
    expect(habits[0].completions).toEqual([]);
    expect(habits[0].id.startsWith('h_')).toBe(true);
    expect(store.get<unknown[]>('habits', 'items', [])).toHaveLength(0);
  });

  it('a second habits action appends to shared.habits_v2 (does not clobber)', () => {
    dispatchAction({ module: 'habits', action: 'add', data: 'a' }, store, FIXED_NOW);
    dispatchAction({ module: 'habits', action: 'add', data: 'b' }, store, FIXED_NOW);
    const habits = store.get<Array<{ name: string }>>('shared', 'habits_v2', []);
    expect(habits.map((h) => h.name)).toEqual(['a', 'b']);
  });

  // ── health ───────────────────────────────────────────────────────────
  // No `health` UI surface exists; route to dump.items so it surfaces in
  // the brain-dump archive instead of vanishing into `health.items`.
  it('synthetic health action reroutes to dump.items (NOT health.items)', () => {
    dispatchAction(
      { module: 'health', action: 'add', data: 'sprained my ankle on the stairs' },
      store, FIXED_NOW,
    );
    const dump = store.get<GenericItem[]>('dump', 'items', []);
    expect(dump).toHaveLength(1);
    expect(dump[0].text).toContain('sprained');
    expect(store.get<unknown[]>('health', 'items', [])).toHaveLength(0);
  });

  it('keyword-routed "sprained my ankle" → dump.items via health reroute', () => {
    routeBrainDump('sprained my ankle today', store, FIXED_NOW);
    const dump = store.get<GenericItem[]>('dump', 'items', []);
    expect(dump.length).toBeGreaterThan(0);
    expect(store.get<unknown[]>('health', 'items', [])).toHaveLength(0);
  });

  // ── reminders ───────────────────────────────────────────────────────
  // fallbackRoute no longer emits `reminders` actions — reminder scheduling
  // runs upstream in useApplyBrainDump via parseReminder. Verify the
  // keyword path does not produce an orphan `reminders.items` row.
  it('"remind me to call mama tomorrow" → no reminders.items orphan row', () => {
    const r = routeBrainDump('remind me to call mama tomorrow', store, FIXED_NOW);
    expect(r.modulesHit).not.toContain('reminders');
    expect(store.get<unknown[]>('reminders', 'items', [])).toHaveLength(0);
  });

  it('a synthetic `reminders` action still lands in reminders.items via the default fallthrough (back-compat for direct callers)', () => {
    // The ModuleName union still includes 'reminders' so older callers
    // that build the Action by hand keep working — the default branch
    // just writes the generic shape. This is the SAFE behaviour now that
    // the keyword router no longer manufactures these actions itself.
    dispatchAction(
      { module: 'reminders', action: 'add', data: 'call mama' },
      store, FIXED_NOW,
    );
    const items = store.get<GenericItem[]>('reminders', 'items', []);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('call mama');
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

// ─── onGroceryMutation callback tests (2026-05-22) ───────────────────────────
//
// Verify applyGroceryMutations emits the correct GroceryMutationEntry for
// each action variant. All tests use applyGroceryMutations directly so
// there's no network dependency.

describe('applyGroceryMutations · onGroceryMutation callback', () => {
  let store: ReturnType<typeof makeStore>;
  let emitted: GroceryMutationEntry[];
  let onGroceryMutation: (entry: GroceryMutationEntry) => void;

  type ShoppingItem = { id: string; name: string; canonical?: string | null; ts: number; checked: boolean };
  type PantryItem = { id: string; name: string; canonical?: string | null; ts: number; boughtTs: number };

  beforeEach(() => {
    store = makeStore();
    emitted = [];
    onGroceryMutation = (e) => emitted.push(e);
  });

  // TC-M1: remove action emits correct entry with restore_to_items reverse
  it('remove action emits entry with restore_to_items reverse', () => {
    // Seed a shopping item
    store.update<ShoppingItem[]>('grocery', 'items', () => [
      { id: 'item-1', name: 'pasta', canonical: 'pasta', ts: FIXED_NOW, checked: false },
    ]);

    const items: GroceryRoutedItem[] = [{
      name: 'pasta',
      canonical: 'pasta',
      category: 'dry-goods',
      intent: 'remove',
      target: 'shopping',
      action: 'remove',
    }];

    applyGroceryMutations(items, store, FIXED_NOW, { onGroceryMutation });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('remove');
    expect(emitted[0].description).toContain('pasta');
    expect(emitted[0].description).toContain('shop');
    expect(emitted[0].reverse.kind).toBe('restore_to_items');
    if (emitted[0].reverse.kind === 'restore_to_items') {
      expect(emitted[0].reverse.item.name).toBe('pasta');
      expect(emitted[0].reverse.item.id).toBe('item-1');
    }
    // Item must be gone from the store
    expect(store.get<ShoppingItem[]>('grocery', 'items', [])).toHaveLength(0);
  });

  // TC-M2: check action emits entry with set_checked reverse (pre-state snapshot)
  it('check action emits entry with set_checked reverse carrying pre-state', () => {
    store.update<ShoppingItem[]>('grocery', 'items', () => [
      { id: 'item-2', name: 'bread', canonical: 'bread', ts: FIXED_NOW, checked: false },
    ]);

    const items: GroceryRoutedItem[] = [{
      name: 'bread',
      canonical: 'bread',
      category: 'bakery',
      intent: 'check',
      target: 'shopping',
      action: 'check',
    }];

    applyGroceryMutations(items, store, FIXED_NOW, { onGroceryMutation });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('check');
    expect(emitted[0].reverse.kind).toBe('set_checked');
    if (emitted[0].reverse.kind === 'set_checked') {
      expect(emitted[0].reverse.updates).toHaveLength(1);
      // Pre-state was checked=false
      expect(emitted[0].reverse.updates[0]).toEqual({ id: 'item-2', checked: false });
    }
    // Item should now be checked in store
    const after = store.get<ShoppingItem[]>('grocery', 'items', []);
    expect(after[0].checked).toBe(true);
  });

  // TC-M3: move_to_pantry emits composite reverse
  it('move_to_pantry emits composite reverse with remove_from_pantry + restore_to_items', () => {
    store.update<ShoppingItem[]>('grocery', 'items', () => [
      { id: 'item-3', name: 'milk', canonical: 'milk', ts: FIXED_NOW, checked: false },
    ]);

    const items: GroceryRoutedItem[] = [{
      name: 'milk',
      canonical: 'milk',
      category: 'dairy',
      intent: 'move_to_pantry',
      target: 'shopping',
      action: 'move_to_pantry',
    }];

    applyGroceryMutations(items, store, FIXED_NOW, { onGroceryMutation });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('move_to_pantry');
    expect(emitted[0].description).toContain('milk');
    expect(emitted[0].description).toContain('pantry');
    expect(emitted[0].reverse.kind).toBe('composite');
    if (emitted[0].reverse.kind === 'composite') {
      const kinds = emitted[0].reverse.steps.map((s) => s.kind);
      expect(kinds).toContain('remove_from_pantry');
      expect(kinds).toContain('restore_to_items');
    }
    // Shop should be empty, pantry should have 1
    expect(store.get<ShoppingItem[]>('grocery', 'items', [])).toHaveLength(0);
    expect(store.get<PantryItem[]>('grocery', 'pantry', [])).toHaveLength(1);
  });

  // TC-M4: plain add with no mutation text does NOT skip the callback (still emits for add)
  it('add action emits entry with remove_from_items reverse', () => {
    const items: GroceryRoutedItem[] = [{
      name: 'eggs',
      canonical: 'eggs',
      category: 'protein',
      intent: 'add',
      target: 'shopping',
      action: 'add',
    }];

    applyGroceryMutations(items, store, FIXED_NOW, { onGroceryMutation });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('add');
    expect(emitted[0].reverse.kind).toBe('remove_from_items');
  });
});
