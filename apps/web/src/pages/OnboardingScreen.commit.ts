/**
 * OnboardingScreen · commitAll (extracted)
 *
 * Pure data layer for onboarding completion. Lives in its own
 * file (no React imports) so unit tests can call commitAll directly
 * without pulling Burhan3D / three.js through OnboardingScreen.tsx.
 *
 * Consent rewrite (Sprint 6): per-feature consent.* flags
 * (spending_research, cycle, astrology) are NOT written here — the
 * master consent gate is shared.consent.necessary, written by
 * ConsentScreen BEFORE this flow ever runs.
 */

import { store } from '../store';

export interface PetDraft {
  id: string;
  name: string;
  species: string;
}

export interface State {
  screen: number;
  name: string;
  age: string;
  country: string;
  hasPets: boolean | null;
  petDrafts: PetDraft[];
  pantryItems: string[];
  subscriptions: string[];
  workTime: string;
  cycleTracking: string;
  // transition
  visible: boolean;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function commitAll(state: State): void {
  const ts = Date.now();

  // shared.settings — dotted namespace matches the keys other surfaces read.
  // Credibility audit NC4: previously these were written as flat keys
  // (`has_pets`, `consent_spending_research`) and silently lost.
  store.set('shared', 'name', state.name.trim() || null);
  // Age — free-text numeric input. Stored as a number; null when blank or
  // out of a plausible range (replaced the old age-range chips).
  const ageNum = parseInt(state.age, 10);
  store.set(
    'shared',
    'settings.age',
    Number.isFinite(ageNum) && ageNum > 0 && ageNum < 120 ? ageNum : null,
  );
  store.set('shared', 'settings.has_pets', state.hasPets ?? false);
  store.set('shared', 'settings.work_time', state.workTime || null);
  store.set('shared', 'settings.cycle_tracking', state.cycleTracking || null);
  // F3 (Sprint 5): country drives crisis hotline selection. INTL = no
  // specific country, fall through to global directory.
  store.set('shared', 'settings.country', state.country || 'INTL');
  store.set('shared', 'onboarded', true);

  // Consent rewrite (Sprint 6): per-feature consent flags (cycle /
  // astrology / spending_research) are gone — the master consent gate
  // is shared.consent.necessary, written by ConsentScreen BEFORE this
  // flow ever runs.

  // pets.pets
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

  // grocery.pantry
  const pantry = state.pantryItems.map((name) => ({
    id: uid(),
    name,
    ts,
  }));
  store.set('grocery', 'pantry', pantry);

  // finance.subscriptions
  const subs = state.subscriptions.map((name) => ({
    id: uid(),
    name,
    ts,
  }));
  store.set('finance', 'subscriptions', subs);
}
