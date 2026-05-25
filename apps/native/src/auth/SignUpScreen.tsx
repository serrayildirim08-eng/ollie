/**
 * SignUpScreen — invite-gated account creation.
 *
 * Editorial flow: invite, email, passphrase, passphrase confirm. The
 * passphrase-is-unrecoverable acknowledgement is implicit at this stage
 * (AuthProvider sets `acknowledged_unrecoverable: true` after the user
 * has read the on-screen note here). A future sprint may move this into
 * an explicit checkbox once the legal copy is signed off.
 */

import { useState, type FormEvent } from 'react';
import { useAuth } from './useAuth';

interface SignUpScreenProps {
  onSwitchToSignIn?: () => void;
}

export function SignUpScreen({ onSwitchToSignIn }: SignUpScreenProps): JSX.Element {
  const { signUp } = useAuth();

  const [invite, setInvite] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [passphrase, setPassphrase] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const r = await signUp(email.trim(), passphrase, confirm, invite.trim());
      if (!r.ok) setError(messageForSignUpError(r.code, r.message));
    } catch (err) {
      setError((err as Error).message ?? 'sign-up failed');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    invite.trim() !== '' &&
    email.trim() !== '' &&
    passphrase !== '' &&
    confirm !== '' &&
    !submitting;

  return (
    <main style={pageStyle}>
      <section style={stackStyle}>
        <header style={headerStyle}>
          <h1 style={titleStyle}>Ollie</h1>
          <p style={subtitleStyle}>Create an account with your invite.</p>
        </header>

        <form onSubmit={onSubmit} style={formStyle} noValidate>
          <label style={fieldStyle}>
            <span style={labelStyle}>Invite code</span>
            <input
              type="text"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              style={inputStyle}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Passphrase</span>
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Confirm passphrase</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={inputStyle}
            />
          </label>

          <p style={noteStyle}>
            Your passphrase is what locks your data on this device. We
            cannot recover it for you.
          </p>

          {error !== null && <p style={errorStyle}>{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            style={primaryButtonStyle(!canSubmit)}
          >
            {submitting ? 'Creating account' : 'Create account'}
          </button>
        </form>

        {onSwitchToSignIn !== undefined && (
          <footer style={footerStyle}>
            <button type="button" onClick={onSwitchToSignIn} style={ghostLinkStyle}>
              I already have an account
            </button>
          </footer>
        )}
      </section>
    </main>
  );
}

function messageForSignUpError(code: string, fallback: string): string {
  switch (code) {
    case 'weak-passphrase':
      return 'Your passphrase is too short. Use at least 12 characters.';
    case 'mismatch':
      return 'The two passphrases do not match.';
    case 'no-consent':
      return 'That invite code is not recognised.';
    case 'network':
      return 'Network unavailable. Try again in a moment.';
    default:
      return fallback || 'Something went wrong. Please try again.';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// styles — inline mirror of SignInScreen for visual coherence. Will be
// replaced by ui/ primitives once those exist.
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

const noteStyle: React.CSSProperties = {
  fontSize: 'var(--ollie-size-caption)',
  color: 'var(--ollie-ink-mid)',
  lineHeight: 'var(--ollie-leading)',
  margin: 0,
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
