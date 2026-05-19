/**
 * admin-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `admin.tasks` slice into the v2 view-models, deriving the renewal hero,
 * the task list, the ball-state grammar, the phone-call cluster, the
 * 2-min burst set and the patterns through `@ollie/logic/admin`. These
 * tests verify the bridge. Mirrors body-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import {
  fmtLongDate,
  fmtClockDay,
  taskTitle,
  taskState,
  isFinished,
  taskDueTs,
  daysLeft,
  relDays,
  relAge,
  waitedDays,
  ballOf,
  ballWords,
  ballSentence,
  runwayPosition,
  faceVM,
  tasksVM,
  taskDetailVM,
  callsVM,
  selectCalls,
  burstVM,
  patternsVM,
  patternSummary,
  notificationsVM,
  type AdminSlices,
  type AdminItem,
} from './selectors';

const NOW = new Date('2026-05-18T12:00:00Z').getTime();
const DAY = 86_400_000;

function slices(tasks: AdminItem[]): AdminSlices {
  return { tasks };
}

/** a minimal active task */
function task(over: Partial<AdminItem>): AdminItem {
  return {
    id: 'ad-1',
    label: 'a task',
    kind: 'task',
    state: 'active',
    ball_state: 'MINE',
    category: 'other',
    ts: NOW - 14 * DAY,
    ...over,
  };
}

// ─── formatters ──────────────────────────────────────────────────────────────

describe('admin-v2 formatters', () => {
  it('fmtLongDate renders a calm long date', () => {
    expect(fmtLongDate(new Date('2026-06-17T00:00:00').getTime())).toBe('june 17, 2026');
  });

  it('fmtClockDay renders the lock-screen day line', () => {
    const d = fmtClockDay(NOW);
    expect(d).toMatch(/^[a-z]+, [a-z]{3} \d+$/);
  });

  it('relDays is factual, never an alarm', () => {
    expect(relDays(null)).toBe('no date');
    expect(relDays(-3)).toBe('3d overdue');
    expect(relDays(0)).toBe('today');
    expect(relDays(1)).toBe('tomorrow');
    expect(relDays(30)).toBe('4 weeks');
    expect(relDays(90)).toBe('3 months');
  });

  it('relAge reads as a calm "added N ago" line', () => {
    expect(relAge(NOW, NOW)).toBe('added today');
    expect(relAge(NOW - 14 * DAY, NOW)).toBe('added 2 weeks ago');
    expect(relAge(undefined, NOW)).toBe('added recently');
  });

  it('waitedDays counts whole days, never negative', () => {
    expect(waitedDays(NOW - 11 * DAY, NOW)).toBe(11);
    expect(waitedDays(NOW + DAY, NOW)).toBe(0);
    expect(waitedDays(undefined, NOW)).toBe(0);
  });
});

// ─── task field resolution ───────────────────────────────────────────────────

describe('admin-v2 task field resolution', () => {
  it('taskTitle prefers label, falls back to legacy title', () => {
    expect(taskTitle(task({ label: 'renew passport' }))).toBe('renew passport');
    expect(taskTitle(task({ label: undefined, title: 'old title' }))).toBe('old title');
    expect(taskTitle(null)).toBe('a task');
  });

  it('taskState resolves legacy status → canonical state', () => {
    expect(taskState(task({ state: 'active' }))).toBe('active');
    expect(taskState(task({ state: undefined, status: 'done' }))).toBe('closed');
  });

  it('isFinished is true for done and closed', () => {
    expect(isFinished(task({ state: 'active' }))).toBe(false);
    expect(isFinished(task({ state: 'done' }))).toBe(true);
    expect(isFinished(task({ state: 'closed' }))).toBe(true);
  });

  it('taskDueTs prefers numeric expiry_ts, falls back to the ISO due string', () => {
    expect(taskDueTs(task({ expiry_ts: NOW + 5 * DAY }))).toBe(NOW + 5 * DAY);
    const iso = task({ expiry_ts: undefined, due: '2026-06-17' });
    expect(taskDueTs(iso)).toBe(new Date('2026-06-17T00:00:00').getTime());
    expect(taskDueTs(task({ expiry_ts: undefined, due: null }))).toBeNull();
  });

  it('daysLeft is whole days, negative when overdue', () => {
    expect(daysLeft(NOW + 30 * DAY, NOW)).toBe(30);
    expect(daysLeft(NOW - 2 * DAY, NOW)).toBe(-2);
  });
});

// ─── ball-state grammar ──────────────────────────────────────────────────────

describe('admin-v2 ball-state grammar', () => {
  it('ballOf defaults to MINE', () => {
    expect(ballOf(task({ ball_state: undefined }))).toBe('MINE');
    expect(ballOf(task({ ball_state: 'THEIRS' }))).toBe('THEIRS');
    expect(ballOf(task({ ball_state: 'WAITING' }))).toBe('WAITING');
  });

  it('ballWords + ballSentence read calm, never shaming', () => {
    expect(ballWords('MINE')).toBe('yours to move');
    expect(ballWords('THEIRS')).toBe('with them');
    expect(ballSentence('MINE')).toContain('yours');
    expect(ballSentence('THEIRS')).toContain('waiting on someone');
  });
});

// ─── runway position ─────────────────────────────────────────────────────────

describe('admin-v2 runwayPosition', () => {
  it('clamps 90+ days to the start (1) and overdue to the end (0)', () => {
    expect(runwayPosition(120)).toBe(1);
    expect(runwayPosition(90)).toBe(1);
    expect(runwayPosition(45)).toBeCloseTo(0.5, 2);
    expect(runwayPosition(0)).toBe(0);
    expect(runwayPosition(-10)).toBe(0);
  });
});

// ─── face view-model ─────────────────────────────────────────────────────────

describe('admin-v2 faceVM', () => {
  it('cold: nothing tracked → no hero, no data', () => {
    const vm = faceVM(slices([]), NOW);
    expect(vm.hasAnyData).toBe(false);
    expect(vm.nextDue).toBeNull();
    expect(vm.activeCount).toBe(0);
  });

  it('picks the soonest-due active task as the next-thing hero', () => {
    const vm = faceVM(
      slices([
        task({ id: 'a', label: 'file taxes', expiry_ts: NOW + 21 * DAY }),
        task({
          id: 'b',
          label: 'renew passport',
          kind: 'renewal',
          category: 'renewal',
          expiry_ts: NOW + 30 * DAY,
        }),
        task({ id: 'c', label: 'no-date thing', expiry_ts: undefined, due: null }),
      ]),
      NOW,
    );
    expect(vm.nextDue?.title).toBe('file taxes');
    expect(vm.nextDue?.days).toBe(21);
    expect(vm.activeCount).toBe(3);
  });

  it('counts active tasks due within the week', () => {
    const vm = faceVM(
      slices([
        task({ id: 'a', expiry_ts: NOW + 3 * DAY }),
        task({ id: 'b', expiry_ts: NOW + 5 * DAY }),
        task({ id: 'c', expiry_ts: NOW + 40 * DAY }),
      ]),
      NOW,
    );
    expect(vm.dueThisWeek).toBe(2);
  });

  it('finished tasks never become the hero', () => {
    const vm = faceVM(
      slices([
        task({ id: 'a', label: 'done one', state: 'closed', expiry_ts: NOW + DAY }),
        task({ id: 'b', label: 'live one', expiry_ts: NOW + 10 * DAY }),
      ]),
      NOW,
    );
    expect(vm.nextDue?.title).toBe('live one');
    expect(vm.activeCount).toBe(1);
  });
});

// ─── tasks view-model ────────────────────────────────────────────────────────

describe('admin-v2 tasksVM', () => {
  const list = [
    task({ id: 'a', label: 'soon', expiry_ts: NOW + 2 * DAY }),
    task({ id: 'b', label: 'later', expiry_ts: NOW + 40 * DAY }),
    task({ id: 'c', label: 'no-date', expiry_ts: undefined, due: null }),
    task({ id: 'd', label: 'finished', state: 'closed', closed_at: NOW - 2 * DAY }),
  ];

  it('the active filter excludes finished, orders by days-left, no-date last', () => {
    const vm = tasksVM(slices(list), 'active', NOW);
    expect(vm.rows.map((r) => r.title)).toEqual(['soon', 'later', 'no-date']);
    expect(vm.counts).toEqual({ active: 3, done: 1, all: 4 });
  });

  it('the done filter shows only finished tasks, struck', () => {
    const vm = tasksVM(slices(list), 'done', NOW);
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].done).toBe(true);
    expect(vm.rows[0].daysLine).toBe('done');
  });

  it('a soon (≤7d) task is flagged for the umber tint', () => {
    const vm = tasksVM(slices(list), 'active', NOW);
    expect(vm.rows[0].soon).toBe(true); // "soon" at +2d
    expect(vm.rows[1].soon).toBe(false); // "later" at +40d
  });

  it('a THEIRS task reads "their move", never a date', () => {
    const vm = tasksVM(
      slices([task({ id: 'x', label: 'with lawyer', ball_state: 'THEIRS', last_transition_at: NOW - 16 * DAY })]),
      'active',
      NOW,
    );
    expect(vm.rows[0].daysLine).toBe('their move');
    expect(vm.rows[0].sub).toContain('with them');
  });
});

// ─── task-detail view-model ──────────────────────────────────────────────────

describe('admin-v2 taskDetailVM', () => {
  it('returns exists:false for a missing task', () => {
    const vm = taskDetailVM(slices([]), 'nope', NOW);
    expect(vm.exists).toBe(false);
  });

  it('builds a calm meta line + ball sentence', () => {
    const vm = taskDetailVM(
      slices([
        task({
          id: 'p',
          label: 'renew passport',
          kind: 'renewal',
          category: 'renewal',
          expiry_ts: NOW + 30 * DAY,
          ts: NOW - 14 * DAY,
        }),
      ]),
      'p',
      NOW,
    );
    expect(vm.exists).toBe(true);
    expect(vm.title).toBe('renew passport');
    expect(vm.meta).toContain('30 days left');
    expect(vm.meta).toContain('2 weeks ago');
    expect(vm.ballSentence).toContain('yours');
  });

  it('reads the defer count and the doc refs', () => {
    const vm = taskDetailVM(
      slices([
        task({
          id: 'd',
          defer_count: 2,
          doc_refs: [{ label: 'old passport scan', link: 'photos' }],
        }),
      ]),
      'd',
      NOW,
    );
    expect(vm.deferCount).toBe(2);
    expect(vm.deferLine).toContain('2 times');
    expect(vm.docs).toHaveLength(1);
    expect(vm.docs[0].label).toBe('old passport scan');
  });

  it('hides the split row when the task is already split', () => {
    const vm = taskDetailVM(slices([task({ id: 's', stage: 'GATHER' })]), 's', NOW);
    expect(vm.alreadySplit).toBe(true);
  });
});

// ─── calls cluster ───────────────────────────────────────────────────────────

describe('admin-v2 calls cluster', () => {
  it('selectCalls gathers open phone_assist tasks, oldest first', () => {
    const list = [
      task({ id: 'new', label: 'new call', phone_assist: true, ts: NOW - 2 * DAY }),
      task({ id: 'old', label: 'old call', phone_assist: true, ts: NOW - 11 * DAY }),
      task({ id: 'plain', label: 'not a call' }),
      task({ id: 'done', label: 'done call', phone_assist: true, state: 'closed' }),
    ];
    const calls = selectCalls(slices(list));
    expect(calls.map((c) => c.id)).toEqual(['old', 'new']);
  });

  it('callsVM marks the oldest call + a calm wait line', () => {
    const vm = callsVM(
      slices([
        task({ id: 'old', label: 'passport office', phone_assist: true, ts: NOW - 11 * DAY }),
        task({ id: 'new', label: 'dentist', phone_assist: true, ts: NOW - 2 * DAY }),
      ]),
      NOW,
    );
    expect(vm.calls[0].oldest).toBe(true);
    expect(vm.calls[0].waitLine).toBe('waiting · 11 days');
    expect(vm.calls[1].oldest).toBe(false);
  });
});

// ─── 2-min burst ─────────────────────────────────────────────────────────────

describe('admin-v2 burstVM', () => {
  it('gathers only the sub-2-min active tasks', () => {
    const vm = burstVM(
      slices([
        task({ id: 'q1', label: 'quick one', duration_min: 1 }),
        task({ id: 'q2', label: 'quick two', duration_min: 2 }),
        task({ id: 'big', label: 'big one', duration_min: 30 }),
        task({ id: 'done-q', label: 'done quick', duration_min: 1, state: 'done' }),
      ]),
      NOW,
    );
    expect(vm.tasks.map((t) => t.title)).toEqual(['quick one', 'quick two']);
  });

  it('empty when nothing qualifies', () => {
    expect(burstVM(slices([task({ id: 'x', duration_min: 60 })]), NOW).tasks).toHaveLength(0);
  });
});

// ─── patterns ────────────────────────────────────────────────────────────────

describe('admin-v2 patternsVM', () => {
  it('falls back to the honest labelled example set when nothing is observed', () => {
    const vm = patternsVM(slices([]), NOW);
    expect(vm.isExample).toBe(true);
    expect(vm.groups.length).toBeGreaterThan(0);
    expect(patternSummary(slices([]), NOW)).toBeNull();
  });

  it('surfaces a live defer-chain pattern from the task slice', () => {
    const vm = patternsVM(
      slices([task({ id: 'tax', label: 'file taxes', defer_count: 6 })]),
      NOW,
    );
    expect(vm.isExample).toBe(false);
    const allLines = vm.groups.flatMap((g) => g.lines);
    expect(allLines.some((l) => l.cite.includes('A6'))).toBe(true);
    expect(patternSummary(slices([task({ id: 'tax', label: 'file taxes', defer_count: 6 })]), NOW))
      .toContain('noticed');
  });

  it('surfaces a live last-5% pattern (done but never closed)', () => {
    const vm = patternsVM(
      slices([
        task({
          id: 'form',
          label: 'visa form',
          state: 'done',
          done_at: NOW - 8 * DAY,
        }),
      ]),
      NOW,
    );
    expect(vm.isExample).toBe(false);
    const allLines = vm.groups.flatMap((g) => g.lines);
    expect(allLines.some((l) => l.cite.includes('A12'))).toBe(true);
  });
});

// ─── notifications reel ──────────────────────────────────────────────────────

describe('admin-v2 notificationsVM', () => {
  it('returns the seven-push curated reel', () => {
    const vm = notificationsVM(NOW);
    expect(vm.cards).toHaveLength(7);
    expect(vm.cards[0].glyph).toBe('renewal');
    expect(vm.cards[6].glyph).toBe('weekly');
    // every card carries calm lowercase copy
    for (const c of vm.cards) {
      expect(c.title).toBe(c.title.toLowerCase());
      expect(c.title).not.toContain('!');
    }
  });
});
