/**
 * aggregateTodos · pure-function tests.
 *
 * No React, no SQL, no Date.now() leaks — every test pins `today` and
 * `createdAt` explicitly. Covers:
 *   - per-source normalization (display copy + date extraction)
 *   - sort (dated ascending, undated newest-first)
 *   - bucketing (today / this week / later / no date)
 *   - admin paperwork + decision drop out of the aggregate
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateTodos,
  bucketTodos,
  getGroceryLeakCount,
  isoToday,
  normalizeAdminRenewal,
  normalizeAdminTask,
  normalizeGroceryShopping,
  normalizeRecurringDecision,
  normalizePendingDecision,
  normalizeWorkTask,
  sortTodos,
  type TodoItem,
} from './aggregateTodos';
import type { AdminRenewal, AdminTask, RecurringDecisionRow } from '../modules/admin/types';
import type { ShoppingItem } from '../modules/grocery/types';
import type { PendingDecisionRow } from '../modules/finance/repo';
import type { WorkTask } from '../modules/work/types';

// ─── helpers ──────────────────────────────────────────────────────────────

const TS = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);

function adminTask(over: Partial<AdminTask> & { id: string }): AdminTask {
  return {
    id: over.id,
    kind: over.kind ?? 'task',
    text: over.text ?? 'untitled',
    data: over.data ?? ({ kind: over.kind ?? 'task' } as AdminTask['data']),
    done: over.done ?? false,
    createdAt: over.createdAt ?? TS('2026-05-29'),
  };
}

function adminRenewal(over: Partial<AdminRenewal> & { id: string }): AdminRenewal {
  return {
    id: over.id,
    renewalType: over.renewalType ?? 'passport',
    dueDate: over.dueDate ?? null,
    addedAt: over.addedAt ?? TS('2026-05-29'),
  };
}

function workTask(over: Partial<WorkTask> & { id: string }): WorkTask {
  return {
    id: over.id,
    text: over.text ?? 'untitled',
    project: over.project ?? null,
    kind: over.kind ?? 'task',
    dueDate: over.dueDate ?? null,
    done: over.done ?? false,
    createdAt: over.createdAt ?? TS('2026-05-29'),
  };
}

function shoppingItem(over: Partial<ShoppingItem> & { id: string }): ShoppingItem {
  return {
    id: over.id,
    name: over.name ?? 'milk',
    quantity: over.quantity ?? null,
    unit: over.unit ?? null,
    addedAt: over.addedAt ?? TS('2026-05-29'),
  };
}

// ─── normalization ────────────────────────────────────────────────────────

describe('aggregateTodos · normalization', () => {
  it('admin create_task → row.text', () => {
    const item = normalizeAdminTask(adminTask({ id: 'a1', text: 'pay rent' }));
    expect(item).not.toBeNull();
    expect(item!.action).toBe('create_task');
    expect(item!.text).toBe('pay rent');
    expect(item!.date).toBeUndefined();
  });

  it('admin create_phone_task → "call <person> about <reason>"', () => {
    const item = normalizeAdminTask(
      adminTask({
        id: 'a2',
        kind: 'phone',
        text: 'mom',
        data: { kind: 'phone', reason: 'christmas' },
      }),
    );
    expect(item!.text).toBe('call mom about christmas');
    expect(item!.action).toBe('create_phone_task');
  });

  it('admin create_phone_task with no reason → "call <person>"', () => {
    const item = normalizeAdminTask(
      adminTask({
        id: 'a3',
        kind: 'phone',
        text: 'dentist',
        data: { kind: 'phone' },
      }),
    );
    expect(item!.text).toBe('call dentist');
  });

  it('admin schedule_appointment → "<what> · <date>"', () => {
    const item = normalizeAdminTask(
      adminTask({
        id: 'a4',
        kind: 'appointment',
        text: 'eye exam',
        data: { kind: 'appointment', date: '2026-06-02' },
      }),
    );
    expect(item!.text).toBe('eye exam · 2026-06-02');
    expect(item!.date).toBe('2026-06-02');
  });

  it('admin paperwork + decision drop out of the aggregate', () => {
    expect(
      normalizeAdminTask(
        adminTask({ id: 'p1', kind: 'paperwork', text: 'taxes' }),
      ),
    ).toBeNull();
    expect(
      normalizeAdminTask(
        adminTask({ id: 'd1', kind: 'decision', text: 'insurance' }),
      ),
    ).toBeNull();
  });

  it('admin log_renewal → "renew <type> · by <date>"', () => {
    const item = normalizeAdminRenewal(
      adminRenewal({ id: 'r1', renewalType: 'passport', dueDate: '2026-09-01' }),
    );
    expect(item.text).toBe('renew passport · by 2026-09-01');
    expect(item.date).toBe('2026-09-01');
  });

  it('admin log_renewal with no due date → "renew <type>"', () => {
    const item = normalizeAdminRenewal(
      adminRenewal({ id: 'r2', renewalType: 'lease', dueDate: null }),
    );
    expect(item.text).toBe('renew lease');
    expect(item.date).toBeUndefined();
  });

  it('work create_task → row.text', () => {
    const item = normalizeWorkTask(
      workTask({ id: 'w1', text: 'send invoice', kind: 'task' }),
    );
    expect(item!.action).toBe('create_task');
    expect(item!.text).toBe('send invoice');
    expect(item!.date).toBeUndefined();
  });

  it('work log_deadline → "<text> · due <date>"', () => {
    const item = normalizeWorkTask(
      workTask({
        id: 'w2',
        text: 'q3 report',
        kind: 'deadline',
        dueDate: '2026-06-10',
      }),
    );
    expect(item!.text).toBe('q3 report · due 2026-06-10');
    expect(item!.date).toBe('2026-06-10');
  });

  it('grocery shopping_list_add → row.name', () => {
    const item = normalizeGroceryShopping(shoppingItem({ id: 'g1', name: 'milk' }));
    expect(item.text).toBe('milk');
    expect(item.source).toBe('grocery');
  });
});

// ─── sort ─────────────────────────────────────────────────────────────────

describe('aggregateTodos · sort', () => {
  it('dated items come first, ascending', () => {
    const items: TodoItem[] = [
      {
        id: 'a',
        source: 'admin',
        action: 'log_renewal',
        text: 'a',
        date: '2026-07-01',
        createdAt: TS('2026-05-01'),
        rowId: 'a',
        kind: 'task',
      },
      {
        id: 'b',
        source: 'admin',
        action: 'log_renewal',
        text: 'b',
        date: '2026-06-01',
        createdAt: TS('2026-05-02'),
        rowId: 'b',
        kind: 'task',
      },
    ];
    const sorted = sortTodos(items);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('undated items come after dated, newest-first', () => {
    const items: TodoItem[] = [
      {
        id: 'older',
        source: 'work',
        action: 'create_task',
        text: 'older',
        createdAt: TS('2026-05-01'),
        rowId: 'older',
        kind: 'task',
      },
      {
        id: 'newer',
        source: 'work',
        action: 'create_task',
        text: 'newer',
        createdAt: TS('2026-05-10'),
        rowId: 'newer',
        kind: 'task',
      },
      {
        id: 'dated',
        source: 'admin',
        action: 'log_renewal',
        text: 'dated',
        date: '2026-06-01',
        createdAt: TS('2026-05-05'),
        rowId: 'dated',
        kind: 'task',
      },
    ];
    const sorted = sortTodos(items);
    expect(sorted.map((i) => i.id)).toEqual(['dated', 'newer', 'older']);
  });

  it('ties in date are broken by createdAt desc', () => {
    const items: TodoItem[] = [
      {
        id: 'first-logged',
        source: 'admin',
        action: 'log_renewal',
        text: 'a',
        date: '2026-06-01',
        createdAt: TS('2026-05-01'),
        rowId: 'first',
        kind: 'task',
      },
      {
        id: 'last-logged',
        source: 'admin',
        action: 'log_renewal',
        text: 'b',
        date: '2026-06-01',
        createdAt: TS('2026-05-20'),
        rowId: 'last',
        kind: 'task',
      },
    ];
    const sorted = sortTodos(items);
    expect(sorted[0]!.id).toBe('last-logged');
  });
});

// ─── aggregate across modules ────────────────────────────────────────────

describe('aggregateTodos · cross-module', () => {
  it('merges admin + work + grocery into one sorted stream', () => {
    const result = aggregateTodos({
      admin: {
        tasks: [
          adminTask({
            id: 't1',
            kind: 'phone',
            text: 'mom',
            data: { kind: 'phone', reason: 'christmas' },
            createdAt: TS('2026-05-29'),
          }),
        ],
        renewals: [
          adminRenewal({
            id: 'r1',
            renewalType: 'passport',
            dueDate: '2026-06-15',
          }),
        ],
        decisions: [],
      },
      work: {
        tasks: [
          workTask({
            id: 'w1',
            text: 'q3 report',
            kind: 'deadline',
            dueDate: '2026-06-10',
          }),
        ],
      },
      grocery: {
        shopping: [shoppingItem({ id: 'g1', name: 'olive oil' })],
      },
      finance: { pendingDecisions: [] },
    });

    expect(result.map((i) => i.text)).toEqual([
      'q3 report · due 2026-06-10',
      'renew passport · by 2026-06-15',
      'call mom about christmas',
      'olive oil',
    ]);
  });

  it('admin paperwork rows do not appear in the aggregate', () => {
    const result = aggregateTodos({
      admin: {
        tasks: [
          adminTask({ id: 'p', kind: 'paperwork', text: 'taxes' }),
          adminTask({ id: 't', kind: 'task', text: 'pay rent' }),
        ],
        renewals: [],
        decisions: [],
      },
      work: { tasks: [] },
      grocery: { shopping: [] },
      finance: { pendingDecisions: [] },
    });
    expect(result.map((i) => i.text)).toEqual(['pay rent']);
  });
});

// ─── bucketing ────────────────────────────────────────────────────────────

describe('bucketTodos', () => {
  const today = '2026-05-29';

  it('buckets today / this week / later / no date', () => {
    const items: TodoItem[] = [
      mkDated('today', today),
      mkDated('soon', '2026-06-02'),
      mkDated('week-edge', '2026-06-05'), // exactly 7 days out → this week
      mkDated('later', '2026-07-10'),
      mkUndated('floating'),
    ];
    const buckets = bucketTodos(items, today);

    expect(buckets.map((b) => b.id)).toEqual([
      'today',
      'thisWeek',
      'later',
      'noDate',
    ]);
    expect(buckets[0]!.items.map((i) => i.id)).toEqual(['today']);
    expect(buckets[1]!.items.map((i) => i.id)).toEqual(['soon', 'week-edge']);
    expect(buckets[2]!.items.map((i) => i.id)).toEqual(['later']);
    expect(buckets[3]!.items.map((i) => i.id)).toEqual(['floating']);
  });

  it('omits empty buckets', () => {
    const items: TodoItem[] = [mkUndated('floating')];
    const buckets = bucketTodos(items, today);
    expect(buckets.map((b) => b.id)).toEqual(['noDate']);
  });

  it('past-dated items land in `today` (overdue grouped with today)', () => {
    const items: TodoItem[] = [mkDated('past', '2026-04-01')];
    const buckets = bucketTodos(items, today);
    expect(buckets[0]!.id).toBe('today');
    expect(buckets[0]!.items[0]!.id).toBe('past');
  });

  function mkDated(id: string, date: string): TodoItem {
    return {
      id,
      source: 'admin',
      action: 'log_renewal',
      text: id,
      date,
      createdAt: TS('2026-05-01'),
      rowId: id,
      kind: 'task',
    };
  }
  function mkUndated(id: string): TodoItem {
    return {
      id,
      source: 'work',
      action: 'create_task',
      text: id,
      createdAt: TS('2026-05-01'),
      rowId: id,
      kind: 'task',
    };
  }
});

// ─── grocery safety-net filter ───────────────────────────────────────────────

describe('grocery safety-net filter', () => {
  // ── admin.create_task · dropped ──────────────────────────────────────────

  it('"milk" admin.create_task → dropped', () => {
    expect(
      normalizeAdminTask(adminTask({ id: 'g1', kind: 'task', text: 'milk' })),
    ).toBeNull();
  });

  it('"oil" work.create_task → dropped', () => {
    expect(
      normalizeWorkTask(workTask({ id: 'g2', kind: 'task', text: 'oil' })),
    ).toBeNull();
  });

  it('"toilet paper" admin.create_task → dropped (multi-word)', () => {
    expect(
      normalizeAdminTask(adminTask({ id: 'g3', kind: 'task', text: 'toilet paper' })),
    ).toBeNull();
  });

  it('"süt" admin.create_task → dropped (TR)', () => {
    expect(
      normalizeAdminTask(adminTask({ id: 'g4', kind: 'task', text: 'süt' })),
    ).toBeNull();
  });

  it('"leche" admin.create_task → dropped (ES)', () => {
    expect(
      normalizeAdminTask(adminTask({ id: 'g5', kind: 'task', text: 'leche' })),
    ).toBeNull();
  });

  // ── kept ─────────────────────────────────────────────────────────────────

  it('"write the PRD" admin.create_task → kept (not a grocery noun)', () => {
    const item = normalizeAdminTask(
      adminTask({ id: 'g6', kind: 'task', text: 'write the PRD' }),
    );
    expect(item).not.toBeNull();
    expect(item!.text).toBe('write the PRD');
  });

  it('"call mom" admin.create_phone_task → kept (filter does not apply to phone tasks)', () => {
    const item = normalizeAdminTask(
      adminTask({
        id: 'g7',
        kind: 'phone',
        text: 'mom',
        data: { kind: 'phone' },
      }),
    );
    expect(item).not.toBeNull();
    expect(item!.action).toBe('create_phone_task');
  });

  // ── normalisation ─────────────────────────────────────────────────────────

  it('"Milk" with capital M → dropped (case-insensitive)', () => {
    expect(
      normalizeAdminTask(adminTask({ id: 'g8', kind: 'task', text: 'Milk' })),
    ).toBeNull();
  });

  it('"  milk  " with surrounding whitespace → dropped (trim)', () => {
    expect(
      normalizeAdminTask(adminTask({ id: 'g9', kind: 'task', text: '  milk  ' })),
    ).toBeNull();
  });

  it('"buy milk" admin.create_task → kept (multi-word phrase, not a bare noun)', () => {
    const item = normalizeAdminTask(
      adminTask({ id: 'g10', kind: 'task', text: 'buy milk' }),
    );
    expect(item).not.toBeNull();
    expect(item!.text).toBe('buy milk');
  });

  // ── getGroceryLeakCount ──────────────────────────────────────────────────

  it('getGroceryLeakCount counts only create_task grocery hits', () => {
    const rows = [
      { kind: 'task', text: 'milk' },
      { kind: 'task', text: 'oil' },
      { kind: 'task', text: 'write the PRD' },
      { kind: 'phone', text: 'milk' },       // phone kind → not counted
    ];
    expect(getGroceryLeakCount(rows)).toBe(2);
  });

  // ── aggregate integration ────────────────────────────────────────────────

  it('aggregate silently drops grocery-word create_task rows from both admin + work', () => {
    const result = aggregateTodos({
      admin: {
        tasks: [
          adminTask({ id: 't-milk', kind: 'task', text: 'milk' }),
          adminTask({ id: 't-real', kind: 'task', text: 'pay rent' }),
        ],
        renewals: [],
        decisions: [],
      },
      work: {
        tasks: [
          workTask({ id: 'w-oil', kind: 'task', text: 'oil' }),
          workTask({ id: 'w-real', kind: 'task', text: 'send invoice' }),
        ],
      },
      grocery: { shopping: [] },
      finance: { pendingDecisions: [] },
    });

    const texts = result.map((i) => i.text);
    expect(texts).not.toContain('milk');
    expect(texts).not.toContain('oil');
    expect(texts).toContain('pay rent');
    expect(texts).toContain('send invoice');
  });
});

// ─── decision normalization ───────────────────────────────────────────────

function recurringDecision(
  over: Partial<RecurringDecisionRow> & { id: string },
): RecurringDecisionRow {
  return {
    id: over.id,
    what: over.what ?? 'chatgpt subscription',
    decision: over.decision ?? null,
    snoozeUntilMs: over.snoozeUntilMs ?? null,
    createdAt: over.createdAt ?? TS('2026-05-31'),
  };
}

function pendingDecision(
  over: Partial<PendingDecisionRow> & { id: string },
): PendingDecisionRow {
  return {
    id: over.id,
    what: over.what ?? 'moving quote 2400',
    decision: over.decision ?? null,
    snoozeUntilMs: over.snoozeUntilMs ?? null,
    createdAt: over.createdAt ?? TS('2026-05-31'),
    amount: over.amount ?? null,
    currency: over.currency ?? null,
    deadline: over.deadline ?? null,
    decidedAtMs: over.decidedAtMs ?? null,
  };
}

describe('aggregateTodos · decision normalization', () => {
  it('recurring_decision → text = "decide: <what>", kind = "decision", source = "admin_decision"', () => {
    const item = normalizeRecurringDecision(
      recurringDecision({ id: 'd1', what: 'chatgpt subscription' }),
    );
    expect(item.text).toBe('decide: chatgpt subscription');
    expect(item.kind).toBe('decision');
    expect(item.source).toBe('admin_decision');
    expect(item.action).toBe('recurring_decision');
    expect(item.id).toBe('admin_decision:d1');
  });

  it('pending_decision → text = "decide: <what>", kind = "decision", source = "finance_decision"', () => {
    const item = normalizePendingDecision(
      pendingDecision({ id: 'p1', what: 'moving quote 2400' }),
    );
    expect(item.text).toBe('decide: moving quote 2400');
    expect(item.kind).toBe('decision');
    expect(item.source).toBe('finance_decision');
    expect(item.action).toBe('pending_decision');
    expect(item.id).toBe('finance_decision:p1');
  });

  it('recurring_decision rows surface in the aggregate', () => {
    const result = aggregateTodos({
      admin: {
        tasks: [],
        renewals: [],
        decisions: [
          recurringDecision({ id: 'd1', what: 'netflix subscription' }),
        ],
      },
      work: { tasks: [] },
      grocery: { shopping: [] },
      finance: { pendingDecisions: [] },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('decide: netflix subscription');
    expect(result[0]!.kind).toBe('decision');
  });

  it('pending_decision rows surface in the aggregate', () => {
    const result = aggregateTodos({
      admin: { tasks: [], renewals: [], decisions: [] },
      work: { tasks: [] },
      grocery: { shopping: [] },
      finance: {
        pendingDecisions: [
          pendingDecision({ id: 'p1', what: 'solar panels quote' }),
        ],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('decide: solar panels quote');
    expect(result[0]!.kind).toBe('decision');
    expect(result[0]!.source).toBe('finance_decision');
  });

  it('decisions land in the noDate bucket', () => {
    const items = aggregateTodos({
      admin: {
        tasks: [],
        renewals: [],
        decisions: [recurringDecision({ id: 'd1', what: 'chatgpt' })],
      },
      work: { tasks: [] },
      grocery: { shopping: [] },
      finance: { pendingDecisions: [] },
    });
    const buckets = bucketTodos(items, '2026-05-31');
    expect(buckets[0]!.id).toBe('noDate');
    expect(buckets[0]!.items[0]!.kind).toBe('decision');
  });

  it('decisions sort alongside other todos by createdAt desc (undated)', () => {
    const result = aggregateTodos({
      admin: {
        tasks: [
          adminTask({ id: 't1', kind: 'task', text: 'pay rent', createdAt: TS('2026-05-20') }),
        ],
        renewals: [],
        decisions: [
          recurringDecision({ id: 'd1', what: 'netflix', createdAt: TS('2026-05-25') }),
        ],
      },
      work: { tasks: [] },
      grocery: { shopping: [] },
      finance: { pendingDecisions: [] },
    });
    // decision is newer → comes first in the undated bucket
    expect(result[0]!.kind).toBe('decision');
    expect(result[0]!.text).toBe('decide: netflix');
    expect(result[1]!.text).toBe('pay rent');
  });
});

// ─── isoToday ─────────────────────────────────────────────────────────────

describe('isoToday', () => {
  it('formats yyyy-mm-dd with zero padding', () => {
    expect(isoToday(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoToday(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
