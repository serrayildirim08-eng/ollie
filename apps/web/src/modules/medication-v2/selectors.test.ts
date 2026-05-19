/**
 * medication-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `medication.*` slices into the v2 view-models. These tests verify the
 * bridge — the cold-vs-warm face, the next-dose pick, the day's dose dots,
 * the schedule parser and the fortnight adherence report. Mirrors
 * body-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import type { MedicationItem } from '@ollie/logic/medication';
import {
  fmtHHmm,
  clockOf,
  medDot,
  visibleMeds,
  parseSchedule,
  medicationFaceVM,
  adherenceLogVM,
  type MedicationSlices,
} from './selectors';

const NOW = new Date('2026-05-18T14:00:00').getTime();
const DAY = 86_400_000;

function emptySlices(): MedicationSlices {
  return { items: [], adherence: {} };
}

/** a `YYYY-MM-DD` for an offset of `daysAgo` from NOW */
function dayKey(daysAgo: number): string {
  const d = new Date(NOW - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** build a medication item with sane defaults */
function med(over: Partial<MedicationItem>): MedicationItem {
  return {
    id: 'm1',
    name: 'methylphenidate',
    kind: 'prescription',
    schedule: ['08:00', '14:00'],
    taken: [],
    created_at: NOW - 30 * DAY,
    ...over,
  };
}

describe('formatters', () => {
  it('fmtHHmm renders a calm 12h clock', () => {
    expect(fmtHHmm('08:00')).toBe('8:00am');
    expect(fmtHHmm('14:30')).toBe('2:30pm');
    expect(fmtHHmm('00:05')).toBe('12:05am');
    expect(fmtHHmm('12:00')).toBe('12:00pm');
  });

  it('fmtHHmm passes garbage through untouched', () => {
    expect(fmtHHmm('nope')).toBe('nope');
  });

  it('clockOf formats an epoch-ms timestamp', () => {
    expect(clockOf(new Date('2026-05-18T09:02:00').getTime())).toBe('9:02am');
    expect(clockOf(new Date('2026-05-18T20:00:00').getTime())).toBe('8:00pm');
  });
});

describe('medDot', () => {
  it('picks a colour by kind', () => {
    expect(medDot(med({ kind: 'prescription' }))).toBe('#C9923E');
    expect(medDot(med({ kind: 'vitamin' }))).toBe('#5B8C7E');
    expect(medDot(med({ kind: 'supplement' }))).toBe('#8C7BB0');
    expect(medDot(med({ kind: 'otc' }))).toBe('#B97A57');
  });

  it("prefers the med's own color_hex", () => {
    expect(medDot(med({ color_hex: '#123456' }))).toBe('#123456');
  });
});

describe('visibleMeds', () => {
  it('drops archived meds', () => {
    const s: MedicationSlices = {
      items: [med({ id: 'a' }), med({ id: 'b', archived: true })],
      adherence: {},
    };
    expect(visibleMeds(s).map((m) => m.id)).toEqual(['a']);
  });

  it('is defensive against non-arrays', () => {
    expect(
      visibleMeds({ items: null as unknown as MedicationItem[], adherence: {} }),
    ).toEqual([]);
  });
});

describe('parseSchedule', () => {
  it('parses comma-separated HH:MM into clean sorted slots', () => {
    const p = parseSchedule('14:00, 08:00');
    expect(p.slots).toEqual(['08:00', '14:00']);
    expect(p.labels).toEqual(['8:00am', '2:00pm']);
    expect(p.hint).toBe('two doses a day');
  });

  it('de-dupes and drops garbage', () => {
    const p = parseSchedule('08:00, 08:00, junk, 25:00');
    expect(p.slots).toEqual(['08:00']);
    expect(p.hint).toBe('one dose a day');
  });

  it('a blank schedule yields no slots and no hint', () => {
    const p = parseSchedule('');
    expect(p.slots).toEqual([]);
    expect(p.hint).toBe('');
  });
});

describe('medicationFaceVM — cold', () => {
  it('first run is cold: no meds, an empty take-circle', () => {
    const vm = medicationFaceVM(emptySlices(), NOW);
    expect(vm.hasMeds).toBe(false);
    expect(vm.hasNextDose).toBe(false);
    expect(vm.nextName).toBe('nothing on file yet');
    expect(vm.nextTime).toBe('–');
    expect(vm.nextCue).toBe('nothing to take');
    expect(vm.doseDots).toEqual([]);
    expect(vm.adherenceCold).toBe(true);
  });
});

describe('medicationFaceVM — warm', () => {
  it('picks the earliest un-logged slot as the next dose', () => {
    // 08:00 logged, 14:00 still due → next is 14:00
    const s: MedicationSlices = {
      items: [
        med({
          taken: [{ date: dayKey(0), time: '08:02', ts: NOW - 6 * 3_600_000 + 2 * 60_000 }],
        }),
      ],
      adherence: {},
    };
    const vm = medicationFaceVM(s, NOW);
    expect(vm.hasMeds).toBe(true);
    expect(vm.hasNextDose).toBe(true);
    expect(vm.nextName).toBe('methylphenidate');
    expect(vm.nextTime).toBe('2:00pm');
    expect(vm.nextItemId).toBe('m1');
  });

  it("the day's dose dots reflect taken / now / ahead", () => {
    const s: MedicationSlices = {
      items: [
        med({
          taken: [{ date: dayKey(0), time: '08:02', ts: NOW - 6 * 3_600_000 + 2 * 60_000 }],
        }),
      ],
      adherence: {},
    };
    const vm = medicationFaceVM(s, NOW);
    // one dose done, one due now (14:00 == NOW)
    expect(vm.doseDots).toEqual(['done', 'now']);
    expect(vm.dosesTaken).toBe(1);
    expect(vm.dosesScheduled).toBe(2);
  });

  it('falls back to "all done" when every dose is logged', () => {
    const s: MedicationSlices = {
      items: [
        med({
          schedule: ['08:00'],
          taken: [{ date: dayKey(0), time: '08:02', ts: NOW - 6 * 3_600_000 + 2 * 60_000 }],
        }),
      ],
      adherence: {},
    };
    const vm = medicationFaceVM(s, NOW);
    expect(vm.hasNextDose).toBe(false);
    expect(vm.nextName).toBe('all done for today');
  });

  it('a manual-only med appears in the list but never as a next dose', () => {
    const s: MedicationSlices = {
      items: [med({ id: 'mag', name: 'magnesium', kind: 'supplement', schedule: [] })],
      adherence: {},
    };
    const vm = medicationFaceVM(s, NOW);
    expect(vm.hasMeds).toBe(true);
    expect(vm.hasNextDose).toBe(false);
    expect(vm.meds[0].meta).toContain('manual log only');
    expect(vm.dosesScheduled).toBe(0);
  });

  it('a med taken today carries a sage tick + the logged time', () => {
    const s: MedicationSlices = {
      items: [
        med({
          taken: [{ date: dayKey(0), time: '08:02', ts: NOW - 6 * 3_600_000 + 2 * 60_000 }],
        }),
      ],
      adherence: {},
    };
    const vm = medicationFaceVM(s, NOW);
    expect(vm.meds[0].doneToday).toBe(true);
    expect(vm.meds[0].takenAt).toBe('8:02am');
  });
});

describe('adherenceLogVM', () => {
  it('is empty + honest with no meds', () => {
    const vm = adherenceLogVM(emptySlices(), NOW);
    expect(vm.hasMeds).toBe(false);
    expect(vm.today).toEqual([]);
    expect(vm.report).toEqual([]);
  });

  it("today's slots mark a taken dose with its logged time", () => {
    const s: MedicationSlices = {
      items: [
        med({
          taken: [{ date: dayKey(0), time: '08:02', ts: NOW - 6 * 3_600_000 + 2 * 60_000 }],
        }),
      ],
      adherence: {},
    };
    const vm = adherenceLogVM(s, NOW);
    expect(vm.today[0].slots[0].state).toBe('taken');
    expect(vm.today[0].slots[0].takenAt).toBe('8:02am');
    expect(vm.today[0].slots[1].state).toBe('due');
  });

  it('a manual-only med reports its raw log count', () => {
    const s: MedicationSlices = {
      items: [
        med({
          id: 'mag',
          name: 'magnesium',
          kind: 'supplement',
          schedule: [],
          taken: [
            { date: dayKey(1), time: '10:00', ts: NOW - DAY },
            { date: dayKey(2), time: '10:00', ts: NOW - 2 * DAY },
          ],
        }),
      ],
      adherence: {},
    };
    const vm = adherenceLogVM(s, NOW);
    expect(vm.today[0].manual).toBe(true);
    expect(vm.report[0].manual).toBe(true);
    expect(vm.report[0].manualCount).toBe(2);
  });

  it('a scheduled med carries a logged X of Y fortnight report', () => {
    // created 30 days ago so the 14-day window is observed; 14 logs in window
    const taken = [];
    for (let d = 0; d < 14; d++) {
      taken.push({ date: dayKey(d), time: '08:00', ts: NOW - d * DAY });
    }
    const s: MedicationSlices = {
      items: [med({ schedule: ['08:00'], taken })],
      adherence: {},
    };
    const vm = adherenceLogVM(s, NOW);
    expect(vm.report[0].report).not.toBeNull();
    expect(vm.report[0].report?.expected).toBe(14);
    expect(vm.report[0].report?.logged).toBe(14);
  });

  it('prefers the orchestrator-stored adherence report when present', () => {
    const s: MedicationSlices = {
      items: [med({ schedule: ['08:00'] })],
      adherence: {
        m1: {
          ratio: 0.9,
          logged: 25,
          expected: 28,
          windowDays: 14,
          drift: false,
          copy: 'noted.',
        },
      },
    };
    const vm = adherenceLogVM(s, NOW);
    expect(vm.report[0].report?.logged).toBe(25);
    expect(vm.report[0].report?.expected).toBe(28);
  });
});
