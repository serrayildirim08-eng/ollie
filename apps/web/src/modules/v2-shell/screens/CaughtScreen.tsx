/**
 * v2-shell · CaughtScreen — the thought landed (caught.html)
 *
 * DIRECTION.md: "Caught shows what landed." SCREENS.md: "One card: the
 * thought you threw, a sage checkmark, the drawer glyph it sorted into.
 * Swipe-history dots for older catches."
 *
 * The shell holds a small in-memory history of caught thoughts this
 * session (the durable archive lives in the `dump` store; the locked v2
 * IA has no archive screen — Caught IS the live view). The card shows the
 * most-recent catch; the history dots let you page back through earlier
 * ones. Tapping the drawer jumps into the submodule the thought routed to.
 *
 * Empty state (SCREENS.md): one calm line, never an empty feed.
 */
import { useEffect, useState } from 'react';
import { v2 } from '../../money-v2/v2';
import type { CaughtThought } from '../capture-routing';
import type { SubmoduleKey } from '../types';

const box = { boxSizing: 'border-box' as const };

export interface CaughtScreenProps {
  /** most-recent-first list of thoughts caught this session */
  history: CaughtThought[];
  /** jump into the submodule a caught thought routed to */
  onOpenSubmodule: (submodule: SubmoduleKey) => void;
}

export function CaughtScreen({ history, onOpenSubmodule }: CaughtScreenProps) {
  // which catch is on the card — 0 is the newest. resets to newest when a
  // fresh thought arrives (history length grows).
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [history.length]);

  if (history.length === 0) {
    return (
      <div
        style={{
          ...box,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 48px',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.5,
            color: v2.mute,
            textAlign: 'center',
            letterSpacing: '-.01em',
          }}
        >
          nothing caught yet — throw something
        </p>
      </div>
    );
  }

  const caught = history[Math.min(idx, history.length - 1)];
  // cap the history dots so a long session does not overflow the card
  const dotCount = Math.min(history.length, 5);

  return (
    <div
      style={{
        ...box,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 36px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div
        style={{
          ...box,
          width: '100%',
          background: v2.card,
          border: `1px solid ${v2.line}`,
          borderRadius: 28,
          boxShadow: '0 16px 38px rgba(42,38,34,.07)',
          padding: '38px 32px 34px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        {/* checkmark — landed, wordless */}
        <span
          aria-hidden
          style={{
            ...box,
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: v2.sage,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 30,
          }}
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4 10-11" />
          </svg>
        </span>

        {/* the user's own caught thought */}
        <p style={{ fontSize: 23, lineHeight: 1.42, color: v2.ink, letterSpacing: '-.01em', fontWeight: 400 }}>
          {caught.text}
        </p>

        {/* drawer glyph — where it landed. tappable when it routed to a submodule. */}
        <button
          type="button"
          disabled={!caught.submodule}
          onClick={() => caught.submodule && onOpenSubmodule(caught.submodule)}
          aria-label={caught.submodule ? `open ${caught.drawer}` : `sorted into ${caught.drawer}`}
          style={{
            ...box,
            marginTop: 34,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: caught.submodule ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span
            aria-hidden
            style={{
              ...box,
              width: 58,
              height: 58,
              borderRadius: 18,
              background: v2.tile,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={v2.accent} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M5 7l7-5 7 5M5 7v10l7 5 7-5V7" />
            </svg>
          </span>
          <span style={{ fontSize: 12, color: v2.mute, fontWeight: 600, letterSpacing: '.04em' }}>
            {caught.drawer}
          </span>
        </button>

        {/* swipe-history dots — page back through earlier catches */}
        {history.length > 1 && (
          <div style={{ ...box, marginTop: 30, display: 'flex', gap: 8 }} role="tablist" aria-label="caught history">
            {Array.from({ length: dotCount }, (_, i) => {
              const on = i === idx;
              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-label={`catch ${i + 1}`}
                  onClick={() => setIdx(i)}
                  style={{
                    ...box,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: on ? v2.ink : v2.line,
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
