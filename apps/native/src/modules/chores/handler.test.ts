/**
 * Chores module · handler unit tests
 *
 * Coverage:
 *   - chore_done → markDone(name) called; recurring vs one-off note
 *   - add_chore → upsert one_off + undo removes by id
 *   - add_recurring_chore → upsert recurring with cadenceDays + undo removes
 *   - add_recurring_chore with missing cadence → defaults to 7 days
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateChores: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  chores: {
    markDone: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { chores } from './repo';
import { choresHandler } from './handler';
import type { Fragment } from '../../router/schema';

function frag(payload: Record<string, unknown>): Fragment {
  return {
    text: 'chore',
    language: 'en',
    module: 'chores',
    payload: { module: 'chores', ...payload } as Fragment['payload'],
    confidence: 0.9,
    source: 'ai',
  };
}

describe('choresHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chore_done: marks the chore done (recurring → clock reset note)', async () => {
    vi.mocked(chores.markDone).mockResolvedValue({
      id: 'c1', name: 'vacuum', kind: 'recurring', cadenceDays: 7, weekdays: null,
      lastDoneAt: Date.now(), done: false, createdAt: 0,
    });
    const result = await choresHandler.apply(frag({ action: 'chore_done', chore: 'vacuumed' }));
    expect(result.ok).toBe(true);
    expect(vi.mocked(chores.markDone)).toHaveBeenCalledWith('vacuumed');
    expect(result.note).toContain('clock reset');
  });

  it('chore_done: one-off → plain done note, no clock reset', async () => {
    vi.mocked(chores.markDone).mockResolvedValue({
      id: 'c2', name: 'clean the kitchen', kind: 'one_off', cadenceDays: null, weekdays: null,
      lastDoneAt: Date.now(), done: true, createdAt: 0,
    });
    const result = await choresHandler.apply(frag({ action: 'chore_done', chore: 'cleaned the kitchen' }));
    expect(result.ok).toBe(true);
    expect(result.note).not.toContain('clock reset');
  });

  it('add_chore: upserts a one_off and undo removes it by id', async () => {
    vi.mocked(chores.upsert).mockResolvedValue({
      id: 'c3', name: 'clean the bathroom', kind: 'one_off', cadenceDays: null, weekdays: null,
      lastDoneAt: null, done: false, createdAt: 0,
    });
    const result = await choresHandler.apply(frag({ action: 'add_chore', chore: 'clean the bathroom' }));
    expect(vi.mocked(chores.upsert)).toHaveBeenCalledWith({ name: 'clean the bathroom', kind: 'one_off' });
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(chores.remove)).toHaveBeenCalledWith('c3');
  });

  it('add_recurring_chore: passes cadenceDays through and undo removes', async () => {
    vi.mocked(chores.upsert).mockResolvedValue({
      id: 'c4', name: 'do laundry', kind: 'recurring', cadenceDays: 7, weekdays: null,
      lastDoneAt: null, done: false, createdAt: 0,
    });
    const result = await choresHandler.apply(
      frag({ action: 'add_recurring_chore', chore: 'do laundry', cadenceDays: 7 }),
    );
    expect(vi.mocked(chores.upsert)).toHaveBeenCalledWith({
      name: 'do laundry', kind: 'recurring', cadenceDays: 7, weekdays: null,
    });
    expect(result.note).toContain('every 7 days');
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(chores.remove)).toHaveBeenCalledWith('c4');
  });

  it('add_recurring_chore: missing cadence defaults to 7 days', async () => {
    vi.mocked(chores.upsert).mockResolvedValue({
      id: 'c5', name: 'mop', kind: 'recurring', cadenceDays: 7, weekdays: null,
      lastDoneAt: null, done: false, createdAt: 0,
    });
    await choresHandler.apply(frag({ action: 'add_recurring_chore', chore: 'mop' }));
    expect(vi.mocked(chores.upsert)).toHaveBeenCalledWith({
      name: 'mop', kind: 'recurring', cadenceDays: 7, weekdays: null,
    });
  });

  it('add_recurring_chore: weekday-anchored stores weekdays, no interval cadence', async () => {
    vi.mocked(chores.upsert).mockResolvedValue({
      id: 'c6', name: 'do laundry', kind: 'recurring', cadenceDays: null, weekdays: [3],
      lastDoneAt: null, done: false, createdAt: 0,
    });
    const result = await choresHandler.apply(
      frag({ action: 'add_recurring_chore', chore: 'do laundry', weekdays: [3] }),
    );
    // weekdays win → cadenceDays null (recurs by day, not interval).
    expect(vi.mocked(chores.upsert)).toHaveBeenCalledWith({
      name: 'do laundry', kind: 'recurring', cadenceDays: null, weekdays: [3],
    });
    expect(result.note).toContain('wednesdays');
    expect(result.note).not.toContain('every');
  });
});
