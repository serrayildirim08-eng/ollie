/**
 * OnboardingScreen · commitAll tests.
 *
 * Calls the REAL commitAll exported from OnboardingScreen.tsx — the
 * prior version of this file duplicated the function body with flat
 * keys (`consent_spending_research`, `has_pets`) that haven't matched
 * the production code in months. We mock `../store` so the writes hit
 * an in-memory map we can assert against.
 *
 * Consent rewrite (Sprint 6) note: the old commitAll wrote
 * `consent.cycle` and `consent.spending_research`. The new one writes
 * neither — the master consent toggle lives in ConsentScreen and the
 * per-feature flags are gone. These tests pin that absence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the store BEFORE importing commitAll — Vitest hoists vi.mock,
// so by the time OnboardingScreen.tsx evaluates `import { store }`,
// the mock is in place.
vi.mock('../store', () => {
  const data = new Map<string, unknown>();
  return {
    store: {
      set: (mod: string, key: string, value: unknown) => {
        data.set(`${mod}:${key}`, value);
      },
      get: <T,>(mod: string, key: string, fallback: T): T => {
        const k = `${mod}:${key}`;
        return (data.has(k) ? (data.get(k) as T) : fallback);
      },
      __data: data,
    },
    useStoreSlice: <T,>(_mod: string, _key: string, fallback: T) => [fallback, () => {}],
  };
});

import { commitAll, type State } from './OnboardingScreen.commit';
import { store } from '../store';

const data = (store as unknown as { __data: Map<string, unknown> }).__data;

function baseState(overrides: Partial<State> = {}): State {
  return {
    screen: 0,
    name: '',
    country: 'INTL',
    hasPets: null,
    petDrafts: [],
    pantryItems: [],
    subscriptions: [],
    workTime: '',
    cycleTracking: '',
    visible: true,
    ...overrides,
  };
}

beforeEach(() => {
  data.clear();
});

describe('OnboardingScreen · commitAll', () => {
  it('sets shared.onboarded = true', () => {
    commitAll(baseState({ name: 'Serra', cycleTracking: 'yes' }));
    expect(data.get('shared:onboarded')).toBe(true);
  });

  it('persists name (trimmed) when provided', () => {
    commitAll(baseState({ name: '  Serra  ' }));
    expect(data.get('shared:name')).toBe('Serra');
  });

  it('persists null name when blank', () => {
    commitAll(baseState({ name: '' }));
    expect(data.get('shared:name')).toBeNull();
  });

  it('persists has_pets under the dotted settings namespace', () => {
    commitAll(baseState({ hasPets: true }));
    expect(data.get('shared:settings.has_pets')).toBe(true);
  });

  it('pets-no path leaves pets.pets empty', () => {
    commitAll(baseState({
      hasPets: false,
      petDrafts: [{ id: 'x', name: 'Tontin', species: 'guinea pig' }],
    }));
    const pets = data.get('pets:pets') as unknown[];
    expect(pets).toHaveLength(0);
  });

  it('pets-yes path seeds pets.pets with provided entries', () => {
    commitAll(baseState({
      hasPets: true,
      petDrafts: [
        { id: 'a', name: 'Tontin', species: 'guinea pig' },
        { id: 'b', name: 'Pinpon', species: 'guinea pig' },
      ],
    }));
    const pets = data.get('pets:pets') as Array<{ name: string }>;
    expect(pets).toHaveLength(2);
    expect(pets.map((p) => p.name)).toEqual(['Tontin', 'Pinpon']);
  });

  it('unnamed pet drafts are filtered out', () => {
    commitAll(baseState({
      hasPets: true,
      petDrafts: [
        { id: 'a', name: '', species: 'cat' },
        { id: 'b', name: 'Pinpon', species: 'guinea pig' },
      ],
    }));
    const pets = data.get('pets:pets') as Array<{ name: string }>;
    expect(pets).toHaveLength(1);
    expect(pets[0].name).toBe('Pinpon');
  });

  it('pantry items land in grocery.pantry', () => {
    commitAll(baseState({ pantryItems: ['eggs', 'milk', 'bread'] }));
    const pantry = data.get('grocery:pantry') as Array<{ name: string }>;
    expect(pantry).toHaveLength(3);
    expect(pantry.map((p) => p.name)).toEqual(['eggs', 'milk', 'bread']);
  });

  it('subscriptions land in finance.subscriptions', () => {
    commitAll(baseState({ subscriptions: ['Netflix', 'Spotify'] }));
    const subs = data.get('finance:subscriptions') as Array<{ name: string }>;
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.name)).toEqual(['Netflix', 'Spotify']);
  });

  it('work_time is persisted at settings.work_time', () => {
    commitAll(baseState({ workTime: 'late_night' }));
    expect(data.get('shared:settings.work_time')).toBe('late_night');
  });

  it('cycle_tracking is persisted at settings.cycle_tracking', () => {
    commitAll(baseState({ cycleTracking: 'yes' }));
    expect(data.get('shared:settings.cycle_tracking')).toBe('yes');
  });

  it('country falls back to INTL when blank', () => {
    commitAll(baseState({ country: '' }));
    expect(data.get('shared:settings.country')).toBe('INTL');
  });
});

describe('OnboardingScreen · commitAll · consent rewrite (Sprint 6)', () => {
  // Regression guard: the removed per-feature consent flags must NEVER
  // be written by onboarding again. The master consent gate lives in
  // ConsentScreen, written BEFORE onboarding ever runs.

  it('does NOT write consent.cycle', () => {
    commitAll(baseState({ cycleTracking: 'yes' }));
    expect(data.has('shared:consent.cycle')).toBe(false);
  });

  it('does NOT write consent.spending_research', () => {
    commitAll(baseState({ cycleTracking: 'no' }));
    expect(data.has('shared:consent.spending_research')).toBe(false);
  });

  it('does NOT write consent.astrology', () => {
    commitAll(baseState());
    expect(data.has('shared:consent.astrology')).toBe(false);
  });
});
