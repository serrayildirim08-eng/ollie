import { Component, Suspense, lazy, useCallback, useState, type ReactNode } from 'react';
import { usePageVisible } from '../hooks/useReducedMotion';

const GardenCanvas = lazy(() => import('./GardenCanvas'));

class CanvasErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { errored: boolean }
> {
  state = { errored: false };
  static getDerivedStateFromError(): { errored: boolean } {
    return { errored: true };
  }
  componentDidCatch(err: unknown): void {
    if (typeof console !== 'undefined') console.warn('[GardenScene] render failed', err);
  }
  render(): ReactNode {
    return this.state.errored ? this.props.fallback : this.props.children;
  }
}

function SceneFallback({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        background: '#f5f4f0',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: '14%',
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'rgba(17,17,17,0.42)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function GardenScene() {
  const visible = usePageVisible();
  const [raining, setRaining] = useState(false);

  const triggerRain = useCallback(() => {
    setRaining((cur) => {
      if (cur) return cur;
      setTimeout(() => setRaining(false), 3000);
      return true;
    });
  }, []);

  return (
    <div
      role="img"
      aria-label="ollie's garden"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <CanvasErrorBoundary fallback={<SceneFallback label="garden unavailable" />}>
        <Suspense fallback={<SceneFallback label="preparing the garden..." />}>
          <GardenCanvas paused={!visible} raining={raining} />
        </Suspense>
      </CanvasErrorBoundary>
      <button
        type="button"
        onClick={triggerRain}
        disabled={raining}
        style={{
          position: 'absolute',
          right: 24,
          bottom: 100,
          zIndex: 30,
          fontFamily: "'DM Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          padding: '12px 18px',
          background: 'rgba(245,244,240,0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid rgba(17,17,17,0.12)',
          borderRadius: 12,
          color: 'rgba(17,17,17,0.78)',
          cursor: raining ? 'default' : 'pointer',
          opacity: raining ? 0.5 : 1,
        }}
      >
        {raining ? 'watering…' : 'water ollie'}
      </button>
    </div>
  );
}
