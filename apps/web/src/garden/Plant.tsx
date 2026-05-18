/**
 * apps/web/garden · Plant — PLACEHOLDER renderer
 *
 * v1 renders every planted thing as simple procedural geometry: a stem +
 * a head whose shape depends on `kind`, scaled by `growth`, tinted by
 * `variant`. It is deliberately modest — a stand-in, not the final art.
 *
 * ── SWAP CONTRACT ────────────────────────────────────────────────────────
 * When the real GLB plant assets land, replace ONLY the body of this
 * component. The props below are the stable contract — `gardenStore`,
 * `HabitsZone`, and the game model never change:
 *
 *   kind     'sprout' | 'bloom' | 'bush'   — which asset to show
 *   variant  0..3                          — colour / cultivar
 *   growth   0..PLANT_MAX_GROWTH            — drives overall scale
 *   position / rotation / onClick          — placement + interaction
 *
 * A GLB swap = `useGLTF` per kind + scale by `growthScale(growth)`. Keep
 * the same prop names and nothing upstream has to change.
 */

import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { PLANT_MAX_GROWTH, type PlantKind } from '@ollie/garden';

/** Variant palette — Ollie's ceramic/sage/sky/blush DNA. */
const VARIANT_COLORS = ['#7C9E87', '#E8B4B8', '#A9C7D9', '#C9A961'];

const STEM_COLOR = '#6E5640';

/** Overall scale for a growth stage — small at 0, full at max. */
export function growthScale(growth: number): number {
  const t = Math.max(0, Math.min(1, growth / PLANT_MAX_GROWTH));
  return 0.45 + 0.55 * t;
}

export interface PlantProps {
  kind: PlantKind;
  variant: number;
  growth: number;
  position: [number, number, number];
  rotation?: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export function Plant({ kind, variant, growth, position, rotation = 0, onClick }: PlantProps) {
  const color = VARIANT_COLORS[((variant % 4) + 4) % 4];
  const s = useMemo(() => growthScale(growth), [growth]);

  return (
    <group position={position} rotation={[0, rotation, 0]} scale={s} onClick={onClick}>
      {/* stem — short woody base shared by every kind */}
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.04, 0.24, 6]} />
        <meshStandardMaterial color={STEM_COLOR} metalness={0} roughness={0.85} />
      </mesh>

      {/* head — shape depends on kind */}
      {kind === 'sprout' && (
        <mesh position={[0, 0.42, 0]} castShadow>
          <coneGeometry args={[0.13, 0.34, 8]} />
          <meshStandardMaterial color={color} metalness={0} roughness={0.7} />
        </mesh>
      )}

      {kind === 'bloom' && (
        <group position={[0, 0.34, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial color={color} metalness={0} roughness={0.55} />
          </mesh>
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13]} castShadow>
                <sphereGeometry args={[0.07, 10, 10]} />
                <meshStandardMaterial color={color} metalness={0} roughness={0.55} />
              </mesh>
            );
          })}
        </group>
      )}

      {kind === 'bush' && (
        <group position={[0, 0.22, 0]}>
          {[
            [0, 0.04, 0, 0.18],
            [-0.12, -0.02, 0.05, 0.13],
            [0.13, -0.01, -0.04, 0.12],
            [0.02, 0.12, -0.08, 0.11],
          ].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]} castShadow>
              <sphereGeometry args={[r, 12, 12]} />
              <meshStandardMaterial color={color} metalness={0} roughness={0.75} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
