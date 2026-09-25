import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../todo/aggregateTodos';
import type { LedgerEntry } from '../notify/reminderLedger';
import { buildUpcoming, whenLabel } from './upcoming';

// Wed 2026-09-23 10:00 local
const NOW = new Date(2026, 8, 23, 10, 0).getTime();

function todo(rowId: string, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    id: `admin:${rowId}`,
    source: 'admin',
    action: 'create_task',
    text: rowId,
    createdAt: 1,
    rowId,
    kind: 'task',
    ...extra,
  };
}

function ledger(entries: Array<[string, number]>): Map<string, LedgerEntry> {
  return new Map(entries.map(([taskId, fireAt]) => [taskId, { taskId, title: '', body: '', fireAt }]));
}

describe('buildUpcoming', () => {
  it('places items by reminder time, falling back to due day', () => {
    const h = buildUpcoming(
      [
        todo('call-mom'),
        todo('rent', { date: '2026-09-26' }),
        todo('visa', { date: '2026-10-12' }),
        todo('far', { date: '2026-12-30' }),
        todo('someday'),
      ],
      ledger([['call-mom', new Date(2026, 8, 23, 14, 0).getTime()]]),
      NOW,
    );
    const map = Object.fromEntries(h.map((x) => [x.id, x.items.map((i) => i.text)]));
    expect(map).toEqual({
      today: ['call-mom'],
      thisWeek: ['rent'],
      thisMonth: ['visa'],
      anytime: ['someday'],
    });
  });

  it('keeps an already-fired reminder on today while the task is open', () => {
    const h = buildUpcoming([todo('late')], ledger([['late', NOW - 3_600_000]]), NOW);
    expect(h[0]?.id).toBe('today');
  });

  it('reminder time wins over due date', () => {
    const h = buildUpcoming(
      [todo('x', { date: '2026-10-20' })],
      ledger([['x', new Date(2026, 8, 24, 9, 0).getTime()]]),
      NOW,
    );
    expect(h[0]?.id).toBe('thisWeek');
    expect(h[0]?.items[0]?.hasTime).toBe(true);
  });

  it('drops grocery rows and sorts by time', () => {
    const h = buildUpcoming(
      [
        todo('b', { date: '2026-09-25' }),
        todo('a', { date: '2026-09-24' }),
        todo('milk', { source: 'grocery', date: '2026-09-24' }),
      ],
      new Map(),
      NOW,
    );
    expect(h).toHaveLength(1);
    expect(h[0]?.items.map((i) => i.text)).toEqual(['a', 'b']);
  });

  it('ignores ledger entries for decision rows', () => {
    const h = buildUpcoming([todo('d', { kind: 'decision' })], ledger([['d', NOW + 1000]]), NOW);
    expect(h[0]?.id).toBe('anytime');
  });
});

describe('whenLabel', () => {
  it('formats per horizon', () => {
    const [h] = buildUpcoming(
      [todo('t')],
      ledger([['t', new Date(2026, 8, 25, 14, 5).getTime()]]),
      NOW,
    );
    expect(whenLabel(h!.items[0]!, 'thisWeek', NOW)).toBe('fri 14:05');
    expect(whenLabel(h!.items[0]!, 'today', NOW)).toBe('14:05');
    expect(whenLabel(h!.items[0]!, 'thisMonth', NOW)).toBe('25 sep 14:05');
  });

  it('leaves day-only items due today unlabeled', () => {
    const [h] = buildUpcoming([todo('now', { date: '2026-09-23' })], new Map(), NOW);
    expect(whenLabel(h!.items[0]!, 'today', NOW)).toBe('');
  });

  it('marks past day-only items overdue', () => {
    const [h] = buildUpcoming([todo('old', { date: '2026-09-20' })], new Map(), NOW);
    expect(whenLabel(h!.items[0]!, 'today', NOW)).toBe('overdue');
  });
});
