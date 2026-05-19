/**
 * apps/web · AppLockGate
 *
 * The re-entry curtain. When the user has opted app-lock ON (Settings →
 * security), this overlay covers the whole app:
 *   - on cold boot, and
 *   - on resume after the app sat in the background past RELOCK_AFTER_MS.
 *
 * It asks for a platform biometric (Face ID / fingerprint / Windows
 * Hello). A pass lifts the curtain. The user is already signed in and
 * their data is already decrypted in the session — this is convenience,
 * not auth. See lib/app-lock.ts for the honest framing.
 *
 * NEVER STRAND THE USER. Three escape paths, in order of friction:
 *   1. "try again"          — re-run the biometric prompt.
 *   2. "use passphrase"     — a minimal passphrase prompt. It re-verifies
 *      via auth.signIn (the email comes from the live session); a correct
 *      passphrase lifts the curtain, identical to a biometric pass.
 *   3. If the device reports no biometric support at all, the passphrase
 *      field is shown straight away — no dead "try again" loop.
 *
 * Voice: lowercase, dry, calm — mirrors NotificationPrimer. English copy.
 *
 * // LOCALIZE_LATER — all copy is English; ES translations pending.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { VaultClient } from '@ollie/auth';
import { unlock as biometricUnlock, isBiometricSupported } from '../lib/biometric';

export interface AppLockGateProps {
  /** The encryption vault — used for the passphrase escape hatch. */
  vault: VaultClient | null;
  /** Called once the user has passed biometric OR passphrase. */
  onUnlocked: () => void;
  /**
   * Test seam. Substitutes the biometric call so unit tests don't touch
   * WebAuthn. Defaults to the real `unlock`.
   */
  unlockImpl?: typeof biometricUnlock;
}

type Phase =
  | 'idle'          // showing the biometric prompt CTA
  | 'prompting'     // biometric prompt in flight
  | 'passphrase'    // showing the passphrase escape hatch
  | 'verifying';    // passphrase check in flight

export function AppLockGate({
  vault,
  onUnlocked,
  unlockImpl,
}: AppLockGateProps): React.ReactElement {
  // If the device can't do biometrics, skip straight to the passphrase
  // path — no point offering a button that can only fail.
  const supported = isBiometricSupported();
  const [phase, setPhase] = useState<Phase>(supported ? 'idle' : 'passphrase');
  const [error, setError] = useState<string>('');
  const [passphrase, setPassphrase] = useState('');

  const runBiometric = useCallback(async () => {
    setError('');
    setPhase('prompting');
    try {
      const impl = unlockImpl ?? biometricUnlock;
      const result = await impl('en', 'app');
      if (result.ok) {
        onUnlocked();
        return;
      }
      if (result.reason === 'unsupported') {
        // Hardware/enrolment missing — fall through to passphrase rather
        // than leaving the user staring at a button that won't work.
        setPhase('passphrase');
        setError('biometrics unavailable on this device.');
        return;
      }
      if (result.reason === 'cancelled') {
        setError('cancelled. try again, or use your passphrase.');
      } else {
        setError('that didn’t work. try again, or use your passphrase.');
      }
      setPhase('idle');
    } catch {
      setError('that didn’t work. try again, or use your passphrase.');
      setPhase('idle');
    }
  }, [onUnlocked, unlockImpl]);

  // Auto-trigger the biometric prompt once on mount when the device
  // supports it — banking-app behaviour, the user expects Face ID to
  // fire without a tap. If it's cancelled they land on the manual CTA.
  useEffect(() => {
    if (supported) void runBiometric();
    // run-once: deliberately not depending on runBiometric identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyPassphrase = useCallback(async () => {
    if (!vault) {
      // Nothing to verify against — should not happen behind the gate,
      // but never trap the user: lift the curtain.
      onUnlocked();
      return;
    }
    if (passphrase.length === 0) return;
    setError('');
    setPhase('verifying');
    try {
      // The vault is already unlocked behind this gate; re-running unlock()
      // simply re-derives + re-verifies the key — a clean passphrase check.
      const r = await vault.unlock(passphrase);
      if (r.ok) {
        onUnlocked();
        return;
      }
      setError('that passphrase didn’t match. try again.');
      setPhase('passphrase');
    } catch {
      setError('couldn’t verify right now. try again.');
      setPhase('passphrase');
    }
  }, [vault, passphrase, onUnlocked]);

  const busy = phase === 'prompting' || phase === 'verifying';
  const showPassphrase = phase === 'passphrase' || phase === 'verifying';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-lock-title"
      aria-describedby="app-lock-body"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120, // above NotificationPrimer (80) — the curtain wins.
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'var(--bone)',
        animation: 'app-lock-veil 200ms var(--e-calm-out) both',
      }}
    >
      {/* component-scoped keyframes — no edit to the shared design CSS */}
      <style>{`
        @keyframes app-lock-veil { from { opacity: 0 } to { opacity: 1 } }
        @keyframes app-lock-rise {
          from { opacity: 0; transform: translateY(10px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>

      <div
        style={{
          width: 'min(92vw, 400px)',
          animation: 'app-lock-rise 280ms var(--e-calm-out) both',
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
          locked {/* LOCALIZE_LATER */}
        </p>

        {/* title */}
        <h2
          id="app-lock-title"
          style={{
            margin: '12px 0 0',
            fontFamily: 'var(--font-editor)',
            fontWeight: 400,
            fontSize: 28,
            lineHeight: 1.15,
            color: 'var(--ink)',
          }}
        >
          ollie is waiting for you {/* LOCALIZE_LATER */}
        </h2>

        {/* body */}
        <p
          id="app-lock-body"
          style={{
            margin: '16px 0 0',
            fontFamily: 'var(--font-system)',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink-soft)',
          }}
        >
          {/* LOCALIZE_LATER */}
          {showPassphrase
            ? 'enter your passphrase to pick up where you left off.'
            : 'unlock with your face or fingerprint to pick up where you left off.'}
        </p>

        {error && (
          <p
            role="alert"
            style={{
              margin: '14px 0 0',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-meta)',
              letterSpacing: 'var(--ls-caps-small)',
              textTransform: 'uppercase',
              color: 'var(--umber)',
            }}
          >
            {error}
          </p>
        )}

        {/* passphrase escape hatch */}
        {showPassphrase && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyPassphrase();
            }}
            noValidate
            style={{ marginTop: 20 }}
          >
            <label
              htmlFor="app-lock-passphrase"
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-meta)',
                letterSpacing: 'var(--ls-caps-small)',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
                marginBottom: 6,
              }}
            >
              passphrase {/* LOCALIZE_LATER */}
            </label>
            <input
              id="app-lock-passphrase"
              type="password"
              value={passphrase}
              autoComplete="current-password"
              autoFocus
              aria-label="passphrase"
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={busy}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-caption)',
                padding: '12px 0',
                width: '100%',
                border: 'none',
                borderBottom: '1px solid var(--rule)',
                background: 'transparent',
                color: 'var(--ink)',
                outline: 'none',
                letterSpacing: '0.02em',
                marginBottom: 20,
              }}
            />
          </form>
        )}

        {/* actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            marginTop: showPassphrase ? 4 : 26,
          }}
        >
          {showPassphrase ? (
            <button
              type="button"
              onClick={() => void verifyPassphrase()}
              disabled={busy || passphrase.length === 0}
              style={primaryBtnStyle(busy || passphrase.length === 0)}
            >
              {phase === 'verifying' ? 'unlocking...' : 'unlock'} {/* LOCALIZE_LATER */}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void runBiometric()}
              disabled={busy}
              style={primaryBtnStyle(busy)}
            >
              {phase === 'prompting' ? 'asking...' : 'try again'} {/* LOCALIZE_LATER */}
            </button>
          )}

          {/* the cross-path link — never the only way out, always offered */}
          {supported && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setPhase(showPassphrase ? 'idle' : 'passphrase');
              }}
              disabled={busy}
              style={ghostBtnStyle(busy)}
            >
              {showPassphrase ? 'use face or fingerprint' : 'use passphrase'} {/* LOCALIZE_LATER */}
            </button>
          )}
        </div>

        {/* footnote — honest framing, stated plainly */}
        <p
          style={{
            margin: '18px 0 0',
            fontFamily: 'var(--font-system)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--ink-faint)',
            textAlign: 'center',
          }}
        >
          {/* LOCALIZE_LATER */}
          you’re still signed in — this just keeps ollie private on your screen.
        </p>
      </div>
    </div>
  );
}

// ─── shared button styles ────────────────────────────────────────────────────

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box', // width:100% + h-padding overflowed the viewport (audit 2026-05-18)
    padding: '13px 20px',
    minHeight: 48,
    background: disabled ? 'transparent' : 'var(--ink)',
    color: disabled ? 'var(--ink-faint)' : 'var(--bone)',
    border: `1px solid ${disabled ? 'var(--rule)' : 'var(--ink)'}`,
    borderRadius: 24,
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-caption)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'opacity var(--d-tap) var(--e-calm-out)',
  };
}

function ghostBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box', // width:100% + h-padding overflowed the viewport (audit 2026-05-18)
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
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'opacity var(--d-tap) var(--e-calm-out)',
  };
}

export default AppLockGate;
