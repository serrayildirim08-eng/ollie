import { describe, it, expect } from 'vitest';
import {
  takenToday,
  takenCountToday,
  dosesRemainingToday,
  dueSlotsToday,
  adherenceReport,
  isoDate,
  type MedicationItem,
} from '../src/medication/index';

const DAY = 86_400_000;
const now = Date.parse('2026-05-13T15:00:00');

function mk(overrides: Partial<MedicationItem> = {}): MedicationItem {
  return {
    id: 'm1',
    name: 'vitamin d',
    kind: 'vitamin',
    schedule: ['08:00', '20:00'],
    taken: [],
    created_at: now - 20 * DAY,
    ...overrides,
  };
}

describe('medication · daily state', () => {
  it('takenToday false when nothing logged', () => {
    expect(takenToday(mk(), now)).toBe(false);
  });
  it('takenToday true after a log', () => {
    const item = mk({ taken: [{ date: isoDate(now), time: '08:30', ts: now }] });
    expect(takenToday(item, now)).toBe(true);
    expect(takenCountToday(item, now)).toBe(1);
  });
  it('dosesRemainingToday respects schedule', () => {
    const item = mk({ taken: [{ date: isoDate(now), time: '08:30', ts: now }] });
    expect(dosesRemainingToday(item, now)).toBe(1);
  });
  it('zero remaining when fully logged', () => {
    const item = mk({ taken: [
      { date: isoDate(now), time: '08:30', ts: now - 3 * 3600_000 },
      { date: isoDate(now), time: '20:30', ts: now },
    ]});
    expect(dosesRemainingToday(item, now)).toBe(0);
  });
});

describe('medication · dueSlotsToday', () => {
  it('marks 08:00 slot overdue at 15:00 when not logged', () => {
    const slots = dueSlotsToday(mk(), now);
    expect(slots.find((s) => s.slot_hhmm === '08:00')?.overdue).toBe(true);
    expect(slots.find((s) => s.slot_hhmm === '20:00')?.overdue).toBe(false);
  });
  it('does not mark overdue if log matches the slot window', () => {
    const item = mk({ taken: [{ date: isoDate(now), time: '08:15', ts: now - 3600_000 }] });
    const slots = dueSlotsToday(item, now);
    expect(slots.find((s) => s.slot_hhmm === '08:00')?.overdue).toBe(false);
  });
  it('skips archived items', () => {
    expect(dueSlotsToday(mk({ archived: true }), now)).toHaveLength(0);
  });
  it('ignores manual-only items (empty schedule)', () => {
    expect(dueSlotsToday(mk({ schedule: [] }), now)).toHaveLength(0);
  });
});

describe('medication · adherence drift', () => {
  it('returns null when item is too new', () => {
    expect(adherenceReport(mk({ created_at: now - 3 * DAY }), now)).toBeNull();
  });
  it('returns null for manual-only items', () => {
    expect(adherenceReport(mk({ schedule: [], created_at: now - 20 * DAY }), now)).toBeNull();
  });
  it('detects drift below threshold', () => {
    const item = mk({ created_at: now - 20 * DAY, taken: [] });
    const r = adherenceReport(item, now);
    expect(r).not.toBeNull();
    expect(r!.drift).toBe(true);
    expect(r!.copy).toMatch(/pattern, not medical/);
  });
  it('clean adherence has no drift flag + uses "noted." copy', () => {
    const taken = [];
    for (let i = 0; i < 14; i++) {
      const ts = now - i * DAY;
      taken.push({ date: isoDate(ts), time: '08:30', ts });
      taken.push({ date: isoDate(ts), time: '20:30', ts });
    }
    const r = adherenceReport(mk({ taken, created_at: now - 20 * DAY }), now);
    expect(r!.drift).toBe(false);
    expect(r!.copy).toMatch(/noted\./);
  });
  it('NO shame copy under any condition', () => {
    const r = adherenceReport(mk({ created_at: now - 20 * DAY }), now);
    expect(r!.copy).not.toMatch(/missed|failed|broken|streak|great job/i);
  });
});
