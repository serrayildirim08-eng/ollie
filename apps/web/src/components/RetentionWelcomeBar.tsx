/**
 * RetentionWelcomeBar — D1/D7/D30 welcome-back marker (Task 20)
 *
 * Subscribes to the local `void:retention:d{1,7,30}_returned` events
 * emitted by `lib/retention.ts:trackSession()` and renders a single
 * frosted toast-bar acknowledging the user came back. Dry editorial
 * voice — no streak, no shame, no exclamation.
 *
 * Surface rules:
 *   - one bar at a time. Newest milestone wins.
 *   - dismissible (×) → localStorage flag, never rendered again per-milestone.
 *   - auto-dismiss after 8s.
 *   - sage accent left rule on a frosted card.
 *
 * Mounted at the top of HomeScreen (overlay-positioned, never blocks
 * brain-dump or burhan).
 */

import React, { useEffect, useRef, useState } from 'react';
import * as events from '@ollie/events';

type Milestone = 'd1' | 'd7' | 'd30';

interface MilestoneCopy {
  kicker: string;
  body: string;
}

const COPY: Record<Milestone, MilestoneCopy> = {
  d1: { kicker: 'day 1', body: 'you came back.' },
  d7: { kicker: 'week 1', body: 'still here.' },
  d30: { kicker: 'month 1', body: 'quiet milestone.' },
};

function dismissKey(m: Milestone): string {
  return `retention_${m}_dismissed`;
}

function readDismissed(m: Milestone): boolean {
  try {
    return localStorage.getItem(dismissKey(m)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(m: Milestone): void {
  try {
    localStorage.setItem(dismissKey(m), '1');
  } catch {
    /* non-fatal */
  }
}

const AUTO_DISMISS_MS = 8_000;

export function RetentionWelcomeBar(): React.ReactElement | null {
  const [active, setActive] = useState<Milestone | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function show(m: Milestone): void {
      if (readDismissed(m)) return;
      setActive(m);
    }

    const offs = [
      events.on('void:retention:d1_returned', () => show('d1')),
      events.on('void:retention:d7_returned', () => show('d7')),
      events.on('void:retention:d30_returned', () => show('d30')),
    ];
    return () => {
      offs.forEach((off) => {
        try { off(); } catch { /* noop */ }
      });
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      writeDismissed(active);
      setActive(null);
    }, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active]);

  if (!active) return null;
  const copy = COPY[active];

  function handleDismiss(): void {
    if (!active) return;
    writeDismissed(active);
    setActive(null);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`retention milestone ${active}`}
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 14px 10px 16px',
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.25)',
        borderLeft: '2px solid var(--accent)',
        borderRadius: 12,
        boxShadow: 'var(--sh-md)',
        animation: 'fadeUp 300ms var(--e-calm-out) both',
        maxWidth: 360,
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          whiteSpace: 'nowrap',
        }}
      >
        {copy.kicker}
      </span>
      <span
        style={{
          flex: 1,
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          letterSpacing: 'var(--ls-caps-small)',
          textTransform: 'uppercase',
          color: 'var(--ink-soft)',
        }}
      >
        {copy.body}
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--ink-faint)',
          fontFamily: "'DM Mono', monospace",
          fontSize: 14,
          lineHeight: 1,
          padding: '2px 4px',
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}

export default RetentionWelcomeBar;
