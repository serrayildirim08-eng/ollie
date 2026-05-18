/**
 * apps/web · dev-mode banner
 *
 * Extracted verbatim from App.tsx during the react-router migration
 * (2026-05-18). Surfaces a tiny sage banner when `VITE_SUPABASE_URL` is
 * unset so a missing-env build is never confused with a real
 * authenticated session. Dismissible per-session via sessionStorage.
 */
import React from 'react';

const DEV_BANNER_DISMISS_KEY = 'ollie:dev-mode-banner:dismissed';

export function DevModeBanner() {
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DEV_BANNER_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (dismissed) return null;

  const onDismiss = () => {
    try {
      sessionStorage.setItem(DEV_BANNER_DISMISS_KEY, '1');
    } catch {
      /* non-fatal */
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-label="dev mode banner"
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 10000,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        background: 'rgba(123, 154, 134, 0.14)',
        color: '#5e7d6c',
        border: '1px solid rgba(123, 154, 134, 0.32)',
        borderRadius: 4,
        fontFamily: "'DM Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'lowercase',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <span>dev mode · no auth</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="dismiss dev mode banner"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          letterSpacing: 'inherit',
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
