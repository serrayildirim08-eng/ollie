/**
 * v2-shell · <PushSurface>
 *
 * Wraps a pushed page (a module homepage; submodule apps own their own
 * Screen chrome so they are NOT wrapped). DIRECTION.md gives back exactly
 * two always-available gestures:
 *
 *   - swipe right from the LEFT EDGE — the iOS-standard back reflex.
 *   - swipe down on the handle — the explicit visible affordance.
 *
 * This component implements the edge-swipe (a drag that starts within the
 * left ~24px gutter and travels right past a threshold pops the stack) and
 * leaves the handle render + tap to the page itself. The page slides in
 * from the right on mount — a calm push, not a fade.
 *
 * Swipe LEFT does nothing — DIRECTION.md: "there is no forward stack."
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';

const box = { boxSizing: 'border-box' as const };

/** a drag must start within this many px of the left edge to count as back */
const EDGE_GUTTER = 28;
/** travel past this fraction of the viewport to commit the pop */
const COMMIT_FRACTION = 0.3;
/** a fast rightward flick commits regardless of distance (px/ms) */
const FLICK_VELOCITY = 0.4;

export interface PushSurfaceProps {
  /** pop the stack one level */
  onBack: () => void;
  children: ReactNode;
}

export function PushSurface({ onBack, children }: PushSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    startT: number;
    axis: 'none' | 'x' | 'y';
    fromEdge: boolean;
    pointerId: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const host = hostRef.current;
    const left = host ? host.getBoundingClientRect().left : 0;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      startT: performance.now(),
      axis: 'none',
      fromEdge: e.clientX - left <= EDGE_GUTTER,
      pointerId: e.pointerId,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // only an edge-originating drag is a back gesture; otherwise let the
    // page (a module homepage) scroll / interact normally.
    if (!d.fromEdge) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.axis === 'none') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (d.axis !== 'x') return;
    // only rightward travel — there is no forward stack
    setDragX(Math.max(0, dx));
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.fromEdge || d.axis !== 'x' || dragX === null) {
      setDragX(null);
      return;
    }
    const width = hostRef.current?.offsetWidth ?? 390;
    const elapsed = Math.max(1, performance.now() - d.startT);
    const velocity = dragX / elapsed;
    const commit = dragX > width * COMMIT_FRACTION || velocity > FLICK_VELOCITY;
    setDragX(null);
    if (commit) onBack();
  }, [dragX, onBack]);

  const dragging = dragX !== null;

  return (
    <div
      ref={hostRef}
      data-testid="push-surface"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        ...box,
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'transparent',
        transform: `translate3d(${dragX ?? 0}px, 0, 0)`,
        transition: dragging ? 'none' : 'transform .3s cubic-bezier(.22,.61,.36,1)',
        // a soft shade under the pushed page as it drags back
        boxShadow: dragging ? '-12px 0 30px rgba(42,38,34,.14)' : 'none',
        touchAction: 'pan-y',
      }}
    >
      {children}
    </div>
  );
}
