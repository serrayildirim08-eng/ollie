/**
 * ErrorFallback — minimal calm fallback for Sentry's ErrorBoundary.
 *
 * Voice: ollie is dry, lowercase, never SaaS-cheerful. No "Oh no!",
 * no "Something went wrong!!!", no emoji. Bone background, ink text,
 * sage accent on the reload link — pulls from design/tokens.css.
 *
 * Copy is English by product rule (see project_ollie_ui_english).
 */

import React from 'react';

interface Props {
  error?: unknown;
  resetError?: () => void;
}

export function ErrorFallback({ resetError }: Props): React.ReactElement {
  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        boxSizing: 'border-box',
        minHeight: '100dvh',
        background: 'var(--bone)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-system)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding:
          'calc(2rem + env(safe-area-inset-top)) calc(2rem + env(safe-area-inset-right)) ' +
          'calc(2rem + env(safe-area-inset-bottom)) calc(2rem + env(safe-area-inset-left))',
        textAlign: 'left',
        gap: '1.25rem',
      }}
    >
      <div style={{ maxWidth: '32ch' }}>
        <h1
          style={{
            fontFamily: 'var(--font-editor)',
            fontWeight: 400,
            fontSize: '1.75rem',
            margin: 0,
            color: 'var(--ink)',
            letterSpacing: '-0.01em',
          }}
        >
          something snagged.
        </h1>
        <p
          style={{
            marginTop: '0.75rem',
            color: 'var(--ink-soft)',
            fontSize: '1rem',
            lineHeight: 1.5,
          }}
        >
          ollie hit a hiccup on this surface. your data is local and safe.
          reload to keep going.
        </p>
        <button
          type="button"
          onClick={() => {
            if (resetError) resetError();
            else window.location.reload();
          }}
          style={{
            marginTop: '1.25rem',
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'var(--accent)',
            fontFamily: 'var(--font-system)',
            fontSize: '1rem',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '4px',
          }}
        >
          reload
        </button>
      </div>
    </div>
  );
}
