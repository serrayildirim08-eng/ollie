/**
 * @ollie/orchestrator · work cue notifications
 *
 * Audit task 2 (2026-05-14): verifies all 7 work notifications fire
 * via the injected scheduleNotification dispatcher with the exact
 * audit-locked copy. Each detector tested in isolation against a
 * fixed clock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers } from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import {
  createWorkOrchestrator,
  WORK_NOTIFICATION_COPY,
} from '../src/work';
import type {
  Meeting,
  ScheduledFocusBlock,
  FocusLogEntry,
} from '@ollie/logic/work';

const NOW = new Date('2026-05-14T12:00:00Z').getTime();
const MIN = 60_000;

interface Captured {
  spec: NotificationSpec;
  fireAt: number;
}

function makeHarness() {
  const captured: Captured[] = [];
  const dispatch = (spec: NotificationSpec, fireAt: number): void => {
    captured.push({ spec, fireAt });
  };
  const store = createStore(createMemoryAdapter());
  const orch = createWorkOrchestrator(store, {
    now: () => NOW,
    scheduleNotification: dispatch,
  });
  return { store, orch, captured };
}

describe('work orchestrator · notification cues', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('#5 meeting in 30 min → fires audit copy with REMINDER category', () => {
    const { store, orch, captured } = makeHarness();
    const meeting: Meeting = {
      id: 'm1',
      title: 'kickoff',
      start_at: NOW + 30 * MIN, // exactly 30 min away
      end_at: NOW + 60 * MIN,
    };
    store.set('work', 'meetings', [meeting]);
    orch.init();
    vi.advanceTimersByTime(600); // debounce + cold-start scanCues

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('work:meeting_30m:'));
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe(WORK_NOTIFICATION_COPY.meeting_30m);
    expect(hit?.spec.category).toBe('REMINDER');

    orch.teardown();
  });

  it('#1 focus block in 15 min → fires upcoming_block copy', () => {
    const { store, orch, captured } = makeHarness();
    const block: ScheduledFocusBlock = {
      id: 'b1',
      start_at: NOW + 15 * MIN,
      duration_min: 45,
    };
    store.set('work', 'scheduled_blocks', [block]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key === 'work:focus_block_upcoming:b1');
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe(WORK_NOTIFICATION_COPY.upcoming_block);

    orch.teardown();
  });

  it('#4 deep work block ~1h away → fires deep_work_tomorrow copy', () => {
    const { store, orch, captured } = makeHarness();
    const block: ScheduledFocusBlock = {
      id: 'b2',
      start_at: NOW + 60 * MIN,
      duration_min: 90,
    };
    store.set('work', 'scheduled_blocks', [block]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key === 'work:deep_work_tomorrow:b2');
    expect(hit).toBeDefined();
    // Copy is dynamic ("today" vs "tomorrow"), so substring-match the
    // anchor word + audit phrase.
    expect(hit?.spec.title).toMatch(/^deep work (today|tomorrow) \d+(am|pm)\. heads up\.$/);

    orch.teardown();
  });

  it('#2 session_end (25 min done) → fires 5 min stretch copy', () => {
    const { store, orch, captured } = makeHarness();
    // Session that just ended (started 25 min ago, duration 25min).
    const entry: FocusLogEntry = {
      ts: NOW - 25 * MIN,
      duration_min: 25,
      duration_ms: 25 * MIN,
    };
    store.set('work', 'focus_log', [entry]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('work:session_end:'));
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe(WORK_NOTIFICATION_COPY.session_end);
    expect(hit?.spec.category).toBe('CONTENT_DELIVERY');

    orch.teardown();
  });

  it('#3 90-min block 85 min in → fires wind_down copy', () => {
    const { store, orch, captured } = makeHarness();
    // 90-min session started 85 min ago, still running.
    const entry: FocusLogEntry = {
      ts: NOW - 85 * MIN,
      duration_min: 90,
      duration_ms: 90 * MIN, // logged-on-start; running duration = 85
    };
    store.set('work', 'focus_log', [entry]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('work:session_90_warn:'));
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe(WORK_NOTIFICATION_COPY.session_90_warn);

    orch.teardown();
  });

  it('#7 four focus blocks today → fires "body says rest" copy once', () => {
    const { store, orch, captured } = makeHarness();
    const entries: FocusLogEntry[] = Array.from({ length: 4 }, (_, i) => ({
      ts: NOW - (i + 1) * 30 * MIN,
      duration_min: 25,
      duration_ms: 25 * MIN,
    }));
    store.set('work', 'focus_log', entries);
    orch.init();
    vi.advanceTimersByTime(600);

    const hits = captured.filter((c) => c.spec.dedupe_key.startsWith('work:four_blocks_today:'));
    expect(hits.length).toBe(1);
    expect(hits[0].spec.title).toBe(WORK_NOTIFICATION_COPY.four_blocks_today);
    expect(hits[0].spec.category).toBe('PATTERN_ALERT');

    // Run cue scan a second time — must not double-fire.
    orch.scanCues();
    const hits2 = captured.filter((c) => c.spec.dedupe_key.startsWith('work:four_blocks_today:'));
    expect(hits2.length).toBe(1);

    orch.teardown();
  });

  it('#7 a single re-logged session does NOT count as four blocks (audit #159)', () => {
    const { store, orch, captured } = makeHarness();
    // ONE real session, logged four times with the SAME ts (a re-log /
    // duplicate write). Counting raw rows would fire four_blocks_today; the
    // distinct-by-ts Set must collapse them to one.
    const ts = NOW - 30 * MIN;
    const dup: FocusLogEntry = { ts, duration_min: 25, duration_ms: 25 * MIN };
    store.set('work', 'focus_log', [dup, dup, dup, dup]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hits = captured.filter((c) => c.spec.dedupe_key.startsWith('work:four_blocks_today:'));
    expect(hits.length).toBe(0);

    orch.teardown();
  });

  it('#7 four DISTINCT-ts sessions still fire even with extra dup rows (audit #159)', () => {
    const { store, orch, captured } = makeHarness();
    // Four distinct sessions plus a duplicate of one — distinct count is 4.
    const base = Array.from({ length: 4 }, (_, i) => ({
      ts: NOW - (i + 1) * 30 * MIN,
      duration_min: 25,
      duration_ms: 25 * MIN,
    })) as FocusLogEntry[];
    store.set('work', 'focus_log', [...base, base[0]!]);
    orch.init();
    vi.advanceTimersByTime(600);

    const hits = captured.filter((c) => c.spec.dedupe_key.startsWith('work:four_blocks_today:'));
    expect(hits.length).toBe(1);

    orch.teardown();
  });

  it('dedupe set persists across scans (no double-fire)', () => {
    const { store, orch, captured } = makeHarness();
    const meeting: Meeting = {
      id: 'm-dup',
      start_at: NOW + 30 * MIN,
      end_at: NOW + 60 * MIN,
    };
    store.set('work', 'meetings', [meeting]);
    orch.init();
    vi.advanceTimersByTime(600);

    const first = captured.filter((c) => c.spec.dedupe_key.startsWith('work:meeting_30m:')).length;
    orch.scanCues();
    orch.scanCues();
    const second = captured.filter((c) => c.spec.dedupe_key.startsWith('work:meeting_30m:')).length;
    expect(second).toBe(first);

    orch.teardown();
  });

  it('no cues fired when stores are empty', () => {
    const { orch, captured } = makeHarness();
    orch.init();
    vi.advanceTimersByTime(600);
    expect(captured.length).toBe(0);
    orch.teardown();
  });

  // audit #8 — narrow time windows must fire on the clock tick, not only on a
  // store-key change. The meeting is written OUTSIDE its 28–32 min window; no
  // further store write occurs. Only the 60s tick can move `now` into the
  // window and deliver the cue.
  it('#5 meeting_30m fires on the clock tick with no store change (audit #8)', () => {
    const captured: Captured[] = [];
    const store = createStore(createMemoryAdapter());
    let nowMs = NOW;
    const orch = createWorkOrchestrator(store, {
      now: () => nowMs,
      scheduleNotification: (spec, fireAt) => { captured.push({ spec, fireAt }); },
    });

    // Meeting starts 45 min out — well outside the 28–32 min window right now.
    const meeting: Meeting = {
      id: 'm-tick',
      start_at: NOW + 45 * MIN,
      end_at: NOW + 75 * MIN,
    };
    store.set('work', 'meetings', [meeting]);
    orch.init();
    vi.advanceTimersByTime(600); // boot scan — meeting still 45 min away

    expect(
      captured.filter((c) => c.spec.dedupe_key.startsWith('work:meeting_30m:')).length,
    ).toBe(0);

    // Advance wall-clock + drive the 60s ticks until the meeting is ~30 min
    // away (15 min later). No store write happens — the tick must catch it.
    for (let i = 0; i < 15; i++) {
      nowMs += MIN;
      vi.advanceTimersByTime(MIN);
    }

    const hit = captured.find((c) => c.spec.dedupe_key.startsWith('work:meeting_30m:'));
    expect(hit).toBeDefined();
    expect(hit?.spec.title).toBe(WORK_NOTIFICATION_COPY.meeting_30m);

    orch.teardown();
  });

  it('clock tick stops after teardown (audit #8)', () => {
    const captured: Captured[] = [];
    const store = createStore(createMemoryAdapter());
    let nowMs = NOW;
    const orch = createWorkOrchestrator(store, {
      now: () => nowMs,
      scheduleNotification: (spec, fireAt) => { captured.push({ spec, fireAt }); },
    });
    store.set('work', 'meetings', [
      { id: 'm-td', start_at: NOW + 45 * MIN, end_at: NOW + 75 * MIN } as Meeting,
    ]);
    orch.init();
    vi.advanceTimersByTime(600);
    orch.teardown();

    // After teardown the interval must be cleared — advancing into the window
    // fires nothing.
    for (let i = 0; i < 15; i++) {
      nowMs += MIN;
      vi.advanceTimersByTime(MIN);
    }
    expect(
      captured.filter((c) => c.spec.dedupe_key.startsWith('work:meeting_30m:')).length,
    ).toBe(0);
  });

  it('does not re-fire a cue after restart — dedupe persists in the store (audit #96)', () => {
    // A meeting exactly 30 min out — fires meeting_30m on the cold-start scan.
    const meeting: Meeting = {
      id: 'm-restart',
      title: 'standup',
      start_at: NOW + 30 * MIN,
      end_at: NOW + 45 * MIN,
    };
    const store = createStore(createMemoryAdapter());
    store.set('work', 'meetings', [meeting]);

    // First process: instance A fires once.
    const capturedA: Captured[] = [];
    const orchA = createWorkOrchestrator(store, {
      now: () => NOW,
      scheduleNotification: (spec, fireAt) => { capturedA.push({ spec, fireAt }); },
    });
    orchA.init();
    vi.advanceTimersByTime(600);
    orchA.teardown();
    expect(
      capturedA.filter((c) => c.spec.dedupe_key === 'work:meeting_30m:m-restart').length,
    ).toBe(1);
    // The fired key must be persisted so a restart can honor it.
    expect(store.get<string[]>('work', '_firedCueKeys', [])).toContain(
      'work:meeting_30m:m-restart',
    );

    // Restart: a brand-new instance B over the SAME store (in-memory Set is
    // gone). It must NOT re-fire the already-sent cue.
    const capturedB: Captured[] = [];
    const orchB = createWorkOrchestrator(store, {
      now: () => NOW,
      scheduleNotification: (spec, fireAt) => { capturedB.push({ spec, fireAt }); },
    });
    orchB.init();
    vi.advanceTimersByTime(600);
    orchB.teardown();
    expect(
      capturedB.filter((c) => c.spec.dedupe_key === 'work:meeting_30m:m-restart').length,
    ).toBe(0);
  });
});
