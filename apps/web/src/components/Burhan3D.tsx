import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { BurhanTree } from './BurhanTree';

const Burhan3DCanvas = lazy(() => import('./Burhan3DCanvas'));

export interface Burhan3DProps {
  /** Pixel height of the rendered scene. */
  height?: number;
  /** Pixel width of the rendered scene. Defaults to `height`. */
  width?: number;
  /** Force the 2D SVG fallback (useful for tests / very small viewports). */
  forceFallback?: boolean;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

function Fallback2D({ height }: { height: number }) {
  return <BurhanTree height={height} tone="garden" />;
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

export function Burhan3D({ height = 400, width, forceFallback }: Burhan3DProps) {
  const w = width ?? height;
  const reduced = useReducedMotion();
  const visible = usePageVisible();

  if (forceFallback) {
    return (
      <div role="img" aria-label="Burhan, an olive tree" style={{ width: w, height }}>
        <Fallback2D height={height} />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Burhan, an olive tree"
      style={{ width: w, height, display: 'block' }}
    >
      <CanvasErrorBoundary fallback={<Fallback2D height={height} />}>
        <Suspense fallback={<Fallback2D height={height} />}>
          <Burhan3DCanvas
            width={w}
            height={height}
            reducedMotion={reduced}
            paused={!visible}
          />
        </Suspense>
      </CanvasErrorBoundary>
    </div>
  );
}
