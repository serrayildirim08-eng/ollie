import { useEffect, useMemo } from 'react';
import { GardenScene } from '../garden/GardenScene';
import { useStoreSlice } from '../store';
import type { BurhanState } from '@ollie/logic/burhan';

/**
 * GardenScreen · cinematic Mediterranean tableau
 *
 * Constitutional rule: Burhan never decays. `elementCount` is purely
 * additive and derived from `burhanState.events`. There are no health,
 * water, or decay fields anywhere on this screen.
 */
export interface GardenStats {
  elementCount: number;
}

export interface GardenScreenProps {
  onNavigate: (to: 'home') => void;
  stats?: GardenStats;
}

const GARDEN_STYLES = `
@keyframes gardenFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes gardenSlideUp {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('garden-screen-styles')) return;
  const el = document.createElement('style');
  el.id = 'garden-screen-styles';
  el.textContent = GARDEN_STYLES;
  document.head.appendChild(el);
}

export function GardenScreen({ onNavigate, stats }: GardenScreenProps) {
  const [burhanState] = useStoreSlice<BurhanState>('burhan', 'state', { events: [] });
  const elementCount = stats?.elementCount ?? burhanState.events.length;

  useEffect(() => {
    injectStyles();
  }, []);

  const thisMonthCount = useMemo(() => {
    const now = Date.now();
    const monthStart = (() => {
      const d = new Date(now);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    return burhanState.events.filter((e) => e.ts >= monthStart).length;
  }, [burhanState]);

  return (
    <main
      aria-label="garden"
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        background: '#F5F4F0',
        animation: 'gardenFadeIn 0.8s ease-out both',
      }}
    >
      {/* ── 3D SCENE (full-bleed) ──────────────────────────────────── */}
      <GardenScene />

      {/* ── BOTTOM FROSTED CARD (elements count) ──────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '0 24px 32px',
          zIndex: 15,
          boxSizing: 'border-box',
          animation: 'gardenSlideUp 0.8s ease-out 0.55s both',
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            maxWidth: 560,
            margin: '0 auto',
            background: 'rgba(245,244,240,0.72)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(17,17,17,0.06)',
            borderRadius: 4,
            padding: '18px 22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontFamily: "'DM Mono', ui-monospace, monospace",
                fontSize: 9,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'rgba(17,17,17,0.5)',
                margin: '0 0 8px',
              }}
            >
              elements on the tree
            </p>
            <p
              style={{
                fontFamily: "'Fraunces', 'DM Serif Display', serif",
                fontSize: 28,
                fontWeight: 400,
                margin: 0,
                color: 'rgba(17,17,17,0.82)',
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              {elementCount}
              <span
                style={{
                  fontFamily: "'DM Mono', ui-monospace, monospace",
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  color: 'rgba(17,17,17,0.45)',
                  marginLeft: 12,
                }}
              >
                +{thisMonthCount} this month
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ── BACK BUTTON ──────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onNavigate('home')}
        aria-label="back to home"
        style={{
          position: 'absolute',
          top: 32,
          left: 24,
          zIndex: 20,
          background: 'rgba(245,244,240,0.65)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(17,17,17,0.08)',
          borderRadius: 4,
          padding: '8px 16px',
          fontFamily: "'DM Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(17,17,17,0.6)',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        back · home
      </button>
    </main>
  );
}
