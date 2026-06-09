/**
 * Mood module · handler unit tests
 *
 * Coverage:
 *   1. log_mood   → persists kind='mood' + undo removes the row
 *   2. log_energy → persists kind='energy' + undo removes the row
 *   3. self_talk  → persists kind='self_talk' + undo removes the row
 *   4. unknown action → ok:false 'unknown mood action'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('./migrate', () => ({
  migrateMood: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  events: {
    add: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── imports after mocks ───────────────────────────────────────────────────────

import { events } from './repo';
import { moodHandler } from './handler';
import type { Fragment } from '../../router/schema';
import type { MoodAction } from './types';

const mockEventsAdd = vi.mocked(events.add);
const mockEventsRemove = vi.mocked(events.remove);

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a Fragment around a MoodAction payload. `mood` is not yet in the
 * schema's `Module` union (Serra wires that herself), so the fragment is
 * assembled then cast — the handler only ever narrows `payload`.
 */
function makeFragment(payload: MoodAction): Fragment {
  return {
    text: 'mood dump',
    language: 'en',
    module: 'mood',
    payload,
    confidence: 0.9,
    source: 'ai',
  } as unknown as Fragment;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('moodHandler — actions persist + undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_mood: persists kind=mood and undo removes the row', async () => {
    mockEventsAdd.mockResolvedValueOnce({
      id: 'mood-id',
      kind: 'mood',
      data: {},
      loggedAt: 1,
    });

    const result = await moodHandler.apply(
      makeFragment({ module: 'mood', action: 'log_mood', label: 'good', valence: 1 }),
    );

    expect(mockEventsAdd).toHaveBeenCalledOnce();
    expect(mockEventsAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'mood',
        data: expect.objectContaining({ label: 'good', valence: 1 }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.note).toContain('good');

    await result.undo?.();
    expect(mockEventsRemove).toHaveBeenCalledOnce();
    expect(mockEventsRemove).toHaveBeenCalledWith('mood-id');
  });

  it('log_energy: persists kind=energy and undo removes the row', async () => {
    mockEventsAdd.mockResolvedValueOnce({
      id: 'energy-id',
      kind: 'energy',
      data: {},
      loggedAt: 1,
    });

    const result = await moodHandler.apply(
      makeFragment({ module: 'mood', action: 'log_energy', level: 3, label: 'tired' }),
    );

    expect(mockEventsAdd).toHaveBeenCalledOnce();
    expect(mockEventsAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'energy',
        data: expect.objectContaining({ level: 3, label: 'tired' }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.note).toContain('3');

    await result.undo?.();
    expect(mockEventsRemove).toHaveBeenCalledOnce();
    expect(mockEventsRemove).toHaveBeenCalledWith('energy-id');
  });

  it('self_talk: persists kind=self_talk and undo removes the row', async () => {
    mockEventsAdd.mockResolvedValueOnce({
      id: 'talk-id',
      kind: 'self_talk',
      data: {},
      loggedAt: 1,
    });

    const result = await moodHandler.apply(
      makeFragment({
        module: 'mood',
        action: 'self_talk',
        statement: 'i can handle this',
        valence: 1,
      }),
    );

    expect(mockEventsAdd).toHaveBeenCalledOnce();
    expect(mockEventsAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'self_talk',
        data: expect.objectContaining({ statement: 'i can handle this', valence: 1 }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.note).toBe('noted');

    await result.undo?.();
    expect(mockEventsRemove).toHaveBeenCalledOnce();
    expect(mockEventsRemove).toHaveBeenCalledWith('talk-id');
  });

  it('unknown action: returns ok:false without persisting', async () => {
    const result = await moodHandler.apply(
      makeFragment({ action: 'bogus' } as unknown as MoodAction),
    );

    expect(mockEventsAdd).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.note).toBe('unknown mood action');
  });
});
