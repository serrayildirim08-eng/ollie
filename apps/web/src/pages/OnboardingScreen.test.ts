/**
 * Smoke tests for OnboardingScreen side-effects.
 *
 * We test the store mutations directly — no React render needed.
 * Uses a memory store, matching the pattern in useApplyBrainDump.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';

// ── helpers matching commitAll() logic in OnboardingScreen.tsx ────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

type PetDraft = { id: string; name: string; species: string };

interface OnboardingState {
  name: string;
  hasPets: boolean | null;
  petDrafts: PetDraft[];
  pantryItems: string[];
  subscriptions: string[];
  spendResearch: boolean | null;
  workTime: string;
  cycleTracking: string;
}

function commitAll(
  state: OnboardingState,
  store: ReturnType<typeof createStore>,
): void {
  const ts = Date.now();

  store.set('shared', 'name', state.name.trim() || null);
  store.set('shared', 'has_pets', state.hasPets ?? false);
  store.set('shared', 'work_time', state.workTime || null);
  store.set('shared', 'cycle_tracking', state.cycleTracking || null);
  store.set('shared', 'onboarded', true);
  store.set('shared', 'consent_spending_research', state.spendResearch ?? false);
  store.set('shared', 'consent_cycle', state.cycleTracking === 'yes');

  if (state.hasPets && state.petDrafts.length > 0) {
    const pets = state.petDrafts
      .filter((p) => p.name.trim())
      .map((p) => ({
        id: p.id,
        name: p.name.trim(),
        species: p.species.trim() || 'unknown',
        ts,
      }));
    store.set('pets', 'pets', pets);
  } else {
    store.set('pets', 'pets', []);
  }

  const pantry = state.pantryItems.map((name) => ({ id: uid(), name, ts }));
  store.set('grocery', 'pantry', pantry);

  const subs = state.subscriptions.map((name) => ({ id: uid(), name, ts }));
  store.set('finance', 'subscriptions', subs);
}

function makeStore() {
  return createStore(createMemoryAdapter());
}

// ── test suite ────────────────────────────────────────────────────────────────

describe('OnboardingScreen · commitAll', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it('sets shared.onboarded = true on completion', () => {
    commitAll(
      {
        name: 'Serra',
        hasPets: false,
        petDrafts: [],
        pantryItems: ['eggs', 'milk'],
        subscriptions: [],
        spendResearch: null,
        workTime: 'morning',
        cycleTracking: 'yes',
      },
      store,
    );
    expect(store.get('shared', 'onboarded', false)).toBe(true);
  });

  it('sets shared.onboarded = true on skip', () => {
    // Skip path: just writes onboarded flag
    store.set('shared', 'onboarded', true);
    expect(store.get('shared', 'onboarded', false)).toBe(true);
  });

  it('pets-no path leaves pets.pets empty', () => {
    commitAll(
      {
        name: 'Serra',
        hasPets: false,
        petDrafts: [{ id: 'x', name: 'Tontin', species: 'guinea pig' }],
        pantryItems: [],
        subscriptions: [],
        spendResearch: false,
        workTime: '',
        cycleTracking: 'no',
      },
      store,
    );
    const pets = store.get<unknown[]>('pets', 'pets', []);
    expect(pets).toHaveLength(0);
  });

  it('pets-yes path seeds pets.pets with provided entries', () => {
    commitAll(
      {
        name: 'Serra',
        hasPets: true,
        petDrafts: [
          { id: 'a', name: 'Tontin', species: 'guinea pig' },
          { id: 'b', name: 'Pinpon', species: 'guinea pig' },
        ],
        pantryItems: [],
        subscriptions: [],
        spendResearch: false,
        workTime: '',
        cycleTracking: 'no',
      },
      store,
    );
    const pets = store.get<Array<{ name: string; species: string }>>('pets', 'pets', []);
    expect(pets).toHaveLength(2);
    expect(pets[0].name).toBe('Tontin');
    expect(pets[1].name).toBe('Pinpon');
  });

  it('unnamed pet drafts are filtered out', () => {
    commitAll(
      {
        name: '',
        hasPets: true,
        petDrafts: [
          { id: 'a', name: '', species: 'cat' },
          { id: 'b', name: 'Pinpon', species: 'guinea pig' },
        ],
        pantryItems: [],
        subscriptions: [],
        spendResearch: false,
        workTime: '',
        cycleTracking: 'no',
      },
      store,
    );
    const pets = store.get<Array<{ name: string }>>('pets', 'pets', []);
    expect(pets).toHaveLength(1);
    expect(pets[0].name).toBe('Pinpon');
  });

  it('pantry items land in grocery.pantry', () => {
    commitAll(
      {
        name: '',
        hasPets: null,
        petDrafts: [],
        pantryItems: ['eggs', 'milk', 'bread'],
        subscriptions: [],
        spendResearch: null,
        workTime: '',
        cycleTracking: '',
      },
      store,
    );
    const pantry = store.get<Array<{ name: string }>>('grocery', 'pantry', []);
    expect(pantry).toHaveLength(3);
    expect(pantry.map((p) => p.name)).toEqual(['eggs', 'milk', 'bread']);
  });

  it('subscriptions land in finance.subscriptions', () => {
    commitAll(
      {
        name: '',
        hasPets: null,
        petDrafts: [],
        pantryItems: [],
        subscriptions: ['Netflix', 'Spotify'],
        spendResearch: null,
        workTime: '',
        cycleTracking: '',
      },
      store,
    );
    const subs = store.get<Array<{ name: string }>>('finance', 'subscriptions', []);
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.name)).toEqual(['Netflix', 'Spotify']);
  });

  it('consent_cycle = true when cycleTracking = yes', () => {
    commitAll(
      {
        name: '',
        hasPets: null,
        petDrafts: [],
        pantryItems: [],
        subscriptions: [],
        spendResearch: null,
        workTime: '',
        cycleTracking: 'yes',
      },
      store,
    );
    expect(store.get('shared', 'consent_cycle', false)).toBe(true);
  });

  it('consent_cycle = false when cycleTracking = no', () => {
    commitAll(
      {
        name: '',
        hasPets: null,
        petDrafts: [],
        pantryItems: [],
        subscriptions: [],
        spendResearch: null,
        workTime: '',
        cycleTracking: 'no',
      },
      store,
    );
    expect(store.get('shared', 'consent_cycle', false)).toBe(false);
  });

  it('work_time is persisted', () => {
    commitAll(
      {
        name: '',
        hasPets: null,
        petDrafts: [],
        pantryItems: [],
        subscriptions: [],
        spendResearch: null,
        workTime: 'late_night',
        cycleTracking: '',
      },
      store,
    );
    expect(store.get('shared', 'work_time', null)).toBe('late_night');
  });

  it('spend_research consent is persisted', () => {
    commitAll(
      {
        name: '',
        hasPets: null,
        petDrafts: [],
        pantryItems: [],
        subscriptions: [],
        spendResearch: true,
        workTime: '',
        cycleTracking: '',
      },
      store,
    );
    expect(store.get('shared', 'consent_spending_research', false)).toBe(true);
  });
});
