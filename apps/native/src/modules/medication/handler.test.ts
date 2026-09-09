/**
 * Medication module · handler unit tests
 *
 * Coverage:
 *   - log_dose: undo removes the event row by id; also counts the cabinet down
 *   - mark_taken: logs a dose + counts the cabinet down
 *   - add_to_cabinet: upserts the cabinet (+ purpose/dose/qty) and, when a
 *     schedule slot is given, adds it to the registry; undo removes the row
 *   - set_low / set_have: flips the manual low flag by name
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateMedication: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  events: {
    logDose: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logMissed: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logSideEffect: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  cabinet: {
    upsert: vi.fn().mockResolvedValue({ id: 'cab-id', name: 'magnesium', purpose: 'sleep' }),
    setLowByName: vi.fn().mockResolvedValue(undefined),
    decrementOnTaken: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  medications: {
    addScheduleSlots: vi.fn().mockResolvedValue(undefined),
  },
}));

import { events, cabinet, medications } from './repo';
import { medicationHandler } from './handler';
import type { Fragment } from '../../router/schema';

function frag(payload: Record<string, unknown>): Fragment {
  return {
    text: 'med',
    language: 'en',
    module: 'medication',
    payload: { module: 'medication', ...payload } as Fragment['payload'],
    confidence: 0.9,
    source: 'ai',
  };
}

describe('medicationHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_dose: undo removes the event row by id; counts cabinet down', async () => {
    const result = await medicationHandler.apply(
      frag({ action: 'log_dose', medName: 'adderall', dose: '20mg' }),
    );
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(events.remove)).toHaveBeenCalledWith('ev-id');
    expect(vi.mocked(cabinet.decrementOnTaken)).toHaveBeenCalledWith('adderall');
  });

  it('mark_taken: logs a dose + counts the cabinet down', async () => {
    const result = await medicationHandler.apply(
      frag({ action: 'mark_taken', medName: 'magnesium' }),
    );
    expect(result.ok).toBe(true);
    expect(vi.mocked(events.logDose)).toHaveBeenCalledWith({ medName: 'magnesium', dose: undefined });
    expect(vi.mocked(cabinet.decrementOnTaken)).toHaveBeenCalledWith('magnesium');
  });

  it('add_to_cabinet: upserts + adds schedule slot; undo removes the row', async () => {
    const result = await medicationHandler.apply(
      frag({
        action: 'add_to_cabinet',
        medName: 'magnesium',
        doseLabel: '400mg',
        purpose: 'sleep',
        schedule: ['21:00'],
      }),
    );
    expect(vi.mocked(cabinet.upsert)).toHaveBeenCalledWith({
      name: 'magnesium',
      purpose: 'sleep',
      doseLabel: '400mg',
      qty: undefined,
    });
    expect(vi.mocked(medications.addScheduleSlots)).toHaveBeenCalledWith('magnesium', ['21:00']);
    expect(result.note).toContain('scheduled');
    await result.undo!();
    expect(vi.mocked(cabinet.remove)).toHaveBeenCalledWith('cab-id');
  });

  it('add_to_cabinet: no schedule → no registry slot write', async () => {
    await medicationHandler.apply(
      frag({ action: 'add_to_cabinet', medName: 'vitamin d', purpose: 'vitamins' }),
    );
    expect(vi.mocked(medications.addScheduleSlots)).not.toHaveBeenCalled();
  });

  it('set_low: flags the med running low by name', async () => {
    await medicationHandler.apply(frag({ action: 'set_low', medName: 'vitamin d' }));
    expect(vi.mocked(cabinet.setLowByName)).toHaveBeenCalledWith('vitamin d', true);
  });

  it('set_have: clears the low flag by name', async () => {
    await medicationHandler.apply(frag({ action: 'set_have', medName: 'vitamin d' }));
    expect(vi.mocked(cabinet.setLowByName)).toHaveBeenCalledWith('vitamin d', false);
  });

  it('rejects a blank medName instead of creating a junk row', async () => {
    const result = await medicationHandler.apply(
      frag({ action: 'set_low', medName: '   ' }),
    );
    expect(result.ok).toBe(false);
    expect(vi.mocked(cabinet.setLowByName)).not.toHaveBeenCalled();
  });
});
