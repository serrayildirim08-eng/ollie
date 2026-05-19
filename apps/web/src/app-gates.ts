/**
 * apps/web · app gate hooks
 *
 * The four gates that used to wrap `AppInner` — auth, consent.necessary,
 * research opt-in, onboarding — extracted into a single hook during the
 * react-router migration (2026-05-18).
 *
 * CRITICAL: the gate LOGIC is unchanged. The early-`return` chain in the
 * old `AppInner` is now `GatedLayout` in router.tsx; this hook owns the
 * exact same state seeds, the exact same one-way flip semantics and the
 * exact same evaluation order. No gate was loosened or reordered.
 *
 *   Gate order: auth → consent.necessary → research opt-in → onboarding.
 *
 * The gate state is created ONCE, in `AppServicesProvider`, and shared
 * via context — so a sign-out triggered from SettingsScreen flips the
 * same `authed` state that `GatedLayout` reads on its next render. (A
 * per-call `useState` would have given SettingsScreen its own private
 * copy and the sign-out would not have propagated.)
 *
 * `configureConsent` is booted here, BEFORE the first canonical consent
 * read, so the lazy legacy-key migration inside getConsentSync() /
 * hasNecessaryConsent() is visible to every consumer — identical to the
 * old `consentBootedRef` block.
 */

import { useState } from 'react';
import {
  configureConsent,
  getConsentSync,
  hasNecessaryConsent,
} from '@ollie/consent';
import { store } from './store';
import { createConsentSync } from './lib/consent-sync';

/**
 * Clerk is the identity layer. When `VITE_CLERK_PUBLISHABLE_KEY` is unset
 * (a keyless local/dogfood build) there is no way to sign in, so the auth
 * gate is skipped and the app falls through to onboarding-first behavior.
 */
export const CLERK_CONFIGURED = Boolean(
  (import.meta as unknown as { env?: { VITE_CLERK_PUBLISHABLE_KEY?: string } }).env
    ?.VITE_CLERK_PUBLISHABLE_KEY,
);

if (!CLERK_CONFIGURED && typeof console !== 'undefined') {
  console.warn('[ollie] VITE_CLERK_PUBLISHABLE_KEY missing — auth disabled');
}

/**
 * One-time consent subsystem boot. Runs `configureConsent` exactly once
 * per page load, BEFORE any canonical consent read.
 */
let consentBooted = false;
function ensureConsentConfigured(): void {
  if (consentBooted) return;
  configureConsent({ store, sync: createConsentSync() });
  consentBooted = true;
}

export interface AppGates {
  // Gate 1 · auth
  authed: boolean;
  markAuthed: () => void;
  markSignedOut: () => void;
  // Gate 2 · consent.necessary
  consentGiven: boolean;
  markConsentGiven: () => void;
  // Gate 3 · research opt-in
  researchOptin: boolean | null;
  /** ConsentStep `source`: 'onboarding' for fresh sign-ups, 'reprompt' otherwise. */
  researchSource: 'onboarding' | 'reprompt';
  /** Marketing-consent snapshot, fed into ConsentStep's `initial`. */
  marketing: boolean;
  markResearchDecided: () => void;
  // Gate 4 · onboarding
  onboarded: boolean;
  markOnboarded: () => void;
}

/**
 * Create the four gates as one shared state bundle. Called ONCE from
 * `AppServicesProvider`; the result is published on context.
 *
 * Gate 1 (auth) is driven by AuthFlow, which owns BOTH Clerk sign-in AND
 * the passphrase-vault unlock; it calls `markAuthed()` once both pass.
 * The vault always re-locks on reload (its key is in-memory only), so on
 * a configured build this gate always starts closed.
 */
export function useAppGates(): AppGates {
  ensureConsentConfigured();

  // Gate 1 — auth. Starts closed: Clerk sign-in + vault unlock must both
  // complete (AuthFlow → markAuthed). Open from the start only on a
  // keyless dev build where there is no sign-in to perform.
  const [authed, setAuthed] = useState<boolean>(!CLERK_CONFIGURED);

  // Gate 2 — consent.necessary (master app-boot gate, one-way).
  const [consentGiven, setConsentGiven] = useState<boolean>(() =>
    hasNecessaryConsent(store),
  );

  // Gate 3 — research opt-in. null → never prompted.
  const snapshot = getConsentSync(store);
  const [researchOptin, setResearchOptin] = useState<boolean | null>(
    () => snapshot.research_optin,
  );

  // Gate 4 — onboarding. First-launch detection via the store flag.
  const [onboarded, setOnboarded] = useState<boolean>(() =>
    Boolean(store.get<boolean>('shared', 'onboarded', false)),
  );

  // `source` distinguishes a fresh sign-up from a pre-pivot re-prompt by
  // the persisted `onboarded` flag — same check as the old AppInner.
  const onboardedRaw = store.get<boolean>('shared', 'onboarded', false);

  return {
    authed,
    markAuthed: () => setAuthed(true),
    markSignedOut: () => setAuthed(false),
    consentGiven,
    markConsentGiven: () => setConsentGiven(true),
    researchOptin,
    researchSource: onboardedRaw ? 'reprompt' : 'onboarding',
    marketing: snapshot.marketing,
    markResearchDecided: () => {
      // Re-read the canonical row after ConsentStep persisted it.
      const written = getConsentSync(store);
      setResearchOptin(written.research_optin ?? false);
    },
    onboarded,
    markOnboarded: () => {
      store.set('shared', 'onboarded', true);
      setOnboarded(true);
    },
  };
}
