export { getStage, getStageFromWater, type Stage } from './stage.js';

export {
  type Resources,
  WATER_PER_EVENT,
  EVENTS_PER_SEED,
  STARTING_RESOURCES,
  creditForEvents,
} from './resources.js';

export {
  type ZoneId,
  type Slot,
  type ZoneDef,
  ZONES,
  FIRST_RUN_ZONES,
  findSlot,
} from './zones.js';

export {
  type PlantKind,
  type Planting,
  type GardenState,
  type PlantAction,
  PLANT_KINDS,
  PLANT_VARIANTS,
  PLANT_MAX_GROWTH,
  defaultGardenState,
  isSlotEmpty,
  plant,
  growPlant,
  waterBurhan,
  unlockZone,
  applyCredit,
} from './state.js';
