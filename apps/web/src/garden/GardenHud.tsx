/**
 * apps/web/garden · GardenHud — 2D overlay over the 3D canvas
 *
 * Two pieces:
 *  1. A small resource readout (seed + water). Deliberately tiny and
 *     low-contrast — an at-a-glance hint, NOT a scoreboard (no streaks,
 *     no counts that shame — GARDEN_GAME_DESIGN.md §9).
 *  2. A plant-picker bottom sheet, shown when the player taps an empty
 *     slot. Pick a kind + a variant, then plant (costs 1 seed).
 *
 * If the player taps a slot with no seed banked, the sheet shows a calm
 * "a seed is on its way" line instead of a locked-door feeling.
 */

import { useState } from 'react';
import { PLANT_KINDS, PLANT_VARIANTS, type PlantKind } from '@ollie/garden';
import { useGarden, plantInSlot } from './gardenStore';

const VARIANT_COLORS = ['#7C9E87', '#E8B4B8', '#A9C7D9', '#C9A961'];

const KIND_LABEL: Record<PlantKind, string> = {
  sprout: 'sprout',
  bloom: 'bloom',
  bush: 'bush',
};

const MONO = "'DM Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'DM Serif Display', serif";

export interface GardenHudProps {
  /** Slot the player is planting into, or null when the sheet is closed. */
  pickerSlot: string | null;
  onClosePicker: () => void;
}

export function GardenHud({ pickerSlot, onClosePicker }: GardenHudProps) {
  const garden = useGarden();
  const [kind, setKind] = useState<PlantKind>('sprout');
  const [variant, setVariant] = useState(0);

  const hasSeed = garden.resources.seed >= 1;

  function confirmPlant() {
    if (!pickerSlot || !hasSeed) return;
    plantInSlot({ zoneId: 'habits', slotId: pickerSlot, kind, variant });
    onClosePicker();
  }

  return (
    <>
      {/* ── resource readout ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 25,
          display: 'flex',
          gap: 14,
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.14em',
          color: 'rgba(17,17,17,0.5)',
          background: 'rgba(245,244,240,0.7)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          padding: '7px 12px',
          borderRadius: 10,
        }}
      >
        <span>🌱 {garden.resources.seed}</span>
        <span>💧 {garden.resources.water}</span>
      </div>

      {/* ── plant-picker bottom sheet ────────────────────────────────── */}
      {pickerSlot && (
        <div
          onClick={onClosePicker}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 40,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            background: 'rgba(17,17,17,0.12)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              margin: '0 14px 14px',
              background: 'rgba(245,244,240,0.96)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(17,17,17,0.08)',
              borderRadius: 16,
              padding: '22px 22px 24px',
              boxSizing: 'border-box',
            }}
          >
            {!hasSeed ? (
              <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
                <p style={{ fontFamily: SERIF, fontSize: 19, color: '#111', margin: '0 0 8px' }}>
                  a seed is on its way
                </p>
                <p style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: 'rgba(17,17,17,0.55)', margin: 0 }}>
                  seeds gather as you go about your days. this bed will be
                  here when one arrives.
                </p>
              </div>
            ) : (
              <>
                <p
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: 'rgba(17,17,17,0.5)',
                    margin: '0 0 14px',
                  }}
                >
                  plant something
                </p>

                {/* kind */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {PLANT_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      style={{
                        flex: 1,
                        padding: '12px 0',
                        fontFamily: MONO,
                        fontSize: 11,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        borderRadius: 10,
                        border:
                          kind === k
                            ? '1px solid rgba(17,17,17,0.55)'
                            : '1px solid rgba(17,17,17,0.12)',
                        background: kind === k ? 'rgba(17,17,17,0.05)' : 'transparent',
                        color: 'rgba(17,17,17,0.78)',
                      }}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>

                {/* variant */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
                  {Array.from({ length: PLANT_VARIANTS }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`variant ${i + 1}`}
                      onClick={() => setVariant(i)}
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        background: VARIANT_COLORS[i],
                        border:
                          variant === i
                            ? '2px solid rgba(17,17,17,0.7)'
                            : '2px solid rgba(255,255,255,0.6)',
                        boxShadow:
                          variant === i ? '0 0 0 3px rgba(17,17,17,0.08)' : 'none',
                      }}
                    />
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={onClosePicker}
                    style={{
                      flex: 1,
                      padding: '13px 0',
                      fontFamily: MONO,
                      fontSize: 11,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      borderRadius: 10,
                      border: '1px solid rgba(17,17,17,0.12)',
                      background: 'transparent',
                      color: 'rgba(17,17,17,0.55)',
                    }}
                  >
                    not now
                  </button>
                  <button
                    type="button"
                    onClick={confirmPlant}
                    style={{
                      flex: 2,
                      padding: '13px 0',
                      fontFamily: MONO,
                      fontSize: 11,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      borderRadius: 10,
                      border: '1px solid rgba(17,17,17,0.7)',
                      background: 'rgba(17,17,17,0.82)',
                      color: '#F5F4F0',
                    }}
                  >
                    plant · 1 🌱
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
