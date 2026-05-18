/**
 * @ollie/garden · zones + slots
 *
 * The garden grows outward — each app module reveals its own zone
 * (GARDEN_GAME_DESIGN.md §4). Zones surprise-appear as gifts after the
 * player uses a module; a locked zone is never shown as a failed door.
 *
 * Tending is slot-based (§6): each zone has a FIXED set of slots at
 * hand-placed positions, so the scene always composes well. The player's
 * freedom is *which* plant + *which* variant goes in a slot — not where.
 *
 * v1 ships ONE zone (`habits`). The rest are declared here so the
 * surprise-unlock machinery and the build have their target shape, but
 * only `habits` has slots wired into the 3D scene for now.
 */

export type ZoneId =
  | 'habits'
  | 'finance'
  | 'body'
  | 'admin'
  | 'dump';

/** A single planting position within a zone. World-space, metres. */
export interface Slot {
  id: string;
  /** World position [x, y, z]. y is ground level (0). */
  pos: [number, number, number];
  /** Stable y-rotation so plants don't all face the same way. */
  rot: number;
}

export interface ZoneDef {
  id: ZoneId;
  /** App module whose use reveals this zone. */
  sourceModule: string;
  /** Lawyer-plain label shown to the player. */
  label: string;
  /** Slot layout. Empty until the zone's scene is wired. */
  slots: Slot[];
}

/**
 * Habits zone — a bed of small plants to the left of Burhan. Six slots in
 * a 2×3 grid. Burhan + its ring sit around z=2.8; this bed sits clear of
 * the ring at x≈-3 (camera azimuth is bounded ±20°, so the left bed stays
 * in frame). Ground is flat at y=0.
 */
const HABITS_SLOTS: Slot[] = [
  { id: 'h1', pos: [-3.3, 0, 1.7], rot: 0.4 },
  { id: 'h2', pos: [-2.3, 0, 1.5], rot: -0.7 },
  { id: 'h3', pos: [-3.5, 0, 2.8], rot: 1.1 },
  { id: 'h4', pos: [-2.4, 0, 2.7], rot: -0.3 },
  { id: 'h5', pos: [-3.2, 0, 3.9], rot: 0.8 },
  { id: 'h6', pos: [-2.2, 0, 3.8], rot: -1.2 },
];

export const ZONES: Record<ZoneId, ZoneDef> = {
  habits: {
    id: 'habits',
    sourceModule: 'habits',
    label: 'the herb beds',
    slots: HABITS_SLOTS,
  },
  finance: {
    id: 'finance',
    sourceModule: 'finance',
    label: 'the orchard',
    slots: [],
  },
  body: {
    id: 'body',
    sourceModule: 'body',
    label: 'the pond bank',
    slots: [],
  },
  admin: {
    id: 'admin',
    sourceModule: 'admin',
    label: 'the stone path',
    slots: [],
  },
  dump: {
    id: 'dump',
    sourceModule: 'dump',
    label: 'the quiet corner',
    slots: [],
  },
};

/** Zones that are open from first-run — the player always lands somewhere warm. */
export const FIRST_RUN_ZONES: ZoneId[] = ['habits'];

/** Lookup a slot by zone + id. Returns undefined if either is unknown. */
export function findSlot(zoneId: ZoneId, slotId: string): Slot | undefined {
  return ZONES[zoneId]?.slots.find((s) => s.id === slotId);
}
