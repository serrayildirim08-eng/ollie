/**
 * apps/web · garden game state — store binding
 *
 * `garden.state` is one store slice holding the whole game (resources,
 * plantings, zones). The pure model + reducers live in `@ollie/garden`;
 * this file binds them to the app store: a reactive hook for reading and
 * plain action functions for mutating.
 *
 * Actions read the *current* slice straight from the store (not a closed-
 * over snapshot), so rapid taps never apply a reducer to stale state.
 */

import {
  defaultGardenState,
  plant,
  growPlant,
  waterBurhan,
  unlockZone,
  type GardenState,
  type PlantAction,
  type ZoneId,
} from '@ollie/garden';
import { store, useStoreSlice } from '../store';

const MOD = 'garden';
const KEY = 'state';

function read(): GardenState {
  return store.get<GardenState>(MOD, KEY, defaultGardenState());
}

function write(next: GardenState): void {
  store.set(MOD, KEY, next);
}

/** Reactive read of the whole garden slice. */
export function useGarden(): GardenState {
  const [state] = useStoreSlice<GardenState>(MOD, KEY, defaultGardenState());
  return state;
}

// ─── actions ─────────────────────────────────────────────────────────────
// Each is a no-op write when the reducer returns the same state (the
// reducer already enforces affordability + validity), so callers can fire
// freely without pre-checking.

export function plantInSlot(action: PlantAction): void {
  write(plant(read(), action));
}

export function growPlanting(plantingId: string): void {
  write(growPlant(read(), plantingId));
}

export function pourWaterOnBurhan(): void {
  write(waterBurhan(read()));
}

export function revealZone(zoneId: ZoneId): void {
  write(unlockZone(read(), zoneId));
}
