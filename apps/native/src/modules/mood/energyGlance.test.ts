/**
 * Mood · energy-glance test
 *
 * Covers the Health room's two new read-only consumers of the mood log:
 *   - `energyGlanceLabel` — derives a calm lowercase word for the glance tile
 *     (prefers a typed label, else maps a 1–5 level, else null → resting).
 *   - `events.latestEnergyOrMood` — returns the most-recent energy/mood row
 *     (energy preferred by recency, mood as fallback), round-tripped through a
 *     real in-memory SQLite engine — same shim shape the other repo tests use.
 */

import { createRequire } from 'node:module';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const mockDb = new DatabaseSync(':memory:');

vi.mock('../../storage/sqlite', () => ({
  sql: {
    async execute(query: string, params: unknown[] = []) {
      mockDb.prepare(query).run(...(params as never[]));
      return { rowsAffected: 0 };
    },
    async select<T>(query: string, params: unknown[] = []): Promise<T[]> {
      return mockDb.prepare(query).all(...(params as never[])) as T[];
    },
  },
}));

import { migrateMood } from './migrate';
import { events } from './repo';
import { energyGlanceLabel } from './types';
import type { MoodEvent } from './types';

/** Seed a row at an exact timestamp (no public back-dating API). */
function seed(id: string, kind: string, data: Record<string, unknown>, loggedAt: number): void {
  mockDb
    .prepare('INSERT INTO mood_events (id, kind, data, logged_at) VALUES (?, ?, ?, ?)')
    .run(id, kind, JSON.stringify(data), loggedAt);
}

function ev(partial: Partial<MoodEvent>): MoodEvent {
  return { id: 'x', kind: 'energy', data: {}, loggedAt: 0, ...partial };
}

describe('energyGlanceLabel', () => {
  it('returns null for no event (tile falls back to resting)', () => {
    expect(energyGlanceLabel(null)).toBeNull();
  });

  it('prefers a typed label, lowercased', () => {
    expect(energyGlanceLabel(ev({ data: { label: 'Wired But Tired' } }))).toBe('wired but tired');
  });

  it('maps numeric energy levels onto calm words', () => {
    expect(energyGlanceLabel(ev({ data: { level: 1 } }))).toBe('very low');
    expect(energyGlanceLabel(ev({ data: { level: 2 } }))).toBe('low-ish');
    expect(energyGlanceLabel(ev({ data: { level: 3 } }))).toBe('steady');
    expect(energyGlanceLabel(ev({ data: { level: 4 } }))).toBe('good');
    expect(energyGlanceLabel(ev({ data: { level: 5 } }))).toBe('high');
  });

  it('clamps out-of-range levels rather than fabricating', () => {
    expect(energyGlanceLabel(ev({ data: { level: 9 } }))).toBe('high');
    expect(energyGlanceLabel(ev({ data: { level: -3 } }))).toBe('very low');
  });

  it('returns null when neither label nor level is present', () => {
    expect(energyGlanceLabel(ev({ data: {} }))).toBeNull();
  });
});

describe('events.latestEnergyOrMood', () => {
  // migrateMood memoises a module-level promise, so it must run exactly once;
  // the in-memory db is fresh per file run. Clear rows between cases.
  beforeAll(async () => {
    await migrateMood();
  });
  beforeEach(() => {
    mockDb.exec('DELETE FROM mood_events');
  });

  it('returns null when nothing is logged', async () => {
    expect(await events.latestEnergyOrMood()).toBeNull();
  });

  it('returns the most-recent energy event', async () => {
    seed('a', 'energy', { level: 2 }, 1000);
    seed('b', 'energy', { level: 4 }, 2000);
    const got = await events.latestEnergyOrMood();
    expect(got?.id).toBe('b');
    expect(energyGlanceLabel(got)).toBe('good');
  });

  it('falls back to a mood event when it is the most recent reading', async () => {
    seed('m', 'mood', { label: 'foggy' }, 3000);
    seed('e', 'energy', { level: 3 }, 1000);
    const got = await events.latestEnergyOrMood();
    expect(got?.id).toBe('m');
    expect(energyGlanceLabel(got)).toBe('foggy');
  });

  it('ignores self_talk rows', async () => {
    seed('s', 'self_talk', { statement: 'i can do hard things' }, 5000);
    seed('e', 'energy', { level: 5 }, 1000);
    const got = await events.latestEnergyOrMood();
    expect(got?.id).toBe('e');
  });
});
