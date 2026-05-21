/**
 * CookRatingModal — the 3-button rating sheet for "I cooked this".
 *
 * Three calm options, all Atelier-DNA (no emoji, no ASCII arrows):
 *   - left  : outline circle + downward chevron — "didn't love it" (rating = -1)
 *   - centre: solid sage circle "cooked"          — neutral cook   (rating =  0)
 *   - right : outline circle + upward chevron + accent — "loved it" (rating =  1)
 *
 * Mounted as a portal-free overlay (the parent decides z-index). Closes on:
 *   - Esc keydown
 *   - backdrop click
 *   - any of the three rating buttons (after invoking onCook)
 *
 * Focus is trapped between the three buttons. The first option is focused
 * on mount so a keyboard user can land directly on a choice. The modal
 * respects `prefers-reduced-motion` — no entrance animation when set.
 */
import { useEffect, useRef } from 'react';
import { v2, IconChevronDown } from '../modules/money-v2/v2';

export interface CookRatingModalProps {
  dish: string;
  onCook: (rating: -1 | 0 | 1) => void;
  onClose: () => void;
}

export function CookRatingModal({ dish, onCook, onClose }: CookRatingModalProps) {
  const downRef = useRef<HTMLButtonElement>(null);
  const neutralRef = useRef<HTMLButtonElement>(null);
  const upRef = useRef<HTMLButtonElement>(null);

  // Esc to close + focus the first option on mount.
  useEffect(() => {
    downRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // Tab / Shift+Tab focus trap across the three options.
      if (e.key === 'Tab') {
        const order = [downRef.current, neutralRef.current, upRef.current];
        const active = document.activeElement as HTMLButtonElement | null;
        const idx = order.indexOf(active);
        if (idx === -1) {
          e.preventDefault();
          order[0]?.focus();
          return;
        }
        e.preventDefault();
        const next = e.shiftKey
          ? order[(idx - 1 + order.length) % order.length]
          : order[(idx + 1) % order.length];
        next?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handle = (rating: -1 | 0 | 1) => () => {
    onCook(rating);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`rate cooking ${dish}`}
      onClick={(e) => {
        // backdrop click → close (only when the backdrop itself is clicked).
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(42, 38, 34, 0.32)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div
        style={{
          background: v2.paper,
          borderRadius: 24,
          padding: '26px 22px 30px',
          width: '100%',
          maxWidth: 360,
          boxShadow: '0 18px 48px rgba(42, 38, 34, .18)',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          you cooked
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
            marginBottom: 22,
          }}
        >
          {dish}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <RatingButton
            ref={downRef}
            ariaLabel="didn't love it"
            label="not for me"
            onClick={handle(-1)}
            tone="down"
          />
          <RatingButton
            ref={neutralRef}
            ariaLabel="just cooked it"
            label="cooked it"
            onClick={handle(0)}
            tone="neutral"
          />
          <RatingButton
            ref={upRef}
            ariaLabel="loved it"
            label="loved it"
            onClick={handle(1)}
            tone="up"
          />
        </div>
      </div>
    </div>
  );
}

// ─── one of the three round options ──────────────────────────────────────────

interface RatingButtonProps {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  tone: 'down' | 'neutral' | 'up';
}

import { forwardRef } from 'react';

const RatingButton = forwardRef<HTMLButtonElement, RatingButtonProps>(
  function RatingButton({ label, ariaLabel, onClick, tone }, ref) {
    const filled = tone === 'neutral';
    const accent = tone === 'up' ? v2.accent : v2.mute;
    const stroke = filled ? '#fff' : tone === 'up' ? v2.accent : v2.mute;
    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        style={{
          flex: 1,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: '14px 6px 10px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: filled ? v2.sage : 'transparent',
            border: filled ? 'none' : `1.6px solid ${accent}`,
            transition: 'transform 200ms ease-out',
          }}
        >
          {tone === 'down' && (
            <IconChevronDown size={20} weight={1.8} stroke={stroke} />
          )}
          {tone === 'up' && (
            // a chevron pointing up — re-using IconChevronDown rotated keeps
            // the icon set tight (no new SVG path needed).
            <span
              style={{
                display: 'inline-flex',
                transform: 'rotate(180deg)',
              }}
            >
              <IconChevronDown size={20} weight={1.8} stroke={stroke} />
            </span>
          )}
          {tone === 'neutral' && (
            <span
              style={{
                fontSize: 12,
                color: '#fff',
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}
            >
              ok
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 12,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            textAlign: 'center',
          }}
        >
          {label}
        </span>
      </button>
    );
  },
);
