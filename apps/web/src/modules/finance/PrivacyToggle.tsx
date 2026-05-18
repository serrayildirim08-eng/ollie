/**
 * PrivacyToggle — header eye/eye-off control for the Money module.
 *
 * Toggling ON masks every $ figure in the module (bills, subs, savings goals,
 * adhd-tax, transaction history, hero captions, charts) with monospace block
 * glyphs (▮▮▮). Toggling OFF triggers a biometric unlock; once unlocked, the
 * mask drops for a 5-minute window before re-locking automatically.
 *
 * Persistence:
 *   - `finance.privacy.enabled`        — survives reload
 *   - `finance.privacy.unlockedUntil`  — session-scoped epoch ms
 *
 * Both live in the finance store slice; this component owns the toggle UI,
 * the unlock flow + the public `maskMoney()` helper used module-wide.
 */

import { useCallback, useEffect, useState } from 'react';
import { unlock as biometricUnlock, isBiometricSupported } from '../../lib/biometric';
import { useStoreSlice } from '../../store';

// Window of unmasked viewing after a successful unlock. 5 min · short enough
// to matter, long enough that the user isn't prompted between rows.
export const UNLOCK_WINDOW_MS = 5 * 60 * 1000;

// Single canonical mask glyph string. Monospace block ensures stable width.
export const MASK_GLYPH = '▮▮▮';

// ─── palette (mirrors FinanceModule "T") ───────────────────────────────────

const T = {
  text:    'rgba(255,255,255,0.88)',
  muted:   'rgba(255,255,255,0.48)',
  faint:   'rgba(255,255,255,0.28)',
  border:  'rgba(255,255,255,0.08)',
  accent:  '#C8A26A',
} as const;

// ─── icons (inline SVG, 1.25px hairline, no deps) ─────────────────────────

function EyeIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.93 10.93 0 0112 20c-7 0-11-8-11-8a19.79 19.79 0 015.06-5.94" />
      <path d="M9.9 4.24A10.93 10.93 0 0112 4c7 0 11 8 11 8a19.86 19.86 0 01-3.17 4.19" />
      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ─── public mask helper ────────────────────────────────────────────────────

/**
 * Returns the mask glyph when `masked` is true, otherwise the value rendered
 * via the caller's formatter. Pure — safe to call from useMemo bodies.
 */
export function maskMoney(masked: boolean, formatted: string): string {
  return masked ? MASK_GLYPH : formatted;
}

// ─── hook: derive "is module currently masked?" from store values ─────────

export interface PrivacyState {
  enabled: boolean;
  unlockedUntil: number;
}

export function isMaskedNow(state: PrivacyState | null | undefined, now: number): boolean {
  if (!state?.enabled) return false;
  return !state.unlockedUntil || state.unlockedUntil <= now;
}

// ─── component ─────────────────────────────────────────────────────────────

interface Props {
  state: PrivacyState;
  onChange: (next: PrivacyState) => void;
  /** caller-supplied toast surface (re-uses FinanceModule's existing toast) */
  onToast?: (msg: string) => void;
  /** for tests · skip the WebAuthn call and resolve immediately */
  unlockImpl?: typeof biometricUnlock;
}

export function PrivacyToggle({ state, onChange, onToast, unlockImpl }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const [sharedSettings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const locale = sharedSettings?.locale === 'es' ? 'es' as const : 'en' as const;

  // re-render once per minute so the auto-relock UI updates without a full
  // module re-render.
  useEffect(() => {
    if (!state.enabled || !state.unlockedUntil || state.unlockedUntil <= now) return;
    const remaining = state.unlockedUntil - now;
    const id = window.setTimeout(() => setNow(Date.now()), Math.min(remaining + 50, 60_000));
    return () => window.clearTimeout(id);
  }, [state, now]);

  const masked = isMaskedNow(state, now);

  const enable = useCallback(() => {
    // Turning ON is silent — no biometric needed to lock down.
    onChange({ enabled: true, unlockedUntil: 0 });
  }, [onChange]);

  const requestUnlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const impl = unlockImpl ?? biometricUnlock;
      const result = await impl(locale);
      if (result.ok) {
        // While the module is unlocked we keep `enabled: true` so the next
        // 5-minute window expiry re-applies the mask without a re-toggle.
        onChange({ enabled: true, unlockedUntil: Date.now() + UNLOCK_WINDOW_MS });
        return;
      }
      if (result.reason === 'unsupported') {
        // Disable privacy mode entirely — biometric is not available on this
        // device. Quiet inline message, no modal.
        onChange({ enabled: false, unlockedUntil: 0 });
        onToast?.('biometric unavailable. privacy mode off.');
        return;
      }
      if (result.reason === 'cancelled') {
        onToast?.('unlock cancelled.');
        return;
      }
      onToast?.('unlock failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, onChange, onToast, unlockImpl, locale]);

  const onClick = useCallback(() => {
    if (!state.enabled) {
      enable();
      return;
    }
    if (masked) {
      void requestUnlock();
      return;
    }
    // currently unlocked → re-mask immediately
    onChange({ enabled: true, unlockedUntil: 0 });
  }, [state.enabled, masked, enable, requestUnlock, onChange]);

  const supported = isBiometricSupported();
  const ariaLabel =
    !state.enabled ? 'enable privacy mode' :
    masked        ? 'unlock money figures' :
                    'lock money figures';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={state.enabled}
      title={!supported && !state.enabled ? 'biometric not supported on this device' : undefined}
      disabled={busy}
      style={{
        background: 'transparent',
        border: `1px solid ${state.enabled ? T.accent : T.border}`,
        borderRadius: 20,
        padding: '5px 10px',
        fontFamily: "'DM Mono', monospace",
        fontSize: 9,
        letterSpacing: '0.14em',
        color: state.enabled ? T.accent : T.muted,
        cursor: busy ? 'wait' : 'pointer',
        textTransform: 'uppercase' as const,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        lineHeight: 1,
      }}
    >
      {masked ? <EyeOffIcon /> : <EyeIcon />}
      <span>{masked ? 'locked' : state.enabled ? 'on' : 'private'}</span>
    </button>
  );
}
