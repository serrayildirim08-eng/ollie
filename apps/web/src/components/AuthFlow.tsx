/**
 * AuthFlow — sign-in surface for ollie (Clerk migration · Phase 1 2026-05-19)
 *
 * Two layers, in order:
 *   1. IDENTITY — Clerk. `<SignIn>` / `<SignUp>` prebuilt components handle
 *      email + password + verification. Clerk owns "who is signed in".
 *   2. ENCRYPTION — the passphrase vault (@ollie/auth). After Clerk sign-in
 *      the user sets (first time) or enters (returning) a passphrase that
 *      derives the local AES key. The passphrase NEVER leaves the device
 *      and is unrelated to the Clerk password.
 *
 * Only when BOTH pass does `onAuthenticated()` fire — GatedLayout's Gate 1.
 *
 * Voice: lowercase labels, sage active, DM Mono caps headers.
 */

import React, { useEffect, useState } from 'react';
import { useAuth, SignIn, SignUp } from '@clerk/react';
import { passphraseStrength, CRYPTO_PARAMS } from '@ollie/crypto';
import type { PassphraseStrength } from '@ollie/crypto';
import type { VaultClient } from '@ollie/auth';

export interface AuthFlowProps {
  /** The passphrase-derived encryption vault. */
  vault: VaultClient;
  /** Fired once Clerk sign-in AND vault unlock have both completed. */
  onAuthenticated: () => void;
}

// ─── shared atoms ────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        // No global box-sizing reset (see tokens.css) — opt into border-box
        // here so the h-padding doesn't overflow the viewport.
        boxSizing: 'border-box',
        minHeight: '100dvh',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
        background: 'var(--bone)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-system)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding:
          'calc(48px + env(safe-area-inset-top)) calc(32px + env(safe-area-inset-right)) ' +
          'calc(48px + env(safe-area-inset-bottom)) calc(32px + env(safe-area-inset-left))',
      }}
    >
      <div style={{ maxWidth: '420px', width: '100%', margin: '0 auto' }}>
        {children}
      </div>
    </main>
  );
}

function CapHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-kicker)',
        letterSpacing: 'var(--ls-caps)',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        marginBottom: '24px',
      }}
    >
      {children}
    </div>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: 'var(--font-editor)',
        fontSize: 'var(--t-h1)',
        fontWeight: 400,
        lineHeight: 'var(--lh-headline)',
        letterSpacing: 'var(--ls-h1)',
        color: 'var(--ink)',
        margin: '0 0 16px',
      }}
    >
      {children}
    </h1>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-system)',
        fontSize: 'var(--t-body)',
        color: 'var(--ink-soft)',
        margin: '0 0 32px',
        lineHeight: 'var(--lh-body)',
      }}
    >
      {children}
    </p>
  );
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-meta)',
        letterSpacing: 'var(--ls-caps-small)',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        marginBottom: '6px',
      }}
    >
      {children}
    </label>
  );
}

function Field({
  id,
  value,
  onChange,
  autoFocus,
  autoComplete,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      type="password"
      value={value}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-caption)',
        padding: '12px 0',
        width: '100%',
        boxSizing: 'border-box',
        border: 'none',
        borderBottom: '1px solid var(--rule)',
        background: 'transparent',
        color: 'var(--ink)',
        outline: 'none',
        letterSpacing: '0.02em',
        marginBottom: '20px',
      }}
    />
  );
}

function PrimaryBtn({
  label,
  onClick,
  disabled,
  type: btnType = 'button',
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={btnType}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '14px 32px',
        minHeight: '48px',
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${disabled ? 'var(--rule)' : 'var(--ink)'}`,
        borderRadius: '24px',
        background: disabled ? 'transparent' : 'var(--ink)',
        color: disabled ? 'var(--ink-faint)' : 'var(--bone)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-caption)',
        letterSpacing: 'var(--ls-caps)',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'opacity 200ms ease',
      }}
    >
      {label}
    </button>
  );
}

function GhostBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '14px 32px',
        minHeight: '48px',
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid var(--rule)',
        borderRadius: '24px',
        background: 'transparent',
        color: 'var(--ink)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-caption)',
        letterSpacing: 'var(--ls-caps)',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function TextLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: 'var(--ink-faint)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-meta)',
        letterSpacing: 'var(--ls-caps-small)',
        textTransform: 'uppercase',
        cursor: 'pointer',
        padding: '8px 0',
        display: 'block',
        margin: '16px auto 0',
      }}
    >
      {label}
    </button>
  );
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-caption)',
        color: 'var(--umber)',
        margin: '0 0 16px',
      }}
    >
      {message}
    </p>
  );
}

// Empty-passphrase placeholder so the meter renders before the (lazy,
// async) zxcvbn estimate resolves.
const EMPTY_STRENGTH: PassphraseStrength = { score: 0, band: 'weak', notes: [] };

function StrengthMeter({ passphrase }: { passphrase: string }) {
  const [s, setS] = useState<PassphraseStrength>(EMPTY_STRENGTH);
  useEffect(() => {
    if (!passphrase) {
      setS(EMPTY_STRENGTH);
      return;
    }
    let live = true;
    void passphraseStrength(passphrase).then((result) => {
      if (live) setS(result);
    });
    return () => { live = false; };
  }, [passphrase]);

  const barColor =
    s.band === 'great' ? 'var(--accent)'
      : s.band === 'strong' ? 'var(--accent)'
      : s.band === 'ok' ? 'var(--warn)'
      : 'var(--ink-ghost)';
  const fillPct = Math.max(4, s.score);
  return (
    <div style={{ marginBottom: '20px' }}>
      <div
        aria-hidden="true"
        style={{
          height: '2px',
          width: '100%',
          background: 'var(--rule)',
          borderRadius: '2px',
          overflow: 'hidden',
          marginBottom: '6px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${fillPct}%`,
            background: barColor,
            transition: 'width 200ms ease',
          }}
        />
      </div>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-meta)',
          letterSpacing: 'var(--ls-caps-small)',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          margin: 0,
        }}
      >
        {passphrase ? s.band : 'enter a passphrase'}
      </p>
      {s.notes.length > 0 && (
        <ul
          style={{
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-caption)',
            color: 'var(--ink-soft)',
            margin: '8px 0 0',
            paddingLeft: '16px',
            lineHeight: 'var(--lh-caption)',
          }}
        >
          {s.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

// ─── Clerk identity layer ────────────────────────────────────────────────────

function ForkScreen({
  onChoose,
}: {
  onChoose: (m: 'signup' | 'signin') => void;
}) {
  return (
    <Shell>
      <CapHeader>ollie</CapHeader>
      <Headline>welcome.</Headline>
      <Sub>
        ollie sorts what&apos;s in your head. sign in, then set a passphrase that
        encrypts your data on this device.
      </Sub>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <PrimaryBtn label="create account" onClick={() => onChoose('signup')} />
        <GhostBtn label="log in" onClick={() => onChoose('signin')} />
      </div>
    </Shell>
  );
}

/**
 * Clerk sign-in / sign-up. The prebuilt `<SignIn>` / `<SignUp>` components
 * own the whole email + password + verification flow. `routing="virtual"`
 * keeps them self-contained — no URL routing — which suits the hash-routed
 * Capacitor shell. On success Clerk flips `useAuth().isSignedIn`, which
 * re-renders AuthFlow into the passphrase stage.
 */
function ClerkAuthScreen() {
  const [mode, setMode] = useState<'fork' | 'signup' | 'signin'>('fork');

  if (mode === 'fork') {
    return <ForkScreen onChoose={setMode} />;
  }

  return (
    <Shell>
      <CapHeader>{mode === 'signup' ? 'create account' : 'log in'}</CapHeader>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {mode === 'signup' ? (
          <SignUp forceRedirectUrl="/" />
        ) : (
          <SignIn forceRedirectUrl="/" />
        )}
      </div>
      <div style={{ marginTop: '20px' }}>
        <GhostBtn label="back" onClick={() => setMode('fork')} />
      </div>
    </Shell>
  );
}

// ─── encryption-vault layer ──────────────────────────────────────────────────

/** First-time passphrase setup → vault.create(). */
function SetPassphraseScreen({
  vault,
  onDone,
  onSignOut,
}: {
  vault: VaultClient;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const passLongEnough = pass.length >= CRYPTO_PARAMS.MIN_PASSPHRASE_LENGTH;
  const passMatches = pass.length > 0 && pass === confirm;
  const canSubmit = passLongEnough && passMatches && ack && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await vault.create(pass);
      if (!r.ok) {
        setError(r.message || 'could not set passphrase');
        setSubmitting(false);
        return;
      }
    } catch (e) {
      setError((e as Error).message || 'something went wrong');
      setSubmitting(false);
      return;
    }
    onDone();
  }

  return (
    <Shell>
      <CapHeader>set your passphrase</CapHeader>
      <Headline>one passphrase. yours only.</Headline>
      <Sub>
        this passphrase encrypts your data on this device — separate from your
        login. we can&apos;t reset it. write it down.
      </Sub>

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Label htmlFor="passphrase">passphrase</Label>
        <Field
          id="passphrase"
          value={pass}
          onChange={setPass}
          autoComplete="new-password"
          autoFocus
          ariaLabel="passphrase"
        />
        <StrengthMeter passphrase={pass} />

        <Label htmlFor="confirm">confirm passphrase</Label>
        <Field
          id="confirm"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          ariaLabel="confirm passphrase"
        />
        {confirm.length > 0 && !passMatches && (
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-meta)',
            color: 'var(--umber)',
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            margin: '-12px 0 16px',
          }}>passphrases don&apos;t match</p>
        )}

        <label
          style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
            marginBottom: '24px',
            cursor: 'pointer',
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-caption)',
            color: 'var(--ink-soft)',
            lineHeight: 'var(--lh-caption)',
          }}
        >
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            aria-label="acknowledge passphrase is unrecoverable"
            style={{ marginTop: '3px', accentColor: 'var(--accent)' }}
          />
          <span>
            i understand if i lose this passphrase i lose my data. there is no reset.
          </span>
        </label>

        <ErrorLine message={error} />

        <PrimaryBtn
          label={submitting ? 'setting…' : 'set passphrase'}
          type="submit"
          disabled={!canSubmit}
        />
      </form>
      <TextLink label="not you? sign out" onClick={onSignOut} />
    </Shell>
  );
}

/** Returning user → vault.unlock(). */
function UnlockScreen({
  vault,
  onDone,
  onSignOut,
}: {
  vault: VaultClient;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [pass, setPass] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = pass.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await vault.unlock(pass);
      if (r.ok) {
        onDone();
        return;
      }
      setError(
        r.code === 'wrong-passphrase'
          ? 'wrong passphrase'
          : r.message || 'could not unlock',
      );
    } catch (e) {
      setError((e as Error).message || 'something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <CapHeader>unlock</CapHeader>
      <Headline>welcome back.</Headline>
      <Sub>enter your passphrase to unlock your data on this device.</Sub>

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Label htmlFor="passphrase">passphrase</Label>
        <Field
          id="passphrase"
          value={pass}
          onChange={setPass}
          autoComplete="current-password"
          autoFocus
          ariaLabel="passphrase"
        />

        <ErrorLine message={error} />

        <PrimaryBtn
          label={submitting ? 'unlocking…' : 'unlock'}
          type="submit"
          disabled={!canSubmit}
        />
      </form>
      <TextLink label="not you? sign out" onClick={onSignOut} />
    </Shell>
  );
}

/**
 * The encryption stage — shown once Clerk reports the user signed in.
 * Picks set-passphrase (first time on this device) vs unlock (a vault
 * already exists). If the vault is somehow already unlocked, hand off
 * immediately.
 */
function PassphraseGate({
  vault,
  onUnlocked,
  onSignOut,
}: {
  vault: VaultClient;
  onUnlocked: () => void;
  onSignOut: () => void;
}) {
  const exists = vault.state().exists;

  useEffect(() => {
    if (vault.state().unlocked) onUnlocked();
    // run-once: a mid-session unlock state is what we're guarding for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return exists ? (
    <UnlockScreen vault={vault} onDone={onUnlocked} onSignOut={onSignOut} />
  ) : (
    <SetPassphraseScreen vault={vault} onDone={onUnlocked} onSignOut={onSignOut} />
  );
}

// ─── root ────────────────────────────────────────────────────────────────────

function LoadingShell() {
  return (
    <Shell>
      <CapHeader>ollie</CapHeader>
    </Shell>
  );
}

export function AuthFlow({ vault, onAuthenticated }: AuthFlowProps) {
  const { isLoaded, isSignedIn, signOut } = useAuth();

  if (!isLoaded) return <LoadingShell />;
  if (!isSignedIn) return <ClerkAuthScreen />;

  return (
    <PassphraseGate
      vault={vault}
      onUnlocked={onAuthenticated}
      onSignOut={() => { void signOut(); }}
    />
  );
}
