import { Component, Suspense, lazy, useMemo, type ReactNode } from 'react';
import { BurhanTree, LifeEventLayer } from './BurhanTree';
import { positionFor, type BurhanEvent } from '@ollie/logic/burhan';
import { useReducedMotion, usePageVisible } from '../hooks/useReducedMotion';

const Burhan3DCanvas = lazy(() => import('./Burhan3DCanvas'));

export interface Burhan3DProps {
  /** Pixel height of the rendered scene. */
  height?: number;
  /** Pixel width of the rendered scene. Defaults to `height`. */
  width?: number;
  /** Force the 2D SVG fallback (useful for tests / very small viewports). */
  forceFallback?: boolean;
  /**
   * Life-event tree elements (Sprint 3 D1). Rendered as an SVG overlay
   * on top of the 3D canvas. Empty array renders no overlay.
   * Append-only — Burhan never decays.
   */
  lifeEvents?: BurhanEvent[];
}

function Fallback2D({ height, lifeEvents }: { height: number; lifeEvents?: BurhanEvent[] }) {
  return <BurhanTree height={height} tone="garden" lifeEvents={lifeEvents} />;
}

// If three.js fails to load or the model errors out, fall back to the SVG tree.
class CanvasErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { errored: boolean }
> {
  state = { errored: false };
  static getDerivedStateFromError(): { errored: boolean } {
    return { errored: true };
  }
  componentDidCatch(err: unknown): void {
    if (typeof console !== 'undefined') console.warn('[Burhan3D] render failed, using 2D fallback', err);
  }
  render(): ReactNode {
    return this.state.errored ? this.props.fallback : this.props.children;
  }
}

export function Burhan3D({ height = 400, width, forceFallback, lifeEvents }: Burhan3DProps) {
  const w = width ?? height;
  const reduced = useReducedMotion();
  const visible = usePageVisible();

  const positioned = useMemo(
    () => (lifeEvents ?? []).map(positionFor),
    [lifeEvents],
  );

  if (forceFallback) {
    return (
      <div role="img" aria-label="Burhan, an olive tree" style={{ width: w, height, position: 'relative' }}>
        <Fallback2D height={height} lifeEvents={lifeEvents} />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Burhan, an olive tree"
      style={{ width: w, height, display: 'block', position: 'relative' }}
    >
      <CanvasErrorBoundary fallback={<Fallback2D height={height} lifeEvents={lifeEvents} />}>
        <Suspense fallback={<Fallback2D height={height} lifeEvents={lifeEvents} />}>
          <Burhan3DCanvas
            width={w}
            height={height}
            reducedMotion={reduced}
            paused={!visible}
          />
        </Suspense>
      </CanvasErrorBoundary>
      {positioned.length > 0 && (
        <LifeEventLayer width={w} height={height} elements={positioned} />
      )}
    </div>
  );
}
