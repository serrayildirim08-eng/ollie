/**
 * @ollie/garden · garden game state + pure reducers
 *
 * One store slice (`garden.state`) holds the whole game. Every mutation
 * goes through a pure reducer here: takes the old state, returns a new
 * one, never mutates. ADHD-safety (GARDEN_GAME_DESIGN.md §9): nothing in
 * here can decay, wilt, expire, or regress. Reducers only add.
 */

import type { Resources } from './resources.js';
import { STARTING_RESOURCES } from './resources.js';
import type { ZoneId } from './zones.js';
import { ZONES, FIRST_RUN_ZONES, findSlot } from './zones.js';

/**
 * Placeholder plant kinds. v1 renders these as simple procedural geometry
 * (see apps/web Plant.tsx) — real GLB assets swap in later behind the
 * SAME kind enum, so this contract is stable across the art handoff.
 */
export type PlantKind = 'sprout' | 'bloom' | 'bush';

export const PLANT_KINDS: PlantKind[] = ['sprout', 'bloom', 'bush'];

/** Colour/shape variants per kind. The player's in-slot freedom (§6). */
export const PLANT_VARIANTS = 4;

/** A plant grows through this many stages, then it's fully grown. */
export const PLANT_MAX_GROWTH = 3;

/** A single placed plant. Lives in exactly one slot. */
export interface Planting {
  /** Unique id. */
  id: string;
  zoneId: ZoneId;
  slotId: string;
  kind: PlantKind;
  /** Variant index [0, PLANT_VARIANTS). */
  variant: number;
  /** Growth stage [0, PLANT_MAX_GROWTH]. Only ever increases. */
  growth: number;
}

export interface GardenState {
  resources: Resources;
  /** Cumulative water poured into Burhan. Drives Burhan's stage. */
  burhanWater: number;
  /** Every placed plant. */
  plantings: Planting[];
  /** Zones revealed to the player so far. */
  zonesUnlocked: ZoneId[];
  /** How many burhan life-events the resource ledger has already credited. */
  ledgerCount: number;
}

let plantSeq = 0;
/** Monotonic id for new plantings. Time-prefixed so ids are stable-ish. */
function newPlantingId(): string {
  plantSeq += 1;
  return `p_${Date.now().toString(36)}_${plantSeq}`;
}

/**
 * First-run garden (GARDEN_GAME_DESIGN.md §8): a ready small garden — the
 * habits bed already holds two gifted plants, plus a starting resource
 * bank. The first frame says "this place is already yours", never "empty
 * plot, get to work."
 */
export function defaultGardenState(): GardenState {
  return {
    resources: { ...STARTING_RESOURCES },
    burhanWater: 0,
    plantings: [
      { id: 'gift1', zoneId: 'habits', slotId: 'h1', kind: 'bloom', variant: 0, growth: 1 },
      { id: 'gift2', zoneId: 'habits', slotId: 'h4', kind: 'bush', variant: 2, growth: 2 },
    ],
    zonesUnlocked: [...FIRST_RUN_ZONES],
    ledgerCount: 0,
  };
}

/** True when a zone slot has no plant in it yet. */
export function isSlotEmpty(state: GardenState, zoneId: ZoneId, slotId: string): boolean {
  return !state.plantings.some((p) => p.zoneId === zoneId && p.slotId === slotId);
}

// ─── reducers ────────────────────────────────────────────────────────────
// Each returns a NEW state. If the action isn't affordable / valid, the
// same state is returned unchanged — callers can compare by reference.

export interface PlantAction {
  zoneId: ZoneId;
  slotId: string;
  kind: PlantKind;
  variant: number;
}

/** Plant a new thing into an empty slot. Costs 1 seed. */
export function plant(state: GardenState, action: PlantAction): GardenState {
  if (state.resources.seed < 1) return state;
  if (!findSlot(action.zoneId, action.slotId)) return state;
  if (!state.zonesUnlocked.includes(action.zoneId)) return state;
  if (!isSlotEmpty(state, action.zoneId, action.slotId)) return state;
  return {
    ...state,
    resources: { ...state.resources, seed: state.resources.seed - 1 },
    plantings: [
      ...state.plantings,
      {
        id: newPlantingId(),
        zoneId: action.zoneId,
        slotId: action.slotId,
        kind: action.kind,
        variant: ((action.variant % PLANT_VARIANTS) + PLANT_VARIANTS) % PLANT_VARIANTS,
        growth: 0,
      },
    ],
  };
}

/** Grow an existing plant one stage. Costs 1 water. */
export function growPlant(state: GardenState, plantingId: string): GardenState {
  if (state.resources.water < 1) return state;
  const idx = state.plantings.findIndex((p) => p.id === plantingId);
  if (idx === -1) return state;
  if (state.plantings[idx].growth >= PLANT_MAX_GROWTH) return state;
  const next = state.plantings.slice();
  next[idx] = { ...next[idx], growth: next[idx].growth + 1 };
  return {
    ...state,
    resources: { ...state.resources, water: state.resources.water - 1 },
    plantings: next,
  };
}

/** Pour one water into Burhan. Costs 1 water; advances burhanWater. */
export function waterBurhan(state: GardenState): GardenState {
  if (state.resources.water < 1) return state;
  return {
    ...state,
    resources: { ...state.resources, water: state.resources.water - 1 },
    burhanWater: state.burhanWater + 1,
  };
}

/** Reveal a zone (surprise-unlock). Idempotent. */
export function unlockZone(state: GardenState, zoneId: ZoneId): GardenState {
  if (!ZONES[zoneId]) return state;
  if (state.zonesUnlocked.includes(zoneId)) return state;
  return { ...state, zonesUnlocked: [...state.zonesUnlocked, zoneId] };
}

/** Credit earned resources from the life-event ledger. Append-only. */
export function applyCredit(
  state: GardenState,
  earned: Resources,
  newLedgerCount: number,
): GardenState {
  if (newLedgerCount <= state.ledgerCount) return state;
  return {
    ...state,
    resources: {
      water: state.resources.water + earned.water,
      seed: state.resources.seed + earned.seed,
    },
    ledgerCount: newLedgerCount,
  };
}
