import { describe, it, expect } from 'vitest';
import {
  defaultGardenState,
  isSlotEmpty,
  plant,
  growPlant,
  waterBurhan,
  unlockZone,
  applyCredit,
  PLANT_MAX_GROWTH,
} from '../src/state.js';

describe('defaultGardenState', () => {
  it('starts with a resource bank + two gifted plants', () => {
    const s = defaultGardenState();
    expect(s.resources.water).toBeGreaterThan(0);
    expect(s.resources.seed).toBeGreaterThan(0);
    expect(s.plantings).toHaveLength(2);
    expect(s.zonesUnlocked).toContain('habits');
  });
});

describe('plant', () => {
  it('plants into an empty slot, spending one seed', () => {
    const s0 = defaultGardenState();
    const s1 = plant(s0, { zoneId: 'habits', slotId: 'h2', kind: 'sprout', variant: 1 });
    expect(s1.resources.seed).toBe(s0.resources.seed - 1);
    expect(s1.plantings).toHaveLength(3);
    expect(isSlotEmpty(s1, 'habits', 'h2')).toBe(false);
  });

  it('refuses an occupied slot (same state back)', () => {
    const s0 = defaultGardenState();
    // h1 holds a gifted plant
    const s1 = plant(s0, { zoneId: 'habits', slotId: 'h1', kind: 'sprout', variant: 0 });
    expect(s1).toBe(s0);
  });

  it('refuses when out of seed', () => {
    const s0 = { ...defaultGardenState(), resources: { water: 9, seed: 0 } };
    const s1 = plant(s0, { zoneId: 'habits', slotId: 'h2', kind: 'sprout', variant: 0 });
    expect(s1).toBe(s0);
  });

  it('refuses an unknown slot', () => {
    const s0 = defaultGardenState();
    expect(plant(s0, { zoneId: 'habits', slotId: 'nope', kind: 'bush', variant: 0 })).toBe(s0);
  });

  it('refuses a locked zone', () => {
    const s0 = defaultGardenState();
    expect(plant(s0, { zoneId: 'finance', slotId: 'h1', kind: 'bush', variant: 0 })).toBe(s0);
  });
});

describe('growPlant', () => {
  it('grows a plant one stage, spending one water', () => {
    const s0 = defaultGardenState();
    const id = s0.plantings[0].id;
    const s1 = growPlant(s0, id);
    expect(s1.resources.water).toBe(s0.resources.water - 1);
    expect(s1.plantings[0].growth).toBe(s0.plantings[0].growth + 1);
  });

  it('refuses to grow past the max', () => {
    const s0 = defaultGardenState();
    const s = { ...s0, plantings: [{ ...s0.plantings[0], growth: PLANT_MAX_GROWTH }] };
    expect(growPlant(s, s.plantings[0].id)).toBe(s);
  });

  it('refuses when out of water', () => {
    const s0 = { ...defaultGardenState(), resources: { water: 0, seed: 3 } };
    expect(growPlant(s0, s0.plantings[0].id)).toBe(s0);
  });
});

describe('waterBurhan', () => {
  it('advances burhanWater, spending one water', () => {
    const s0 = defaultGardenState();
    const s1 = waterBurhan(s0);
    expect(s1.burhanWater).toBe(1);
    expect(s1.resources.water).toBe(s0.resources.water - 1);
  });

  it('refuses when out of water', () => {
    const s0 = { ...defaultGardenState(), resources: { water: 0, seed: 0 } };
    expect(waterBurhan(s0)).toBe(s0);
  });
});

describe('unlockZone', () => {
  it('reveals a new zone', () => {
    const s1 = unlockZone(defaultGardenState(), 'finance');
    expect(s1.zonesUnlocked).toContain('finance');
  });

  it('is idempotent for an already-open zone', () => {
    const s0 = defaultGardenState();
    expect(unlockZone(s0, 'habits')).toBe(s0);
  });
});

describe('applyCredit', () => {
  it('adds resources and advances the ledger', () => {
    const s0 = defaultGardenState();
    const s1 = applyCredit(s0, { water: 4, seed: 1 }, 4);
    expect(s1.resources.water).toBe(s0.resources.water + 4);
    expect(s1.resources.seed).toBe(s0.resources.seed + 1);
    expect(s1.ledgerCount).toBe(4);
  });

  it('ignores a stale ledger count', () => {
    const s0 = { ...defaultGardenState(), ledgerCount: 10 };
    expect(applyCredit(s0, { water: 4, seed: 1 }, 4)).toBe(s0);
  });
});
