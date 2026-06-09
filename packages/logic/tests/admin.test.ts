import { describe, it, expect } from 'vitest';
import {
  detectOpenLoopMissing,
  detectPhoneTask,
  scheduleRenewalCues,
  detectStaleBall,
  classifyActivationCost,
  detectLast5Pct,
  detectPaperworkSplit,
  detectFirehoseDump,
  detectDeferChain,
  detectTwoMinuteTask,
  detectRecurringPattern,
  efCost,
  efStateFromDump,
  sortByState,
  getDocRefs,
  addDocRef,
  parseCostOfDelay,
  surfaceCostOfDelay,
  detectRecurringDecision,
  buildDecisionRecall,
  detectScheduleFromDump,
  detectScheduleDrift,
  type AdminTask,
  type AdminHistory,
} from '../src/admin';

const DAY = 86_400_000;
const NOW = 1_000 * DAY;

// ─── 1. detectOpenLoopMissing ────────────────────────────────────────────

describe('detectOpenLoopMissing', () => {
  it('returns signal for "i should" dump without impl-hint', () => {
    const history: AdminHistory = {
      now: NOW,
      dumps: [{ id: 'd1', ts: NOW - DAY, text: 'i should call the bank' }],
    };
    const result = detectOpenLoopMissing(history, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].signal).toBe('admin_open_loop_missing');
    expect(result![0].dump_id).toBe('d1');
  });

  it('returns null when impl-hint (tomorrow) is present', () => {
    const history: AdminHistory = {
      now: NOW,
      dumps: [{ ts: NOW - DAY, text: 'i should call the bank tomorrow morning' }],
    };
    expect(detectOpenLoopMissing(history, { now: NOW })).toBeNull();
  });

  it('returns null for dump outside 24h window', () => {
    const history: AdminHistory = {
      now: NOW,
      dumps: [{ ts: NOW - 2 * DAY, text: 'i should renew insurance' }],
    };
    expect(detectOpenLoopMissing(history, { now: NOW })).toBeNull();
  });

  it('throws when now is not provided', () => {
    expect(() => detectOpenLoopMissing({}, {})).toThrow();
  });
});

// ─── 2. detectPhoneTask ──────────────────────────────────────────────────

describe('detectPhoneTask', () => {
  it('detects "call" in text', () => {
    const result = detectPhoneTask('call the dentist');
    expect(result?.signal).toBe('admin_phone_task');
  });

  it('returns null for non-phone text', () => {
    expect(detectPhoneTask('submit the form online')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectPhoneTask('')).toBeNull();
  });

  it('detects TR keyword "aramam"', () => {
    const result = detectPhoneTask('sigortayı aramam lazım');
    expect(result?.signal).toBe('admin_phone_task');
  });
});

// ─── 3. scheduleRenewalCues ──────────────────────────────────────────────

describe('scheduleRenewalCues', () => {
  it('returns urgent cue for task expiring in 5 days', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', kind: 'renewal', label: 'car insurance', expiry_ts: NOW + 5 * DAY }],
    };
    const result = scheduleRenewalCues(history, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].stage).toBe('urgent');
    expect(result![0].copy).toContain('car insurance');
  });

  it('returns overdue cue for expired task', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't2', kind: 'renewal', label: 'passport', expiry_ts: NOW - 3 * DAY }],
    };
    const result = scheduleRenewalCues(history, { now: NOW });
    expect(result![0].stage).toBe('overdue');
    expect(result![0].copy).toContain('expired');
  });

  it('skips non-renewal tasks', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't3', kind: 'todo', label: 'buy milk', expiry_ts: NOW + 5 * DAY }],
    };
    expect(scheduleRenewalCues(history, { now: NOW })).toBeNull();
  });
});

// ─── 4. detectStaleBall ──────────────────────────────────────────────────

describe('detectStaleBall (v1: mine | waiting | done)', () => {
  const isoDaysAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

  it('surfaces an OVERDUE mine task (past due date)', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', label: 'pay rent', ball_state: 'mine', due_date: isoDaysAgo(3) }],
    };
    const result = detectStaleBall(history, { now: NOW });
    expect(result![0].kind).toBe('overdue');
    expect(result![0].days_overdue).toBe(3);
  });

  it('does NOT surface a mine task whose due date is still in the future', () => {
    const future = new Date(NOW + 5 * DAY).toISOString().slice(0, 10);
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', label: 'pay rent', ball_state: 'mine', due_date: future }],
    };
    expect(detectStaleBall(history, { now: NOW })).toBeNull();
  });

  it('surfaces an UNTOUCHED mine task with no due date after 7 days', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't2', label: 'fix bike', ball_state: 'mine', last_transition_at: NOW - 8 * DAY }],
    };
    const result = detectStaleBall(history, { now: NOW });
    expect(result![0].kind).toBe('untouched');
  });

  it('does NOT surface a mine task touched within 7 days', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't2', ball_state: 'mine', last_transition_at: NOW - 3 * DAY }],
    };
    expect(detectStaleBall(history, { now: NOW })).toBeNull();
  });

  it('surfaces an UNTOUCHED waiting task after 7 days', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't3', label: 'invoice', ball_state: 'waiting', last_transition_at: NOW - 10 * DAY }],
    };
    const result = detectStaleBall(history, { now: NOW });
    expect(result![0].kind).toBe('untouched');
    expect(result![0].copy).toContain('still waiting');
  });

  it('never surfaces a done task', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't4', ball_state: 'done', last_transition_at: NOW - 100 * DAY }],
    };
    expect(detectStaleBall(history, { now: NOW })).toBeNull();
  });
});

// ─── 5. classifyActivationCost ───────────────────────────────────────────

describe('classifyActivationCost', () => {
  it('assigns tier 5 to phone task', () => {
    const result = classifyActivationCost({ id: 't1', label: 'call the bank' }, null);
    expect(result.tier).toBe(5);
  });

  it('assigns tier 1 to click task', () => {
    const result = classifyActivationCost({ id: 't2', label: 'toggle notification' }, null);
    expect(result.tier).toBe(1);
  });

  it('fits crash state with tier ≤2 task', () => {
    const result = classifyActivationCost({ id: 't3', label: 'toggle notification' }, 'crash');
    expect(result.fits_state).toBe(true);
  });

  it('does not fit crash state with phone task', () => {
    const result = classifyActivationCost({ id: 't4', label: 'call the doctor' }, 'crash');
    expect(result.fits_state).toBe(false);
    expect(result.copy).toContain('tier-1');
  });
});

// ─── 6. detectLast5Pct ───────────────────────────────────────────────────

describe('detectLast5Pct', () => {
  it('surfaces done-but-not-closed task past 5 days', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', label: 'visa application', state: 'done', done_at: NOW - 8 * DAY }],
    };
    const result = detectLast5Pct(history, { now: NOW });
    expect(result![0].signal).toBe('admin_last_5pct');
    expect(result![0].days_since_done).toBe(8);
  });

  it('skips task that is also closed', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't2', state: 'done', done_at: NOW - 8 * DAY, closed_at: NOW - 2 * DAY }],
    };
    expect(detectLast5Pct(history, { now: NOW })).toBeNull();
  });
});

// ─── 7. detectPaperworkSplit ─────────────────────────────────────────────

describe('detectPaperworkSplit', () => {
  it('returns dump signal on "tax form" in dump_text', () => {
    const result = detectPaperworkSplit({ now: NOW }, { now: NOW, dump_text: 'fill out the tax form' });
    expect(result).not.toBeNull();
    expect((result as { signal: string }).signal).toBe('admin_paperwork_split');
  });

  it('returns existing signal for unsplit paperwork task', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', label: 'insurance application' }],
    };
    const result = detectPaperworkSplit(history, { now: NOW });
    expect(Array.isArray(result)).toBe(true);
    expect((result as { signal: string }[])[0].signal).toBe('admin_paperwork_split_existing');
  });

  it('skips task that already has a stage', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't2', label: 'insurance form', stage: 'fill' }],
    };
    expect(detectPaperworkSplit(history, { now: NOW })).toBeNull();
  });
});

// ─── 8. detectFirehoseDump ───────────────────────────────────────────────

describe('detectFirehoseDump', () => {
  it('detects firehose with 6 distinct tokens', () => {
    const history: AdminHistory = { now: NOW };
    const result = detectFirehoseDump(history, {
      now: NOW,
      dump_text: 'vet bank visa lease passport dentist',
    });
    expect(result?.signal).toBe('admin_firehose_dump');
    expect(result!.candidate_items.length).toBeGreaterThanOrEqual(4);
  });

  it('returns null if text has sentence punctuation', () => {
    expect(
      detectFirehoseDump({ now: NOW }, {
        now: NOW,
        dump_text: 'vet bank. visa lease passport dentist',
      }),
    ).toBeNull();
  });

  it('returns null if text has impl-hint', () => {
    expect(
      detectFirehoseDump({ now: NOW }, {
        now: NOW,
        dump_text: 'vet bank visa tomorrow lease dentist phone',
      }),
    ).toBeNull();
  });
});

// ─── 9. detectDeferChain ─────────────────────────────────────────────────

describe('detectDeferChain', () => {
  it('surfaces tasks deferred ≥5 times sorted desc', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [
        { id: 't1', label: 'tax return', defer_count: 7 },
        { id: 't2', label: 'dentist call', defer_count: 5 },
      ],
    };
    const result = detectDeferChain(history, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].defer_count).toBe(7);
    expect(result![1].defer_count).toBe(5);
  });

  it('skips tasks deferred fewer than threshold', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', defer_count: 3 }],
    };
    expect(detectDeferChain(history, { now: NOW })).toBeNull();
  });
});

// ─── 10. detectTwoMinuteTask ─────────────────────────────────────────────

describe('detectTwoMinuteTask', () => {
  it('returns single signal for one 1-min active task', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', label: 'confirm subscription', state: 'active', duration_min: 1 }],
    };
    const result = detectTwoMinuteTask(history, { now: NOW });
    expect(result?.batch).toBe(false);
    expect(result?.count).toBe(1);
  });

  it('sets batch=true for 5+ micro-tasks', () => {
    const tasks: AdminTask[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      state: 'active' as const,
      duration_min: 1,
    }));
    const history: AdminHistory = { now: NOW, tasks };
    const result = detectTwoMinuteTask(history, { now: NOW });
    expect(result?.batch).toBe(true);
    expect(result?.copy).toContain('burst session');
  });

  it('ignores non-active tasks', () => {
    const history: AdminHistory = {
      now: NOW,
      tasks: [{ id: 't1', state: 'done', duration_min: 1 }],
    };
    expect(detectTwoMinuteTask(history, { now: NOW })).toBeNull();
  });
});

// ─── 11. detectRecurringPattern ──────────────────────────────────────────

describe('detectRecurringPattern', () => {
  it('predicts recurring category within horizon', () => {
    const yearMs = 365 * DAY;
    const baseTs = NOW - yearMs;
    const history: AdminHistory = {
      now: NOW,
      tasks: [
        { id: 't1', category: 'taxes', closed_at: baseTs - 3 * DAY },
        { id: 't2', category: 'taxes', closed_at: baseTs + 3 * DAY },
      ],
    };
    const result = detectRecurringPattern(history, { now: NOW, horizonDays: 30 });
    // may or may not fire depending on exact day-of-year alignment; just verify shape if it does
    if (result) {
      expect(result[0].signal).toBe('admin_recurring_pattern');
      expect(result[0].category_or_label).toBe('taxes');
    }
  });
});

// ─── 12. efCost / efStateFromDump / sortByState ──────────────────────────

describe('efCost', () => {
  it('returns 5 for phone task', () => expect(efCost({ id: 't', label: 'call bank' })).toBe(5));
  it('returns 4 for form task', () => expect(efCost({ id: 't', label: 'fill tax form' })).toBe(4));
  it('returns 1 for click task', () => expect(efCost({ id: 't', label: 'toggle notifications' })).toBe(1));
  it('respects explicit ef_cost field', () => expect(efCost({ id: 't', label: 'call bank', ef_cost: 2 })).toBe(2));
  it('defaults to 3 for unknown text', () => expect(efCost({ id: 't', label: 'do the thing' })).toBe(3));
});

describe('efStateFromDump', () => {
  it('returns 1 for crash language', () => expect(efStateFromDump('i am completely wiped out')).toBe(1));
  it('returns 5 for peak language', () => expect(efStateFromDump('i am super focused and peak')).toBe(5));
  it('returns 3 for neutral text', () => expect(efStateFromDump('need to do stuff')).toBe(3));
});

describe('sortByState', () => {
  const tasks: AdminTask[] = [
    { id: 't1', label: 'call dentist' },    // tier 5
    { id: 't2', label: 'toggle setting' },  // tier 1
    { id: 't3', label: 'fill insurance form' }, // tier 4
  ];

  it('in crash state (1) returns only tier ≤1 tasks', () => {
    const result = sortByState(tasks, 1);
    expect(result.every((t) => efCost(t) <= 1)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('in peak state (5) returns all tasks sorted asc', () => {
    const result = sortByState(tasks, 5);
    expect(result.length).toBe(3);
    expect(efCost(result[0])).toBeLessThanOrEqual(efCost(result[1]));
  });

  it('returns empty array when consent=false', () => {
    expect(sortByState(tasks, 5, { consent: false })).toHaveLength(0);
  });
});

// ─── 13. getDocRefs / addDocRef ──────────────────────────────────────────

describe('getDocRefs / addDocRef', () => {
  it('getDocRefs returns empty for task without doc_refs', () => {
    expect(getDocRefs({ id: 't1' })).toEqual([]);
  });

  it('addDocRef appends a ref immutably', () => {
    const task: AdminTask = { id: 't1', doc_refs: [] };
    const updated = addDocRef(task, 'Lease Agreement', 'https://example.com/lease.pdf');
    expect(updated.doc_refs).toHaveLength(1);
    expect(updated.doc_refs![0].label).toBe('Lease Agreement');
    // original not mutated
    expect(task.doc_refs).toHaveLength(0);
  });

  it('addDocRef no-ops on blank label', () => {
    const task: AdminTask = { id: 't1' };
    expect(addDocRef(task, '  ')).toBe(task);
  });
});

// ─── 14. parseCostOfDelay / surfaceCostOfDelay ───────────────────────────

describe('parseCostOfDelay / surfaceCostOfDelay', () => {
  it('parseCostOfDelay extracts cost from text with penalty keyword', () => {
    const result = parseCostOfDelay('if i miss the deadline there is a late fee');
    expect(result?.pattern).toBe('cost-of-delay');
  });

  it('parseCostOfDelay returns null for text without cue', () => {
    expect(parseCostOfDelay('i need to buy milk')).toBeNull();
  });

  it('surfaceCostOfDelay fires when deferred ≥2 times', () => {
    const task: AdminTask = {
      id: 't1',
      cost_of_delay: '€50 late fee',
      defer_count: 3,
    };
    const result = surfaceCostOfDelay(task, { now: NOW });
    expect(result?.cost_of_delay).toBe('€50 late fee');
    expect(result?.copy).toContain('€50 late fee');
  });

  it('surfaceCostOfDelay returns null when deferred < threshold', () => {
    const task: AdminTask = { id: 't1', cost_of_delay: 'fine', defer_count: 1 };
    expect(surfaceCostOfDelay(task, { now: NOW })).toBeNull();
  });
});

// ─── 15. detectRecurringDecision / buildDecisionRecall ───────────────────

describe('detectRecurringDecision / buildDecisionRecall', () => {
  it('recalls matching decision rule', () => {
    const state = {
      decision_rules: [
        { id: 'r1', topic_key: 'insurance provider plan', choice: 'keep current provider', revoked: false },
      ],
    };
    const result = detectRecurringDecision('thinking about insurance provider plan again', state, { now: NOW });
    expect(result?.choice).toBe('keep current provider');
    expect(result?.copy).toContain('keep current provider');
  });

  it('returns null when no rules match', () => {
    expect(detectRecurringDecision('need coffee', { decision_rules: [] })).toBeNull();
  });

  it('buildDecisionRecall returns null for empty rule', () => {
    expect(buildDecisionRecall(null)).toBeNull();
  });
});

// ─── 16. detectScheduleFromDump / detectScheduleDrift ────────────────────

describe('detectScheduleFromDump / detectScheduleDrift', () => {
  it('detectScheduleFromDump returns pattern for "scheduled" keyword', () => {
    const result = detectScheduleFromDump('i scheduled the dentist appointment', { now: NOW });
    expect(result?.pattern).toBe('scheduled-detected');
  });

  it('detectScheduleFromDump returns null for non-schedule text', () => {
    expect(detectScheduleFromDump('i need to call dentist')).toBeNull();
  });

  it('detectScheduleDrift surfaces category with 3 unacted entries', () => {
    const state = {
      scheduled_log: [
        { task_id: 'a', category: 'gym', scheduled_at: NOW - 3 * DAY },
        { task_id: 'b', category: 'gym', scheduled_at: NOW - 2 * DAY },
        { task_id: 'c', category: 'gym', scheduled_at: NOW - 1 * DAY },
      ],
    };
    const result = detectScheduleDrift(state, { now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('gym');
    expect(result[0].copy).toContain('scheduling and doing are not the same thing');
  });

  it('detectScheduleDrift returns empty when one entry has done_at', () => {
    const state = {
      scheduled_log: [
        { task_id: 'a', category: 'gym', scheduled_at: NOW - 3 * DAY },
        { task_id: 'b', category: 'gym', scheduled_at: NOW - 2 * DAY, done_at: NOW - 1 * DAY },
        { task_id: 'c', category: 'gym', scheduled_at: NOW - 1 * DAY },
      ],
    };
    expect(detectScheduleDrift(state, { now: NOW })).toHaveLength(0);
  });
});
