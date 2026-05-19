/**
 * selectPhoneTasks · pure-selector unit tests
 *
 * The "calls to make" cluster groups open `phone_assist` tasks. This pins
 * the selector that builds the group: tagged + open only, oldest-first.
 */

import { describe, it, expect, vi } from 'vitest';

// AdminModule imports `../../store`, which boots the orchestrator at module
// load. Stub it — we only want the pure selector.
vi.mock('../../store', () => ({
  store: { get: () => undefined, set: () => {}, subscribe: () => () => {} },
  useStoreSlice: <T,>(_mod: string, _key: string, defaultValue: T) =>
    [defaultValue, () => {}] as [T, (v: T) => void],
  reminderScheduler: { add: () => {}, init: () => {} },
}));

import { selectPhoneTasks } from './AdminModule';

// AdminItemRow is module-private; selectPhoneTasks accepts AdminItemRow[].
// Tests build plain task-shaped objects and cast at the call site.
type Row = NonNullable<Parameters<typeof selectPhoneTasks>[0]>[number];

function task(over: Record<string, unknown> = {}): Row {
  return {
    id: 't',
    title: 'call the dmv',
    phone_assist: true,
    state: 'active',
    ts: 1000,
    _daysLeft: null,
    ...over,
  } as unknown as Row;
}

describe('selectPhoneTasks', () => {
  it('returns [] for null / undefined / empty', () => {
    expect(selectPhoneTasks(null)).toEqual([]);
    expect(selectPhoneTasks(undefined)).toEqual([]);
    expect(selectPhoneTasks([])).toEqual([]);
  });

  it('keeps only phone_assist tasks', () => {
    const items = [
      task({ id: 'phone', phone_assist: true }),
      task({ id: 'normal', phone_assist: false }),
      task({ id: 'untagged', phone_assist: undefined }),
    ];
    expect(selectPhoneTasks(items).map((t) => t.id)).toEqual(['phone']);
  });

  it('drops closed phone tasks', () => {
    const items = [
      task({ id: 'open', state: 'active' }),
      task({ id: 'closed', state: 'closed' }),
      task({ id: 'done-status', state: undefined, status: 'done' }),
    ];
    expect(selectPhoneTasks(items).map((t) => t.id)).toEqual(['open']);
  });

  it('keeps a done (not closed) phone task — still needs the call logged', () => {
    const items = [task({ id: 'd', state: 'done' })];
    expect(selectPhoneTasks(items).map((t) => t.id)).toEqual(['d']);
  });

  it('sorts oldest-first so the longest-waiting call is on top', () => {
    const items = [
      task({ id: 'new', ts: 300 }),
      task({ id: 'old', ts: 100 }),
      task({ id: 'mid', ts: 200 }),
    ];
    expect(selectPhoneTasks(items).map((t) => t.id)).toEqual(['old', 'mid', 'new']);
  });

  it('drops phone tasks with no title or label', () => {
    const items = [
      task({ id: 'titled', title: 'call bank' }),
      task({ id: 'blank', title: undefined, label: undefined }),
      task({ id: 'labelled', title: undefined, label: 'call vet' }),
    ];
    expect(selectPhoneTasks(items).map((t) => t.id).sort()).toEqual(['labelled', 'titled']);
  });

  it('tolerates null entries in the array', () => {
    const items = [null, task({ id: 'real' }), undefined] as unknown as Row[];
    expect(selectPhoneTasks(items).map((t) => t.id)).toEqual(['real']);
  });
});
