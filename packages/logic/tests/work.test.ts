import { describe, it, expect } from 'vitest';
import {
  DAY,
  HOUR,
  DEADLINE_CUE_OFFSETS_DAYS,
  DEADLINE_RE,
  FEEDBACK_RE,
  dayKey,
  fmtBlockLabel,
  ordinal,
  isTriageActive,
  detectDeepFocusHours,
  detectPacingBreach,
  detectTaskSwitchTax,
  detectMeetingCliff,
  scheduleDeadlineCues,
  detectShutdownGap,
  buildShutdownPrompt,
  buildTriageAnchor,
  detectActivationBarrier,
  detectEstimationDrift,
  detectPostMeetingBuffer,
  detectOneMoreThingSpiral,
  buildCrashPrompt,
  detectHyperfocusCrashPattern,
  detectTabSprawl,
  detectNotificationTax,
  detectRecurringMeetingDeads,
  buildCancelDraft,
  detectMultitaskIllusion,
  matchRSDTitle,
  detectRSDPattern,
  detectPatterns,
  type WorkState,
  type WorkPatternOpts,
  type Deadline,
} from '../src/work';

// ─── shared fixture anchor ────────────────────────────────────────────

const NOW = 1_000 * DAY; // arbitrary deterministic epoch

// ─── helpers ─────────────────────────────────────────────────────────

describe('dayKey', () => {
  it('formats YYYY-MM-DD', () => {
    // 2000-01-01 00:00:00 UTC = 946684800000 ms
    const ts = 946_684_800_000;
    expect(dayKey(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('fmtBlockLabel', () => {
  it('2am-4am block 1', () => {
    expect(fmtBlockLabel(1)).toBe('2am-4am');
  });
  it('last block is midnight', () => {
    // block 11 = hours 22-24 = 10pm-midnight
    expect(fmtBlockLabel(11)).toBe('10pm-midnight');
  });
});

describe('ordinal', () => {
  it('1st 2nd 3rd 4th', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(21)).toBe('21st');
  });
});

describe('DEADLINE_RE', () => {
  it('matches EN deadline', () => {
    expect(DEADLINE_RE.test('project deadline friday')).toBe(true);
  });
  it('matches TR teslim', () => {
    expect(DEADLINE_RE.test('teslim tarihi pazartesi')).toBe(true);
  });
  it('does not match random text', () => {
    expect(DEADLINE_RE.test('just a normal sentence')).toBe(false);
  });
});

describe('FEEDBACK_RE', () => {
  it('matches performance review', () => {
    expect(FEEDBACK_RE.test('performance review next week')).toBe(true);
  });
  it('matches TR geri bildirim', () => {
    expect(FEEDBACK_RE.test('geri bildirim bekliyorum')).toBe(true);
  });
});

// ─── W0 legacy ───────────────────────────────────────────────────────

describe('detectDeepFocusHours', () => {
  it('returns null when insufficient sessions', () => {
    expect(detectDeepFocusHours({ sessions: [], now: NOW })).toBeNull();
  });

  it('detects peak block when lift threshold met', () => {
    // All 25 long sessions land at the same local-clock hour each day.
    // We don't assert a specific hour (getHours is TZ-sensitive) but we do
    // assert the pattern fires and peak_mean > overall_mean.
    const sameHourOffset = 14 * HOUR; // arbitrary — all same block
    const sessions = Array.from({ length: 25 }, (_, i) => ({
      at: NOW - (30 - i) * DAY + sameHourOffset,
      duration_min: 120,
    }));
    // 10 very short sessions at a different 2h block to pull overall mean way down
    for (let i = 0; i < 10; i++) {
      sessions.push({ at: NOW - (i + 1) * DAY + sameHourOffset + 6 * HOUR, duration_min: 1 });
    }
    const result = detectDeepFocusHours(
      { sessions, now: NOW },
      { windowDays: 90, minSessions: 20, minRunLength: 3, minLift: 1.2 },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('deep-focus-hours');
    expect(result!.peak_mean_minutes).toBeGreaterThan(result!.overall_mean_minutes);
  });
});

describe('detectPacingBreach', () => {
  it('returns null when no sessions exceed threshold', () => {
    const state = { sessions: [{ at: NOW - HOUR, duration_min: 60 }], now: NOW };
    expect(detectPacingBreach(state)).toBeNull();
  });

  it('detects breach session over 8h', () => {
    const state = {
      sessions: [{ at: NOW - 10 * HOUR, duration_min: 10 * 60 }],
      now: NOW,
    };
    const r = detectPacingBreach(state);
    expect(r?.pattern).toBe('pacing-breach');
    expect(r?.duration_label).toMatch(/h/);
  });
});

// ─── W1 task-switch-tax ───────────────────────────────────────────────

describe('detectTaskSwitchTax', () => {
  it('returns null without review flag', () => {
    expect(detectTaskSwitchTax({}, { now: NOW })).toBeNull();
  });

  it('returns null below minSessions', () => {
    expect(detectTaskSwitchTax({}, { now: NOW, review: true })).toBeNull();
  });

  it('detects pattern when mean swaps exceed threshold', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      at: NOW - i * HOUR,
      task_tags: ['a', 'b', 'c', 'd'], // 3 swaps each
    }));
    const state: WorkState = { sessions };
    const r = detectTaskSwitchTax(state, { now: NOW, review: true, minSessions: 10, meanSwapThreshold: 2 });
    expect(r?.pattern).toBe('task-switch-tax');
    expect(r?.total_swaps).toBe(36);
  });
});

// ─── W2 meeting-cliff ─────────────────────────────────────────────────

describe('detectMeetingCliff', () => {
  it('returns empty array with too few meetings', () => {
    expect(detectMeetingCliff({}, { now: NOW })).toEqual([]);
  });

  it('detects cliff for 3 back-to-back meetings', () => {
    const base = NOW - 2 * HOUR;
    const meetings = [
      { start_at: base, end_at: base + 50 * 60_000 },
      { start_at: base + 55 * 60_000, end_at: base + 110 * 60_000 },
      { start_at: base + 115 * 60_000, end_at: base + 170 * 60_000 },
    ];
    const r = detectMeetingCliff({ meetings }, { now: NOW, minMeetings: 3, maxGapMs: 10 * 60_000 });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].pattern).toBe('meeting-cliff');
    expect(r[0].meeting_count).toBe(3);
  });
});

// ─── W4 deadline cues ────────────────────────────────────────────────

describe('scheduleDeadlineCues', () => {
  it('returns null for invalid deadline', () => {
    expect(scheduleDeadlineCues({ due_at: NaN }, { now: NOW })).toBeNull();
  });

  it('generates 3 cues at correct offsets', () => {
    const deadline: Deadline = { due_at: NOW + 10 * DAY, title: 'contract draft' };
    const r = scheduleDeadlineCues(deadline, { now: NOW });
    expect(r?.pattern).toBe('deadline-cues');
    expect(r?.cues).toHaveLength(3);
    expect(r?.cues[0].stage).toBe('7d');
    expect(r?.cues[1].stage).toBe('2d');
    expect(r?.cues[2].stage).toBe('1d');
  });
});

// ─── W12 shutdown gap ────────────────────────────────────────────────

describe('detectShutdownGap', () => {
  it('returns null when recent shutdown exists', () => {
    const state: WorkState = { shutdown_log: [{ ts: NOW - DAY }] };
    expect(detectShutdownGap(state, { now: NOW, gapDays: 3 })).toBeNull();
  });

  it('detects gap when last shutdown is old', () => {
    const state: WorkState = { shutdown_log: [{ ts: NOW - 5 * DAY }] };
    const r = detectShutdownGap(state, { now: NOW, gapDays: 3 });
    expect(r?.pattern).toBe('shutdown-gap');
    expect(r?.days_since).toBe(5);
  });

  it('elevates confidence with low sleep signal', () => {
    const state: WorkState = { shutdown_log: [] };
    const r = detectShutdownGap(state, { now: NOW, sleep: { hours: 4 } });
    expect(r?.confidence).toBe('high');
    expect(r?.low_sleep_signal).toBe(true);
  });
});

describe('buildShutdownPrompt', () => {
  it('returns three questions', () => {
    const p = buildShutdownPrompt();
    expect(p.questions).toHaveLength(3);
    expect(p.questions.map((q) => q.id)).toContain('open_loops');
  });
});

// ─── W17 triage ──────────────────────────────────────────────────────

describe('isTriageActive / buildTriageAnchor', () => {
  it('isTriageActive returns false when no triage days', () => {
    expect(isTriageActive({}, { now: NOW })).toBe(false);
  });

  it('isTriageActive returns true via opts.triage shortcut', () => {
    expect(isTriageActive({}, { now: NOW, triage: true })).toBe(true);
  });

  it('buildTriageAnchor returns null when triage not active', () => {
    expect(buildTriageAnchor({}, { now: NOW })).toBeNull();
  });

  it('buildTriageAnchor returns pattern when triage active', () => {
    const r = buildTriageAnchor({}, { now: NOW, triage: true });
    expect(r?.pattern).toBe('triage-day-anchor');
  });
});

// ─── W5 activation barrier ───────────────────────────────────────────

describe('detectActivationBarrier', () => {
  it('returns empty array for completed tasks', () => {
    const state: WorkState = {
      tasks: [{ id: 't1', created_at: NOW - 3 * DAY, completed_at: NOW - DAY }],
    };
    expect(detectActivationBarrier(state, { now: NOW })).toHaveLength(0);
  });

  it('detects stalled task over 48h', () => {
    const state: WorkState = {
      tasks: [{ id: 't1', title: 'write proposal', created_at: NOW - 3 * DAY }],
    };
    const r = detectActivationBarrier(state, { now: NOW });
    expect(r.length).toBe(1);
    expect(r[0].pattern).toBe('activation-barrier');
    expect(r[0].task_title).toBe('write proposal');
  });
});

// ─── W6 estimation drift ─────────────────────────────────────────────

describe('detectEstimationDrift', () => {
  it('returns null with too few entries', () => {
    expect(detectEstimationDrift({ estimation_log: [] }, { now: NOW })).toBeNull();
  });

  it('detects drift when median ratio >= 1.2', () => {
    const log = Array.from({ length: 8 }, () => ({
      estimated_min: 30,
      actual_min: 60, // ratio 2.0
    }));
    const r = detectEstimationDrift({ estimation_log: log }, { now: NOW });
    expect(r?.pattern).toBe('estimation-drift');
    expect(r?.multiplier).toBeGreaterThanOrEqual(1.5);
  });

  it('returns null when drift is under threshold', () => {
    const log = Array.from({ length: 8 }, () => ({
      estimated_min: 30,
      actual_min: 31,
    }));
    expect(detectEstimationDrift({ estimation_log: log }, { now: NOW })).toBeNull();
  });
});

// ─── W9 post-meeting buffer ───────────────────────────────────────────

describe('detectPostMeetingBuffer', () => {
  it('returns null with no meeting_buffer', () => {
    expect(detectPostMeetingBuffer({}, { now: NOW })).toBeNull();
  });

  it('flips default on after 3 consecutive accepts', () => {
    const state: WorkState = {
      meeting_buffer: { accept_log: [NOW - 3 * DAY, NOW - 2 * DAY, NOW - DAY], decline_log: [] },
    };
    const r = detectPostMeetingBuffer(state, { now: NOW });
    expect(r?.default_state).toBe('on');
  });
});

// ─── W11 one-more-thing spiral ───────────────────────────────────────

describe('detectOneMoreThingSpiral', () => {
  it('returns null without sessionId', () => {
    expect(detectOneMoreThingSpiral({}, { now: NOW })).toBeNull();
  });

  it('fires after threshold presses', () => {
    const state: WorkState = {
      one_more_thing_log: [
        { session_id: 'sess-1' },
        { session_id: 'sess-1' },
        { session_id: 'sess-1' },
      ],
    };
    const r = detectOneMoreThingSpiral(state, { now: NOW, sessionId: 'sess-1', threshold: 3 });
    expect(r?.pattern).toBe('one-more-thing-spiral');
    expect(r?.presses).toBe(3);
    expect(r?.copy).toContain('3rd');
  });
});

// ─── W3 hyperfocus crash ──────────────────────────────────────────────

describe('buildCrashPrompt', () => {
  it('returns null when no qualifying sessions', () => {
    expect(buildCrashPrompt({}, { now: NOW })).toBeNull();
  });

  it('returns prompt for recent 3h+ session not yet asked', () => {
    const state: WorkState = {
      sessions: [{ id: 's1', at: NOW - 12 * HOUR, duration_min: 4 * 60 }],
      crash_log: [],
    };
    const r = buildCrashPrompt(state, { now: NOW });
    expect(r?.pattern).toBe('hyperfocus-crash-prompt');
    expect(r?.session_hours).toBe(4);
  });
});

describe('detectHyperfocusCrashPattern', () => {
  it('returns null with insufficient decisive entries', () => {
    expect(detectHyperfocusCrashPattern({}, { now: NOW })).toBeNull();
  });

  it('detects pattern with enough yes replies', () => {
    const log = [
      { reply: 'yes' }, { reply: 'yes' }, { reply: 'yes' },
      { reply: 'no_crash' }, { reply: 'no_crash' },
    ];
    const r = detectHyperfocusCrashPattern({ crash_log: log }, { now: NOW });
    expect(r?.pattern).toBe('hyperfocus-crash-pattern');
    expect(r?.yes_count).toBe(3);
  });
});

// ─── W7 tab sprawl ───────────────────────────────────────────────────

describe('detectTabSprawl', () => {
  it('returns null with fewer than minReports', () => {
    expect(detectTabSprawl({ tab_reports: [{ count: 20 }] }, { now: NOW })).toBeNull();
  });

  it('detects sprawl when mean >= threshold', () => {
    const state: WorkState = {
      tab_reports: [{ count: 20 }, { count: 18 }, { count: 22 }, { count: 19 }],
    };
    const r = detectTabSprawl(state, { now: NOW, minReports: 4, threshold: 15 });
    expect(r?.pattern).toBe('tab-sprawl');
    expect(r?.mean).toBeGreaterThanOrEqual(15);
  });
});

// ─── W8 notification tax ─────────────────────────────────────────────

describe('detectNotificationTax', () => {
  it('returns null below minTotal', () => {
    expect(detectNotificationTax({}, { now: NOW })).toBeNull();
  });

  it('counts self-checks correctly', () => {
    const log = Array.from({ length: 6 }, (_, i) => ({
      ts: NOW - i * HOUR,
      kind: 'impulse_check' as const,
    }));
    const r = detectNotificationTax({ notification_tax_log: log }, { now: NOW, minTotal: 5 });
    expect(r?.pattern).toBe('notification-tax');
    expect(r?.self_checks).toBe(6);
    expect(r?.total).toBe(6);
  });
});

// ─── W10 recurring meeting deads ─────────────────────────────────────

describe('detectRecurringMeetingDeads / buildCancelDraft', () => {
  it('returns empty array when no dead meetings', () => {
    const state: WorkState = { recurring_meetings: [{ id: 'm1', title: 'standup', status: 'active' }] };
    expect(detectRecurringMeetingDeads(state, { now: NOW })).toHaveLength(0);
  });

  it('returns dead meeting with cancel draft', () => {
    const state: WorkState = { recurring_meetings: [{ id: 'm1', title: 'weekly sync', status: 'dead' }] };
    const r = detectRecurringMeetingDeads(state, { now: NOW });
    expect(r.length).toBe(1);
    expect(r[0].pattern).toBe('recurring-meeting-dead');
    expect(r[0].cancel_draft).toContain('weekly sync');
  });

  it('buildCancelDraft with no title uses fallback', () => {
    expect(buildCancelDraft(undefined)).toContain('this recurring meeting');
  });
});

// ─── W13 multitask illusion ───────────────────────────────────────────

describe('detectMultitaskIllusion', () => {
  it('returns null with insufficient data', () => {
    expect(detectMultitaskIllusion({}, { now: NOW })).toBeNull();
  });

  it('detects illusion when solo > multi completion by 10%+', () => {
    const log = [
      { task_count: 2, completion_rate: 0.5 },
      { task_count: 2, completion_rate: 0.55 },
      { task_count: 2, completion_rate: 0.45 },
      { task_count: 1, completion_rate: 0.85 },
      { task_count: 1, completion_rate: 0.9 },
      { task_count: 1, completion_rate: 0.80 },
    ];
    const r = detectMultitaskIllusion({ multitask_log: log }, { now: NOW });
    expect(r?.pattern).toBe('multitask-illusion');
    expect(r?.solo_completion).toBeGreaterThan(r?.multi_completion ?? 100);
  });
});

// ─── W14 RSD ─────────────────────────────────────────────────────────

describe('matchRSDTitle / detectRSDPattern', () => {
  it('matchRSDTitle returns null for unrelated title', () => {
    expect(matchRSDTitle('buy milk', { now: NOW })).toBeNull();
  });

  it('matchRSDTitle detects feedback keyword', () => {
    const r = matchRSDTitle('performance review from manager', { now: NOW });
    expect(r?.pattern).toBe('rsd-anchor-prompt');
    expect(r?.chips).toContain('sting');
  });

  it('detectRSDPattern returns null below minSample', () => {
    expect(detectRSDPattern({}, { now: NOW })).toBeNull();
  });

  it('detectRSDPattern aggregates landed counts', () => {
    const log = [
      { landed: 'sting' }, { landed: 'sting' }, { landed: 'fine' },
      { landed: 'mixed' }, { landed: 'shame_spike' },
    ];
    const r = detectRSDPattern({ rsd_anchor_log: log }, { now: NOW, minSample: 5 });
    expect(r?.pattern).toBe('rsd-anchor-mirror');
    expect(r?.counts.sting).toBe(2);
    expect(r?.sample_size).toBe(5);
  });
});

// ─── detectPatterns (central wrapper) ────────────────────────────────

describe('detectPatterns', () => {
  it('returns empty array for empty state with no consent', () => {
    const r = detectPatterns({}, { now: NOW, consent: false });
    expect(Array.isArray(r)).toBe(true);
  });

  it('triage short-circuits and includes triage-day-anchor', () => {
    const r = detectPatterns({}, { now: NOW, triage: true, consent: true });
    expect(r.some((p) => p.pattern === 'triage-day-anchor')).toBe(true);
    // should not include non-triage patterns
    expect(r.some((p) => p.pattern === 'task-switch-tax')).toBe(false);
  });

  it('runs shutdown detector when state has old shutdown_log', () => {
    const state: WorkState = { shutdown_log: [{ ts: NOW - 10 * DAY }] };
    const r = detectPatterns(state, { now: NOW, consent: true });
    expect(r.some((p) => p.pattern === 'shutdown-gap')).toBe(true);
  });

  it('includes deadline-cues when deadlines passed in opts', () => {
    const deadline: Deadline = { due_at: NOW + 5 * DAY, title: 'report' };
    const r = detectPatterns({}, { now: NOW, consent: true, deadlines: [deadline] });
    expect(r.some((p) => p.pattern === 'deadline-cues')).toBe(true);
  });
});
