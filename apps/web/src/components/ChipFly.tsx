/**
 * ChipFly — imperative chip-flight animation.
 *
 * Usage:
 *   1. Mount <ChipFlyHost /> once near the root (renders a fixed portal container).
 *   2. Call chipFly(moduleId, fromRect, stackIndex?) from any submit handler.
 *
 * Each chip is a pill that flies from fromRect toward the nearest
 * [data-magic-tile="{moduleId}"] element, then fades out.
 * If no tile is found, the chip arcs upward and fades.
 *
 * prefers-reduced-motion: 200ms opacity fade in-place, no movement.
 * Duration token: --d-flight (600ms) from tokens.css.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── Module dot colours (matches void MODULE_COLORS) ──────────────────────────

const MODULE_COLORS: Record<string, string> = {
  grocery:   '#7A9B6D',
  pets:      '#8A9B6D',
  finance:   '#5C5750',
  habits:    '#5C5750',
  sleep:     '#5B8FB5',
  cycle:     '#8A4B2C',
  work:      '#5C5750',
  goals:     '#7A9B6D',
  admin:     '#9C9890',
  astrology: '#9C9890',
  body:      '#5B8FB5',
  dump:      '#C8C4BA',
  demo:      '#2E5D43',
};

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChipFlyItem {
  id: string;
  moduleId: string;
  label: string;
  color: string;
  /** absolute px from viewport top-left, chip starts here */
  startX: number;
  startY: number;
}

// ─── Shared state (module-level singleton, no context needed) ──────────────────

type SetChips = React.Dispatch<React.SetStateAction<ChipFlyItem[]>>;
let _setChips: SetChips | null = null;

/** Call from any submit handler to fire a chip. */
export function chipFly(
  moduleId: string,
  fromRect: DOMRect,
  stackIndex = 0,
): void {
  if (!_setChips) return;
  const id = 'cf_' + Math.random().toString(36).slice(2);
  const color = MODULE_COLORS[moduleId] ?? 'var(--ink-faint)';
  const label = moduleId.toUpperCase();
  const startX = fromRect.left + fromRect.width / 2 - 40 + stackIndex * 6;
  const startY = fromRect.top - 14 - stackIndex * 4;

  _setChips((prev) => [...prev, { id, moduleId, label, color, startX, startY }]);
}

// ─── Individual chip ───────────────────────────────────────────────────────────

interface ChipProps extends ChipFlyItem {
  onDone(id: string): void;
}

function Chip({ id, moduleId, label, color, startX, startY, onDone }: ChipProps) {
  const chipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = chipRef.current;
    if (!el) return;

    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      // 200ms fade, no movement
      const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 200,
        fill: 'forwards',
        easing: 'ease-out',
      });
      anim.finished.then(() => onDone(id)).catch(() => onDone(id));
      return;
    }

    const tile = document.querySelector<HTMLElement>(
      `[data-magic-tile="${moduleId}"]`,
    );

    const chipRect = el.getBoundingClientRect();
    let dx = 0;
    let dy = -120; // default: arc upward when no tile

    if (tile) {
      const tileRect = tile.getBoundingClientRect();
      dx = tileRect.left + tileRect.width / 2 - chipRect.width / 2 - chipRect.left;
      dy = tileRect.top + 20 - chipRect.top;

      // pulse tile on arrival
      const pulseDelay = Math.round(600 * 0.8);
      const t = setTimeout(() => {
        tile.classList.remove('pulse');
        void tile.offsetWidth; // reflow to restart animation
        tile.classList.add('pulse');
        setTimeout(() => tile.classList.remove('pulse'), 760);
      }, pulseDelay);
      // cleanup timeout if component unmounts early
      void t;
    }

    const anim = el.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        {
          transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) scale(0.9)`,
          opacity: 1,
          offset: 0.8,
        },
        {
          transform: `translate(${dx}px, ${dy}px) scale(0.6)`,
          opacity: 0,
          offset: 1,
        },
      ],
      {
        duration: 600, // --d-flight
        fill: 'forwards',
        easing: 'cubic-bezier(0.42, 0, 0.18, 1)', // --e-lift-set
      },
    );

    anim.finished.then(() => onDone(id)).catch(() => onDone(id));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      ref={chipRef}
      role="status"
      aria-live="polite"
      aria-label={`routed to ${moduleId}`}
      style={{
        position: 'fixed',
        left: startX,
        top: startY,
        pointerEvents: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(255, 255, 255, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(20, 20, 15, 0.08)',
        borderRadius: 'var(--r-pill)',
        padding: '4px 12px',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-meta)',
        letterSpacing: 'var(--ls-caps-small)',
        textTransform: 'uppercase',
        color: 'var(--ink-soft)',
        zIndex: 'var(--z-modal)' as unknown as number,
        whiteSpace: 'nowrap',
        willChange: 'transform, opacity',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          display: 'block',
        }}
      />
      {label}
    </span>
  );
}

// ─── Host (mount once near root) ──────────────────────────────────────────────

/**
 * <ChipFlyHost /> — renders all in-flight chips into a body portal.
 * Mount exactly once, inside <ToastProvider> or at App root level.
 */
export function ChipFlyHost() {
  const [chips, setChips] = useState<ChipFlyItem[]>([]);

  useEffect(() => {
    _setChips = setChips;
    return () => {
      _setChips = null;
    };
  }, []);

  const handleDone = (id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  };

  if (chips.length === 0) return null;

  return createPortal(
    <>
      {chips.map((chip) => (
        <Chip key={chip.id} {...chip} onDone={handleDone} />
      ))}
    </>,
    document.body,
  );
}
