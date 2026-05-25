/**
 * SignInScreen — editorial sign-in.
 *
 * One field (passphrase), one button. Email is pre-filled from the
 * device cache and shown read-only with a "switch account" affordance.
 * No "welcome back" copy. No progress bars. Generous whitespace.
 */

import { useState, type FormEvent } from 'react';
import { useAuth } from './useAuth';

interface SignInScreenProps {
  /** Called after successful sign-up navigation cue. */
  onSwitchToSignUp?: () => void;
}

export function SignInScreen({ onSwitchToSignUp }: SignInScreenProps): JSX.Element {
  const { cachedEmail, signIn } = useAuth();

  const [email, setEmail] = useState<string>(cachedEmail ?? '');
  const [passphrase, setPassphrase] = useState<string>('');
  const [editingEmail, setEditingEmail] = useState<boolean>(cachedEmail === null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const r = await signIn(email.trim(), passphrase);
      if (!r.ok) setError(messageForSignInError(r.code, r.message));
    } catch (err) {
      setError((err as Error).message ?? 'sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={pageStyle}>
      <section style={stackStyle}>
        <header style={headerStyle}>
          <h1 style={titleStyle}>Ollie</h1>
          <p style={subtitleStyle}>Sign in to continue.</p>
        </header>

        <form onSubmit={onSubmit} style={formStyle} noValidate>
          {editingEmail ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>Email</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                autoFocus
              />
            </label>
          ) : (
            <div style={fieldStyle}>
              <span style={labelStyle}>Email</span>
              <div style={readOnlyEmailStyle}>
                <span>{email}</span>
                <button
                  type="button"
                  onClick={() => setEditingEmail(true)}
                  style={ghostLinkStyle}
                >
                  switch
                </button>
              </div>
            </div>
          )}

          <label style={fieldStyle}>
            <span style={labelStyle}>Passphrase</span>
            <input
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              style={inputStyle}
              autoFocus={!editingEmail}
            />
          </label>

          {error !== null && <p style={errorStyle}>{error}</p>}

          <button
            type="submit"
            disabled={submitting || email.trim() === '' || passphrase === ''}
            style={primaryButtonStyle(submitting)}
          >
            {submitting ? 'Signing in' : 'Continue'}
          </button>
        </form>

        {onSwitchToSignUp !== undefined && (
          <footer style={footerStyle}>
            <button type="button" onClick={onSwitchToSignUp} style={ghostLinkStyle}>
              I have an invite code
            </button>
          </footer>
        )}
      </section>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// copy
// ──────────────────────────────────────────────────────────────────────────

function messageForSignInError(code: string, fallback: string): string {
  switch (code) {
    case 'wrong-passphrase':
      return 'That passphrase does not match.';
    case 'wrong-email':
      return 'No account on this device for that email.';
    case 'missing-salt':
    case 'no-device-data':
      return 'This device has no sign-in data yet. Import a backup from your original device.';
    case 'network':
      return 'Network unavailable. Try again in a moment.';
    default:
      return fallback || 'Something went wrong. Please try again.';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// styles — inline so the file is self-contained while ui/ primitives are
// still being built. All values reference theme tokens.
// ──────────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--ollie-cream)',
  padding: 'var(--ollie-space-xl)',
  color: 'var(--ollie-ink-dark)',
};

const stackStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--ollie-space-xl)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--ollie-space-sm)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 'var(--ollie-size-title)',
  fontWeight: 'var(--ollie-weight-light)',
  letterSpacing: 'var(--ollie-tracking)',
  lineHeight: 'var(--ollie-leading-tight)',
  margin: 0,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 'var(--ollie-size-body)',
  color: 'var(--ollie-ink-mid)',
  lineHeight: 'var(--ollie-leading)',
  margin: 0,
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--ollie-space-lg)',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--ollie-space-xs)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--ollie-size-caption)',
  letterSpacing: 'var(--ollie-tracking-wide)',
  textTransform: 'uppercase',
  color: 'var(--ollie-ink-light)',
};

const inputStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--ollie-ceramic-dim)',
  padding: 'var(--ollie-space-sm) 0',
  fontSize: 'var(--ollie-size-body)',
  color: 'var(--ollie-ink-dark)',
  outline: 'none',
  fontFamily: 'inherit',
};

const readOnlyEmailStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--ollie-space-sm) 0',
  borderBottom: '1px solid var(--ollie-ceramic-dim)',
  fontSize: 'var(--ollie-size-body)',
  color: 'var(--ollie-ink-dark)',
};

const errorStyle: React.CSSProperties = {
  fontSize: 'var(--ollie-size-caption)',
  color: 'var(--ollie-error-text)',
  margin: 0,
  lineHeight: 'var(--ollie-leading)',
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    background: disabled ? 'var(--ollie-ceramic-dim)' : 'var(--ollie-sage)',
    color: 'var(--ollie-cream)',
    padding: 'var(--ollie-space-md) var(--ollie-space-lg)',
    fontSize: 'var(--ollie-size-body)',
    letterSpacing: 'var(--ollie-tracking)',
    borderRadius: 'var(--ollie-radius-md)',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'background var(--ollie-duration-base) var(--ollie-easing-standard)',
    fontFamily: 'inherit',
    marginTop: 'var(--ollie-space-sm)',
  };
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
};

const ghostLinkStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: 'none',
  color: 'var(--ollie-ink-light)',
  fontSize: 'var(--ollie-size-caption)',
  letterSpacing: 'var(--ollie-tracking-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
};
