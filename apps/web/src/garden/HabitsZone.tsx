/**
 * apps/web/garden · HabitsZone — the first playable zone
 *
 * Renders the habits herb-bed: six fixed slots (GARDEN_GAME_DESIGN.md §6).
 * An empty slot shows a low ground-ring marker; it brightens when the
 * player can afford a seed — a soft invitation, never a nag. A filled
 * slot shows its Plant. Taps bubble up; GardenScene owns the response.
 *
 * Slot-based by design: positions are fixed (the scene always composes),
 * the player's freedom is which plant + variant goes where.
 */

import type { ThreeEvent } from '@react-three/fiber';
import { ZONES } from '@ollie/garden';
import { Plant } from './Plant';
import { useGarden } from './gardenStore';

export interface HabitsZoneProps {
  /** Player tapped an empty slot — open the plant picker for it. */
  onSlotClick: (slotId: string) => void;
  /** Player tapped a planted plant — grow it. */
  onPlantClick: (plantingId: string) => void;
}

/** Low ring on the ground marking an open slot. */
function SlotMarker({
  position,
  affordable,
  onClick,
}: {
  position: [number, number, number];
  affordable: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <mesh
      position={[position[0], 0.02, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={onClick}
    >
      <ringGeometry args={[0.16, 0.26, 24]} />
      <meshStandardMaterial
        color={affordable ? '#9DB89F' : '#CFC9BC'}
        emissive={affordable ? '#7C9E87' : '#000000'}
        emissiveIntensity={affordable ? 0.35 : 0}
        metalness={0}
        roughness={0.9}
        transparent
        opacity={affordable ? 0.9 : 0.5}
        depthWrite={false}
      />
    </mesh>
  );
}

export function HabitsZone({ onSlotClick, onPlantClick }: HabitsZoneProps) {
  const garden = useGarden();
  if (!garden.zonesUnlocked.includes('habits')) return null;

  const slots = ZONES.habits.slots;
  const canAffordSeed = garden.resources.seed >= 1;

  return (
    <group>
      {slots.map((slot) => {
        const planting = garden.plantings.find(
          (p) => p.zoneId === 'habits' && p.slotId === slot.id,
        );

        if (!planting) {
          return (
            <SlotMarker
              key={slot.id}
              position={slot.pos}
              affordable={canAffordSeed}
              onClick={(e) => {
                e.stopPropagation();
                onSlotClick(slot.id);
              }}
            />
          );
        }

        return (
          <Plant
            key={slot.id}
            kind={planting.kind}
            variant={planting.variant}
            growth={planting.growth}
            position={slot.pos}
            rotation={slot.rot}
            onClick={(e) => {
              e.stopPropagation();
              onPlantClick(planting.id);
            }}
          />
        );
      })}
    </group>
  );
}
