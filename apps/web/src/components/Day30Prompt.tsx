/**
 * Day30Prompt — quiet one-month card (Task: d30 retention prompt)
 *
 * Listens for `void:retention:d30_returned`. When it fires, surfaces a
 * non-blocking, dismissible card. No streak copy, no rating beg, no guilt.
 *
 * Two soft actions:
 *   - share ollie  → navigator.share() with fallback copy-link
 *   - tell us what's missing → mailto to support
 *
 * Fires exactly once — d30Fired is persisted by retention.ts, so the
 * event itself is the gate. Dismiss also writes a localStorage key so
 * the card doesn't reappear across hot-reloads while d30Fired is in
 * an ephemeral test store.
 *
 * // LOCALIZE_LATER — all copy is English; ES translations pending.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as events from '@ollie/events';

const DISMISS_KEY = 'ollie:d30_prompt:dismissed';
const SHARE_URL = 'https://ollie.app';
const FEEDBACK_HREF =
  'mailto:support@ollie.app?subject=feedback%20%E2%80%94%20a%20month%20in';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

async function handleShare(): Promise<void> {
  const data: ShareData = {
    title: 'ollie',
    text: "an app I\u2019ve been using — worth a look.",
    url: SHARE_URL,
  };
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share(data);
    } catch {
      /* user cancelled or share unavailable — fall through to copy */
      await copyLink();
    }
  } else {
    await copyLink();
  }
}

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(SHARE_URL);
  } catch {
    /* clipboard blocked — silent */
  }
}

export function Day30Prompt(): React.ReactElement | null {
  const [visible, setVisible] = useState<boolean>(false);
  const crisisActiveRef = useRef<boolean>(false);

  useEffect(() => {
    const offCrisis = events.on('void:crisis:detected', () => {
      crisisActiveRef.current = true;
    });

    const offD30 = events.on('void:retention:d30_returned', () => {
      if (crisisActiveRef.current) return;
      if (readDismissed()) return;
      setVisible(true);
    });

    return () => {
      try { offCrisis(); } catch { /* noop */ }
      try { offD30(); } catch { /* noop */ }
    };
  }, []);

  function dismiss(): void {
    writeDismissed();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="a month in"
      style={{
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 70,
        width: 'min(92vw, 360px)',
        // content-box: width + 36px h-padding pushed past the viewport
        // edge on sub-400px iPhones. Audit 2026-05-18.
        boxSizing: 'border-box',
        pointerEvents: 'auto',
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.30)',
        borderLeft: '2px solid var(--accent)',
        borderRadius: 16,
        padding: '16px 18px',
        animation: 'fadeUp 320ms var(--e-calm-out) both',
      }}
    >
      {/* dismiss */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="dismiss"
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          background: 'none',
          border: 'none',
          color: 'var(--ink-faint)',
          fontFamily: "'DM Mono', monospace",
          fontSize: 16,
          lineHeight: 1,
          padding: '2px 4px',
          cursor: 'pointer',
        }}
      >
        ×
      </button>

      {/* kicker */}
      <p
        style={{
          margin: 0,
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase',
          color: 'var(--accent)',
        }}
      >
        a month in {/* LOCALIZE_LATER */}
      </p>

      {/* body */}
      <p
        style={{
          margin: '8px 0 14px',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--ink-soft)',
          maxWidth: '38ch',
        }}
      >
        {/* LOCALIZE_LATER */}
        if ollie's been useful, telling a friend helps more than a review.
        if it hasn't — tell us what's missing.
      </p>

      {/* actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={() => { void handleShare(); }}
          aria-label="share ollie"
          style={{
            flex: 1,
            padding: '7px 12px',
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 8,
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          share ollie {/* LOCALIZE_LATER */}
        </button>

        <a
          href={FEEDBACK_HREF}
          aria-label="tell us what's missing"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '7px 12px',
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 8,
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          what's missing {/* LOCALIZE_LATER */}
        </a>
      </div>
    </div>
  );
}

export default Day30Prompt;
