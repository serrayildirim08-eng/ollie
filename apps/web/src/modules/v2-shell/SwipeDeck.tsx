/**
 * v2-shell · <SwipeDeck>
 *
 * The horizontal capture deck. DIRECTION.md: "Capture = three horizontal
 * screens + the 4-modules view (four dots)." Four full-width panels sit on
 * one flex track; the track translates by `-index * 100%`. A horizontal
 * drag past a threshold (or a fast flick) commits to the neighbouring
 * panel; anything short snaps back.
 *
 * It is deliberately NOT a router — the deck is one screen with four
 * lateral states. The push stack (module / submodule pages) lives one
 * level up in `ShellApp`.
 *
 * Pointer-events only (works for touch + mouse + pen on iPhone Safari and
 * desktop). `touch-action: pan-y` lets a vertical scroll inside a panel
 * still work — the deck only claims horizontal intent.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';

const box = { boxSizing: 'border-box' as const };

export interface SwipeDeckProps {
  /** the active panel index */
  index: number;
  /** total panels (4 for the capture deck) */
  count: number;
  /** commit to a new index (after a swipe or a dot tap) */
  onIndexChange: (next: number) => void;
  /** the four panels, in deck order */
  children: ReactNode[];
}

/** a horizontal drag past this fraction of the viewport commits the swipe */
const COMMIT_FRACTION = 0.22;
/** a fast flick commits regardless of distance (px/ms) */
const FLICK_VELOCITY = 0.45;

export function SwipeDeck({ index, count, onIndexChange, children }: SwipeDeckProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // live drag offset in px; null when not dragging
  const [dragX, setDragX] = useState<number | null>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    startT: number;
    axis: 'none' | 'x' | 'y';
    pointerId: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // ignore secondary buttons / multi-touch noise
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      startT: performance.now(),
      axis: 'none',
      pointerId: e.pointerId,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    // lock the axis on first meaningful movement — vertical wins so an
    // inner scroll (a module homepage) is never hijacked by the deck.
    if (d.axis === 'none') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (d.axis !== 'x') return;

    // resist dragging past the first / last panel — a rubber-band feel
    let eff = dx;
    if ((index === 0 && dx > 0) || (index === count - 1 && dx < 0)) {
      eff = dx * 0.32;
    }
    setDragX(eff);
  }, [index, count]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) {
      return;
    }
    drag.current = null;

    if (d.axis !== 'x' || dragX === null) {
      setDragX(null);
      return;
    }

    const width = hostRef.current?.offsetWidth ?? 390;
    const elapsed = Math.max(1, performance.now() - d.startT);
    const velocity = dragX / elapsed; // px per ms; sign = direction
    const farEnough = Math.abs(dragX) > width * COMMIT_FRACTION;
    const fastEnough = Math.abs(velocity) > FLICK_VELOCITY;

    let next = index;
    if (farEnough || fastEnough) {
      // drag right (positive dx) → previous panel
      next = dragX > 0 ? index - 1 : index + 1;
      next = Math.max(0, Math.min(count - 1, next));
    }
    setDragX(null);
    if (next !== index) onIndexChange(next);
  }, [dragX, index, count, onIndexChange]);

  const dragging = dragX !== null;
  // track offset: base panel offset + the live drag delta
  const trackStyle = {
    ...box,
    display: 'flex',
    height: '100%',
    width: `${count * 100}%`,
    transform: `translate3d(calc(${-index * (100 / count)}% + ${dragX ?? 0}px), 0, 0)`,
    transition: dragging ? 'none' : 'transform .3s cubic-bezier(.22,.61,.36,1)',
  };

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        ...box,
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'pan-y',
      }}
    >
      <div style={trackStyle}>
        {children.map((panel, i) => (
          <div
            // panels are positional + stable for the deck's lifetime
            key={`deck-panel-${i}`}
            aria-hidden={i !== index}
            style={{
              ...box,
              width: `${100 / count}%`,
              height: '100%',
              flexShrink: 0,
              position: 'relative',
            }}
          >
            {panel}
          </div>
        ))}
      </div>
    </div>
  );
}
