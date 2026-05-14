/**
 * AuthFlow — sign-up + sign-in surface for ollie (Sprint 5 · F2)
 *
 * One component, three modes:
 *   - fork      : first-launch picker — sign up OR log in
 *   - signup    : email + passphrase (+ strength meter) + confirm + ack checkbox
 *   - signin    : email + passphrase (pre-filled from localStorage)
 *   - forgot    : single explainer screen — passphrase is unrecoverable by design
 *
 * Voice: lowercase labels, sage active, DM Mono caps headers.
 * Pattern A (F1): passphrase NEVER leaves the device.
 *
 * Wired into App.tsx at the root: unauthenticated users hit AuthFlow
 * before HomeScreen.
 *
 * Consent rewrite (Sprint 6): AuthFlow now just hands off via
 * onAuthenticated() — App.tsx gates the post-auth flow on
 * shared.consent.necessary. Fresh sign-ups have it unset (false),
 * so they land on ConsentScreen before onboarding. Returning sign-in
 * users with consent.necessary === true skip straight through.
 */

import React, { useEffect, useRef, useState } from 'react';
import { passphraseStrength } from '@ollie/crypto';
import type { AuthClient } from '@ollie/auth';

type Mode = 'fork' | 'signup' | 'signin' | 'forgot';

export interface AuthFlowProps {
  auth: AuthClient;
  onAuthenticated: () => void;
}

const EMAIL_LS_KEY = 'auth.email_for_login';
// Store keys live at `void.state.<mod>.v<STORE_VERSION>` as a JSON blob
// holding the whole module's state — not flat per-key entries.
// See packages/store/src/store.ts:21.
const SHARED_LS_KEY = 'void.state.shared.v5';

function readPrefilledEmail(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const raw = localStorage.getItem(SHARED_LS_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const value = parsed && typeof parsed === 'object' ? parsed[EMAIL_LS_KEY] : null;
    return typeof value === 'string' ? value : '';
  } catch { return ''; }
}

// ─── shared atoms ────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bone)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-system)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '48px 32px',
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
  type,
  value,
  onChange,
  autoFocus,
  autoComplete,
  ariaLabel,
}: {
  id: string;
  type: 'email' | 'password' | 'text';
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      type={type}
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

function StrengthMeter({ passphrase }: { passphrase: string }) {
  const s = passphraseStrength(passphrase);
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

// ─── Fork screen ─────────────────────────────────────────────────────────────

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
        ollie sorts what's in your head and keeps it private. everything stays encrypted on
        your device — including from us.
      </Sub>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <PrimaryBtn label="create account" onClick={() => onChoose('signup')} />
        <GhostBtn label="log in" onClick={() => onChoose('signin')} />
      </div>
    </Shell>
  );
}

// ─── Sign-up screen ──────────────────────────────────────────────────────────

function SignUpScreen({
  auth,
  onAuthenticated,
  onBack,
}: {
  auth: AuthClient;
  onAuthenticated: () => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(readPrefilledEmail());
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const strength = passphraseStrength(pass);
  const passLongEnough = pass.length >= 16;
  const passMatches = pass.length > 0 && pass === confirm;
  const canSubmit = !!email && passLongEnough && passMatches && ack && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await auth.signUp({
        email: email.trim(),
        passphrase: pass,
        passphraseConfirm: confirm,
        acknowledged_unrecoverable: ack,
      });
      if (r.ok) {
        onAuthenticated();
      } else {
        setError(r.message || 'sign-up failed');
      }
    } catch (e) {
      setError((e as Error).message || 'something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <CapHeader>create account</CapHeader>
      <Headline>your data, your key.</Headline>
      <Sub>
        the passphrase below encrypts everything ollie ever holds for you. we never see it.
        we can't reset it. write it down.
      </Sub>

      <form
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        noValidate
      >
        <Label htmlFor="email">email</Label>
        <Field
          id="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          ariaLabel="email"
        />

        <Label htmlFor="passphrase">passphrase</Label>
        <Field
          id="passphrase"
          type="password"
          value={pass}
          onChange={setPass}
          autoComplete="new-password"
          ariaLabel="passphrase"
        />
        <StrengthMeter passphrase={pass} />

        <Label htmlFor="confirm">confirm passphrase</Label>
        <Field
          id="confirm"
          type="password"
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
          }}>passphrases don't match</p>
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

        <PrimaryBtn label={submitting ? 'creating…' : 'create account'} type="submit" disabled={!canSubmit} />

        <div style={{ marginTop: '16px' }}>
          <GhostBtn label="back" onClick={onBack} />
        </div>
      </form>
    </Shell>
  );
}

// ─── Sign-in screen ──────────────────────────────────────────────────────────

function SignInScreen({
  auth,
  onAuthenticated,
  onBack,
  onForgot,
}: {
  auth: AuthClient;
  onAuthenticated: () => void;
  onBack: () => void;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState(readPrefilledEmail());
  const [pass, setPass] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = !!email && pass.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await auth.signIn({ email: email.trim(), passphrase: pass });
      if (r.ok) {
        onAuthenticated();
      } else {
        setError(r.message || 'sign-in failed');
      }
    } catch (e) {
      setError((e as Error).message || 'something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <CapHeader>log in</CapHeader>
      <Headline>welcome back.</Headline>
      <Sub>
        your data unlocks locally with your passphrase.
      </Sub>

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Label htmlFor="email">email</Label>
        <Field
          id="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          autoFocus={!email}
          ariaLabel="email"
        />

        <Label htmlFor="passphrase">passphrase</Label>
        <Field
          id="passphrase"
          type="password"
          value={pass}
          onChange={setPass}
          autoComplete="current-password"
          autoFocus={!!email}
          ariaLabel="passphrase"
        />

        <button
          type="button"
          onClick={onForgot}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--ink-faint)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-meta)',
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: '0 0 24px',
            display: 'block',
          }}
        >
          forgot passphrase?
        </button>

        <ErrorLine message={error} />

        <PrimaryBtn label={submitting ? 'logging in…' : 'log in'} type="submit" disabled={!canSubmit} />

        <div style={{ marginTop: '16px' }}>
          <GhostBtn label="back" onClick={onBack} />
        </div>
      </form>
    </Shell>
  );
}

// ─── Forgot explainer ────────────────────────────────────────────────────────

function ForgotScreen({ onBack }: { onBack: () => void }) {
  return (
    <Shell>
      <CapHeader>passphrase recovery</CapHeader>
      <Headline>there isn't one.</Headline>
      <Sub>
        your passphrase is unrecoverable by design. it never reaches our servers — only the
        derived encryption key, only in your browser's memory.
      </Sub>
      <Sub>
        if you've truly lost it, you'd need to start fresh: create a new account. previous
        data stays encrypted but unreadable without the original passphrase.
      </Sub>
      <GhostBtn label="back to log in" onClick={onBack} />
    </Shell>
  );
}

// ─── Root component ──────────────────────────────────────────────────────────

export function AuthFlow({ auth, onAuthenticated }: AuthFlowProps) {
  const [mode, setMode] = useState<Mode>(() => {
    // Returning users with a stored email default to log-in. Fresh
    // installs see the fork screen.
    return readPrefilledEmail() ? 'signin' : 'fork';
  });

  switch (mode) {
    case 'signup':
      return <SignUpScreen auth={auth} onAuthenticated={onAuthenticated} onBack={() => setMode('fork')} />;
    case 'signin':
      return (
        <SignInScreen
          auth={auth}
          onAuthenticated={onAuthenticated}
          onBack={() => setMode('fork')}
          onForgot={() => setMode('forgot')}
        />
      );
    case 'forgot':
      return <ForgotScreen onBack={() => setMode('signin')} />;
    case 'fork':
    default:
      return <ForkScreen onChoose={setMode} />;
  }
}
