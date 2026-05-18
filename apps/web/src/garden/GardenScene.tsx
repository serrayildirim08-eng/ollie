import { Component, Suspense, lazy, useCallback, useState, type ReactNode } from 'react';
import { usePageVisible } from '../hooks/useReducedMotion';
import { GardenHud } from './GardenHud';
import { useGarden, pourWaterOnBurhan, growPlanting } from './gardenStore';

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
  const garden = useGarden();
  const [raining, setRaining] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<string | null>(null);

  const hasWater = garden.resources.water >= 1;

  // "water ollie" — pours one water into Burhan (advances its growth) and
  // plays the rain. The pour is the deliberate act that grows Burhan
  // (GARDEN_GAME_DESIGN.md §5 / decision #8).
  const waterBurhan = useCallback(() => {
    if (!hasWater) return;
    pourWaterOnBurhan();
    setRaining((cur) => {
      if (cur) return cur;
      setTimeout(() => setRaining(false), 3000);
      return true;
    });
  }, [hasWater]);

  // Tapping a plant grows it one stage; the action is a no-op when the
  // player has no water, so it's safe to fire freely.
  const handlePlantClick = useCallback((plantingId: string) => {
    growPlanting(plantingId);
  }, []);

  return (
    <div
      role="img"
      aria-label="ollie's garden"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <CanvasErrorBoundary fallback={<SceneFallback label="garden unavailable" />}>
        <Suspense fallback={<SceneFallback label="preparing the garden..." />}>
          <GardenCanvas
            paused={!visible}
            raining={raining}
            onSlotClick={setPickerSlot}
            onPlantClick={handlePlantClick}
          />
        </Suspense>
      </CanvasErrorBoundary>

      <GardenHud pickerSlot={pickerSlot} onClosePicker={() => setPickerSlot(null)} />

      <button
        type="button"
        onClick={waterBurhan}
        disabled={raining || !hasWater}
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
          cursor: raining || !hasWater ? 'default' : 'pointer',
          opacity: raining ? 0.5 : hasWater ? 1 : 0.55,
        }}
      >
        {raining
          ? 'watering…'
          : hasWater
            ? 'water ollie · 1 💧'
            : 'water gathers as you go'}
      </button>
    </div>
  );
}
