/**
 * apps/web · NotificationPrimer
 *
 * A calm, one-time priming screen shown the first time the user reaches
 * the app proper — AFTER onboarding completes (see GatedLayout in
 * router.tsx). It exists to fix a real bug a prior audit flagged: the
 * Capacitor backend used to call `requestPermissions()` COLD at app boot,
 * so the iOS system permission dialog fired on first launch with zero
 * context.
 *
 * The fix has two halves:
 *   1. `installCapacitorBackend()` no longer pops the OS dialog — it only
 *      wires the APNs listeners (see packages/notifications capacitor.ts).
 *   2. This screen explains, in ollie's voice, what notifications ARE
 *      before the OS dialog ever appears. "turn them on" calls the
 *      dispatcher's `requestPermission()`, which delegates to the
 *      installed per-platform backend (iOS → APNs prompt; web/electron →
 *      their own lazy request). "not now" dismisses without touching the
 *      OS — the user can enable later from Settings.
 *
 * Shown ONCE: a `shared.notif_primer_seen` flag is written on either
 * action (or Esc / backdrop dismiss), so it never reappears.
 *
 * Voice: lowercase, dry, no exclamation marks, no theatrics. Notifications
 * here are functional reminders the user asked for — a bill due, a vet
 * med, an appointment tomorrow — and explicitly NOT re-engagement,
 * streaks, guilt, or nagging. That promise IS the pitch.
 *
 * // LOCALIZE_LATER — all copy is English; ES translations pending.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { requestPermission } from '@ollie/notifications';
import { store } from '../store';

/** Store coordinates for the one-time seen flag. */
const PRIMER_SLICE = 'shared';
const PRIMER_KEY = 'notif_primer_seen';

/** True once the primer has been shown (either action taken). */
export function hasSeenNotificationPrimer(): boolean {
  return Boolean(store.get<boolean>(PRIMER_SLICE, PRIMER_KEY, false));
}

function markNotificationPrimerSeen(): void {
  store.set(PRIMER_SLICE, PRIMER_KEY, true);
}

export interface NotificationPrimerProps {
  /**
   * Called once the primer is done with — after the OS request resolves
   * ("turn them on") or immediately ("not now" / dismiss). The parent
   * unmounts the primer on this; the seen flag is already persisted.
   */
  onDone: () => void;
}

type Phase = 'idle' | 'requesting';

export function NotificationPrimer({ onDone }: NotificationPrimerProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('idle');

  const finish = useCallback(() => {
    markNotificationPrimerSeen();
    onDone();
  }, [onDone]);

  // "not now" / Esc / backdrop — dismiss WITHOUT touching the OS. The
  // user can still enable notifications later from Settings.
  const handleNotNow = useCallback(() => {
    if (phase === 'requesting') return;
    finish();
  }, [phase, finish]);

  // "turn them on" — trigger the REAL per-platform permission request.
  // The dispatcher delegates to the installed backend: iOS pops the APNs
  // dialog (and registers the device on grant); web/electron run their
  // own lazy request. Whatever the user picks, the primer is done.
  const handleTurnOn = useCallback(async () => {
    if (phase === 'requesting') return;
    setPhase('requesting');
    try {
      await requestPermission();
    } catch {
      /* non-fatal — a denied / failed prompt still completes the primer */
    } finally {
      finish();
    }
  }, [phase, finish]);

  // Esc closes via the quiet path. Capacitor has no Esc, but web/electron
  // users expect it; matches the rest of the app's modal behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') handleNotNow();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNotNow]);

  const busy = phase === 'requesting';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notif-primer-title"
      aria-describedby="notif-primer-body"
      onClick={handleNotNow}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'rgba(20, 20, 15, 0.32)',
        animation: 'notif-primer-veil 200ms var(--e-calm-out) both',
      }}
    >
      {/* component-scoped keyframes — no edit to the shared design CSS */}
      <style>{`
        @keyframes notif-primer-veil { from { opacity: 0 } to { opacity: 1 } }
        @keyframes notif-primer-rise {
          from { opacity: 0; transform: translateY(10px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>

      {/* card — stop propagation so a click inside doesn't dismiss */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(92vw, 420px)',
          background: 'var(--bone)',
          border: '1px solid var(--rule)',
          borderRadius: 18,
          padding: '32px 28px 26px',
          animation: 'notif-primer-rise 280ms var(--e-calm-out) both',
        }}
      >
        {/* kicker */}
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
          }}
        >
          a quiet ask {/* LOCALIZE_LATER */}
        </p>

        {/* title */}
        <h2
          id="notif-primer-title"
          style={{
            margin: '12px 0 0',
            fontFamily: 'var(--font-editor)',
            fontWeight: 400,
            fontSize: 28,
            lineHeight: 1.15,
            color: 'var(--ink)',
          }}
        >
          notifications, only when they earn it {/* LOCALIZE_LATER */}
        </h2>

        {/* body */}
        <div
          id="notif-primer-body"
          style={{
            margin: '16px 0 0',
            fontFamily: 'var(--font-system)',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink-soft)',
          }}
        >
          {/* LOCALIZE_LATER */}
          <p style={{ margin: 0 }}>
            ollie sends a notification only when something you asked it to
            track actually needs you — a bill due tomorrow, a vet med, an
            appointment in the morning.
          </p>
          {/* notif-scope-allow — copy quotes "we miss you" only to disavow it;
              this is anti-dark-pattern priming text, not an engagement push. */}
          <p style={{ margin: '12px 0 0' }}>
            no “we miss you”, no streaks, no guilt, no nudging you back in.
            if there's nothing for you, it stays quiet.
          </p>
        </div>

        {/* actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            marginTop: 26,
          }}
        >
          <button
            type="button"
            onClick={() => { void handleTurnOn(); }}
            disabled={busy}
            style={{
              width: '100%',
              padding: '13px 20px',
              minHeight: 48,
              background: 'var(--ink)',
              color: 'var(--bone)',
              border: '1px solid var(--ink)',
              borderRadius: 24,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-caption)',
              letterSpacing: 'var(--ls-caps-small)',
              textTransform: 'uppercase',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.55 : 1,
              transition: 'opacity var(--d-tap) var(--e-calm-out)',
            }}
          >
            {busy ? 'asking...' : 'turn them on'} {/* LOCALIZE_LATER */}
          </button>

          <button
            type="button"
            onClick={handleNotNow}
            disabled={busy}
            style={{
              width: '100%',
              padding: '11px 20px',
              minHeight: 44,
              background: 'transparent',
              color: 'var(--ink-faint)',
              border: 'none',
              borderRadius: 24,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-caption)',
              letterSpacing: 'var(--ls-caps-small)',
              textTransform: 'uppercase',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.4 : 1,
              transition: 'opacity var(--d-tap) var(--e-calm-out)',
            }}
          >
            not now {/* LOCALIZE_LATER */}
          </button>
        </div>

        {/* footnote — the escape hatch, stated plainly */}
        <p
          style={{
            margin: '14px 0 0',
            fontFamily: 'var(--font-system)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--ink-faint)',
            textAlign: 'center',
          }}
        >
          {/* LOCALIZE_LATER */}
          you can change this any time in settings.
        </p>
      </div>
    </div>
  );
}

export default NotificationPrimer;
