/**
 * apps/web · HealthKitConsent
 *
 * Optional Apple Health connect button shown on the onboarding screen
 * (before the Work-Time question) and later in Settings.
 *
 * BLOCKED-EXTERNAL pre-Apple-Developer-approval. Until then:
 *   - On web / non-iOS: this component returns null. The user never
 *     sees a non-functional CTA.
 *   - On iOS Capacitor without the plugin Pod installed: the underlying
 *     `requestPermissions()` returns HK_AUTH_UNSUPPORTED — we surface
 *     a calm "not available on this device" line and the user moves on.
 *
 * Consent gate: defense-in-depth. Even though the master consent
 * (canonical `@ollie/consent` necessary flag) is enforced at app entry,
 * we double-check here so an accidental render somewhere else also
 * respects the gate.
 *
 * Persisted state (after the user finishes the auth sheet):
 *   shared.healthkit.connected_at   number | null   (unix ms when granted)
 *   shared.healthkit.last_status    HealthKitAuthStatus
 *   shared.healthkit.consent_at     number | null   (when the prompt completed)
 *
 * These keys are LOCAL only — they describe consent state, not health
 * data. They are not in the encrypt-and-sync set; they live alongside
 * the rest of `shared.*` settings.
 */

import { useState } from 'react';
import {
  HK_AUTH_GRANTED,
  HK_AUTH_UNSUPPORTED,
  isAuthorized,
  isHealthKitAvailable,
  requestPermissions,
  type HealthKitAuthStatus,
} from '@ollie/capacitor-healthkit';
import { hasNecessaryConsent } from '@ollie/consent';
import { store } from '../store';

interface ViteEnv {
  VITE_HEALTHKIT_ENABLED?: string;
}
const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

export interface HealthKitConsentProps {
  /** Called after the prompt completes (granted, denied, or unsupported). */
  onDone?: (status: HealthKitAuthStatus) => void;
}

type Phase = 'idle' | 'prompting' | 'done';

export function HealthKitConsent({ onDone }: HealthKitConsentProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<HealthKitAuthStatus | null>(null);

  // Defense-in-depth consent gate. Reads the canonical @ollie/consent state.
  const consentGiven = hasNecessaryConsent(store);
  if (!consentGiven) return null;

  // Env flag — hide the CTA in environments that don't ship HealthKit.
  if (env.VITE_HEALTHKIT_ENABLED !== '1') {
    return null;
  }

  // Web / non-iOS — hide rather than render an inert button.
  // (Onboarding's BankLinkScreen still routes the user forward via
  // `onDone` callback indirection — the parent renders a "skip" button
  // alongside that handles the no-CTA path.)
  if (!isHealthKitAvailable()) {
    return null;
  }

  async function handleConnect() {
    setPhase('prompting');
    try {
      const r = await requestPermissions();
      const now = Date.now();
      store.set('shared', 'healthkit.last_status', r.status);
      store.set('shared', 'healthkit.consent_at', now);
      if (isAuthorized(r.status)) {
        store.set('shared', 'healthkit.connected_at', now);
      } else {
        store.set('shared', 'healthkit.connected_at', null);
      }
      setStatus(r.status);
    } catch (err) {
      console.warn('[HealthKitConsent] prompt failed', err);
      store.set('shared', 'healthkit.last_status', HK_AUTH_UNSUPPORTED);
      setStatus(HK_AUTH_UNSUPPORTED);
    } finally {
      setPhase('done');
      try { onDone?.(status ?? HK_AUTH_GRANTED); } catch { /* non-fatal */ }
    }
  }

  if (phase === 'done') {
    const granted = status ? isAuthorized(status) : false;
    return (
      <p
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-faint)',
          letterSpacing: '0.06em',
          lineHeight: 1.55,
          marginBottom: '24px',
        }}
      >
        {granted
          ? 'apple health connected. data stays on your device.'
          : 'apple health not connected. you can try again in settings later.'}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={phase === 'prompting'}
      style={{
        padding: '14px 32px',
        minHeight: '48px',
        border: '1px solid var(--ink)',
        borderRadius: '24px',
        background: 'transparent',
        color: 'var(--ink)',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-caption)',
        letterSpacing: '0.08em',
        cursor: phase === 'prompting' ? 'not-allowed' : 'pointer',
        opacity: phase === 'prompting' ? 0.5 : 1,
        transition: 'opacity 200ms ease',
        alignSelf: 'flex-start',
      }}
    >
      {phase === 'prompting' ? 'prompting...' : 'connect apple health'}
    </button>
  );
}
