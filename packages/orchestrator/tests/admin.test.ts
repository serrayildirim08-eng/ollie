/**
 * @ollie/orchestrator · admin orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
import { createAdminOrchestrator } from '../src/admin';
import type { AdminTask } from '@ollie/logic/admin';
import type { AdminPattern, PhoneTaskItem } from '../src/admin';

// Fixed wall-clock: 2026-05-09T12:00:00Z
const NOW = new Date('2026-05-09T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

describe('admin orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createAdminOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createAdminOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('writes patternsLastComputedAt on init', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();
    const ts = store.get<number>('admin', 'patternsLastComputedAt', 0);
    expect(ts).toBe(NOW);
  });

  it('detects stale-ball and populates patterns slice', () => {
    // Task in THEIRS state for 20 days (> default 14d threshold)
    const tasks: AdminTask[] = [
      {
        id: 't1',
        label: 'send contract',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns!.some((p) => p.signal === 'admin_stale_ball')).toBe(true);
  });

  it('stamps a canonical hyphenated pattern id derived from signal', () => {
    const tasks: AdminTask[] = [
      {
        id: 't1',
        label: 'send contract',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const stale = patterns.find((p) => p.signal === 'admin_stale_ball');
    expect(stale).toBeDefined();
    // UI keys dismiss state on `pattern`, not `signal`.
    expect(stale!.pattern).toBe('stale-ball');
    // Every pattern object carries a non-empty pattern id.
    expect(patterns.every((p) => typeof p.pattern === 'string' && p.pattern.length > 0)).toBe(true);
  });

  it('gives distinct stale-ball notices distinct pattern identities', () => {
    // Two stale tasks → two notices that must NOT collapse to one dismiss key.
    const tasks: AdminTask[] = [
      { id: 'ta', label: 'send A', ball_state: 'waiting', last_transition_at: NOW - 20 * DAY_MS },
      { id: 'tb', label: 'send B', ball_state: 'waiting', last_transition_at: NOW - 25 * DAY_MS },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const stale = patterns.filter((p) => p.signal === 'admin_stale_ball');
    expect(stale).toHaveLength(2);
    // Same pattern label, distinct discriminator → distinct dismiss keys.
    expect(stale[0].pattern).toBe('stale-ball');
    expect(stale[1].pattern).toBe('stale-ball');
    expect(stale[0].task_id).not.toBe(stale[1].task_id);
  });

  it('emits admin:stale_ball for a new stale-ball pattern', () => {
    const emitted: Array<{ task_id: string; kind: string }> = [];
    const unsub = on('admin:stale_ball', (p) => {
      emitted.push(p as { task_id: string; kind: string });
    });

    const tasks: AdminTask[] = [
      {
        id: 't2',
        label: 'review draft',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();
    unsub();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].task_id).toBe('t2');
    expect(emitted[0].kind).toBe('untouched');
  });

  it('does not re-emit for a pattern already in the store', () => {
    // Pre-seed the patterns slice so the stale_ball entry is already known.
    const existing: AdminPattern[] = [
      {
        signal: 'admin_stale_ball',
        pattern: 'stale-ball',
        task_id: 't3',
        kind: 'untouched',
        days_overdue: 20,
        copy: 'already known',
        copy_es: '',
        sources: [],
        ts: NOW - DAY_MS,
      },
    ];
    store.set('admin', 'patterns', existing);

    const tasks: AdminTask[] = [
      {
        id: 't3',
        label: 'old task',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ];
    store.set('admin', 'tasks', tasks);

    const emitted: unknown[] = [];
    const unsub = on('admin:stale_ball', (p) => emitted.push(p));
    orch.init();
    unsub();

    expect(emitted).toHaveLength(0);
  });

  it('detects last-5pct and emits admin:last_5pct', () => {
    const emitted: Array<{ task_id: string; days_since_done: number }> = [];
    const unsub = on('admin:last_5pct', (p) => {
      emitted.push(p as { task_id: string; days_since_done: number });
    });

    const tasks: AdminTask[] = [
      {
        id: 't4',
        label: 'submit form',
        state: 'done',
        done_at: NOW - 7 * DAY_MS,
        // closed_at intentionally absent
      },
    ];
    store.set('admin', 'tasks', tasks);
    orch.init();
    unsub();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].task_id).toBe('t4');
    expect(emitted[0].days_since_done).toBe(7);
  });

  it('appends an admin:phone_task_detected signal to admin.phoneTasks', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();

    emit('admin:phone_task_detected', { verb: 'call', ts: NOW });

    const cluster = store.get<PhoneTaskItem[]>('admin', 'phoneTasks', []) ?? [];
    expect(cluster).toHaveLength(1);
    expect(cluster[0].verb).toBe('call');
    expect(cluster[0].id).toBe(`call:${NOW}`);
  });

  it('phoneTasks cluster is idempotent on a repeated verb+ts', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();

    emit('admin:phone_task_detected', { verb: 'call', ts: NOW });
    emit('admin:phone_task_detected', { verb: 'call', ts: NOW });

    expect(store.get('admin', 'phoneTasks', [])).toHaveLength(1);
  });

  it('emits a renewal-approaching offer (add_admin_task) within ~3 months', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    // Renewal due in ~60 days (inside the 90-day horizon).
    const due = new Date(NOW + 60 * DAY_MS);
    const dueDate = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}-${String(due.getUTCDate()).padStart(2, '0')}`;
    store.set('admin', 'renewals', [
      { id: 'r1', renewalType: 'passport', dueDate, addedAt: NOW },
    ]);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const offer = patterns.find((p) => p.pattern === 'renewal-offer:r1');
    expect(offer).toBeDefined();
    expect(offer!.signal).toBe('admin_renewal_offer');
    expect(offer!.actionKind).toBe('add_admin_task');
    expect(offer!.taskText).toBe('renew passport');
    expect(offer!.dueDate).toBe(dueDate);
    expect(offer!.category).toBe('renewal_due');
  });

  it('does NOT emit a renewal offer beyond the ~3-month horizon', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    const due = new Date(NOW + 200 * DAY_MS); // far out
    const dueDate = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}-${String(due.getUTCDate()).padStart(2, '0')}`;
    store.set('admin', 'renewals', [
      { id: 'r2', renewalType: 'lease', dueDate, addedAt: NOW },
    ]);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    expect(patterns.some((p) => p.pattern === 'renewal-offer:r2')).toBe(false);
  });

  // ── Wave 2 · renewal 3-tier escalation ────────────────────────────────────

  /** Build an ISO yyyy-mm-dd `days` out from NOW (UTC). */
  const isoFromNow = (days: number): string => {
    const d = new Date(NOW + days * DAY_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  it('renewal ~1 month out (≤30d) emits admin:renewal_notify_due AND keeps the card', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    store.set('admin', 'renewals', [
      { id: 'rN', renewalType: 'license', dueDate: isoFromNow(20), addedAt: NOW },
    ]);
    let notified: { renewal_id?: string; days_left?: number } | null = null;
    on('admin:renewal_notify_due', (raw) => { notified = raw as typeof notified; });
    orch.init();

    expect(notified).not.toBeNull();
    expect(notified!.renewal_id).toBe('rN');
    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const card = patterns.find((p) => p.pattern === 'renewal-offer:rN');
    expect(card).toBeDefined();
    expect(card!.tier).toBe('notify');
    expect(card!.actionKind).toBe('add_admin_task');
  });

  it('renewal ~1 week out (≤7d) emits admin:renewal_autotodo_due and NO card', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    store.set('admin', 'renewals', [
      { id: 'rA', renewalType: 'passport', dueDate: isoFromNow(5), addedAt: NOW },
    ]);
    let auto: { renewal_id?: string; renewalType?: string } | null = null;
    on('admin:renewal_autotodo_due', (raw) => { auto = raw as typeof auto; });
    orch.init();

    expect(auto).not.toBeNull();
    expect(auto!.renewal_id).toBe('rA');
    expect(auto!.renewalType).toBe('passport');
    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    // No surfaced add-to-todo card at the auto tier (the auto-add replaces it).
    expect(patterns.some((p) => p.pattern === 'renewal-offer:rA')).toBe(false);
  });

  it('renewal escalation events fire ONCE across recomputes (idempotent)', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    store.set('admin', 'renewals', [
      { id: 'rA', renewalType: 'passport', dueDate: isoFromNow(5), addedAt: NOW },
    ]);
    let autoCount = 0;
    on('admin:renewal_autotodo_due', () => { autoCount += 1; });
    orch.init();
    // Trigger another recompute synchronously by re-setting the input.
    store.set('admin', 'renewals', [
      { id: 'rA', renewalType: 'passport', dueDate: isoFromNow(5), addedAt: NOW },
    ]);

    expect(autoCount).toBe(1);
  });

  // ── Wave 2 · paperwork piling ─────────────────────────────────────────────

  it('emits a paperwork-pile offer when ≥3 paperwork tasks stalled ~2 weeks', () => {
    const stale = NOW - 20 * DAY_MS;
    store.set('admin', 'tasks', [
      { id: 'p1', label: 'tax form', kind: 'paperwork', state: 'active', last_transition_at: stale },
      { id: 'p2', label: 'visa form', kind: 'paperwork', state: 'active', last_transition_at: stale },
      { id: 'p3', label: 'insurance form', kind: 'paperwork', state: 'active', last_transition_at: stale },
    ] as AdminTask[]);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const pile = patterns.find((p) => p.pattern === 'paperwork-pile');
    expect(pile).toBeDefined();
    expect(pile!.actionKind).toBe('surface_tasks');
    expect(pile!.taskIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('does NOT emit a paperwork-pile offer with fewer than 3 stalled', () => {
    const stale = NOW - 20 * DAY_MS;
    store.set('admin', 'tasks', [
      { id: 'p1', label: 'tax form', kind: 'paperwork', state: 'active', last_transition_at: stale },
      { id: 'p2', label: 'visa form', kind: 'paperwork', state: 'active', last_transition_at: stale },
    ] as AdminTask[]);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    expect(patterns.some((p) => p.pattern === 'paperwork-pile')).toBe(false);
  });

  // ── Wave 2 · renewal cluster ──────────────────────────────────────────────

  it('emits a renewal-cluster offer when 2+ renewals land the same month', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    // NOW = 2026-05-09; +35d = 2026-06-13, +38d = 2026-06-16 → same month.
    const a = isoFromNow(35);
    const b = isoFromNow(38);
    const monthKey = a.slice(0, 7);
    expect(b.slice(0, 7)).toBe(monthKey); // guard: same month for the fixture
    store.set('admin', 'renewals', [
      { id: 'c1', renewalType: 'passport', dueDate: a, addedAt: NOW },
      { id: 'c2', renewalType: 'license', dueDate: b, addedAt: NOW },
    ]);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const cluster = patterns.find((p) => p.pattern === `renewal-cluster:${monthKey}`);
    expect(cluster).toBeDefined();
    expect(cluster!.actionKind).toBe('batch_block');
    expect(cluster!.renewalIds).toEqual(['c1', 'c2']);
    expect(typeof cluster!.batchFireAtMs).toBe('number');
    expect(Number.isFinite(cluster!.batchFireAtMs)).toBe(true);
  });

  it('emits a stale-decision offer (surface_decision) after ~14 days', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    store.set('admin', 'decisions', [
      { id: 'd1', what: 'gym membership', createdAt: NOW - 20 * DAY_MS },
    ]);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const offer = patterns.find((p) => p.pattern === 'decision-stale:d1');
    expect(offer).toBeDefined();
    expect(offer!.signal).toBe('admin_decision_stale');
    expect(offer!.actionKind).toBe('surface_decision');
    expect(offer!.decisionId).toBe('d1');
    expect(offer!.decisionWhat).toBe('gym membership');
    expect(offer!.category).toBe('pending_decision');
  });

  it('does NOT emit a stale-decision offer for a fresh decision', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    store.set('admin', 'decisions', [
      { id: 'd2', what: 'netflix', createdAt: NOW - 3 * DAY_MS }, // < 14 days
    ]);
    orch.init();

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    expect(patterns.some((p) => p.pattern === 'decision-stale:d2')).toBe(false);
  });

  it('teardown stops subscriptions and prevents recompute', () => {
    store.set('admin', 'tasks', [] as AdminTask[]);
    orch.init();
    orch.teardown();

    // Sentinel: clear patterns after teardown
    store.set('admin', 'patterns', [] as AdminPattern[]);

    // Mutate tasks — should NOT trigger a recompute
    store.set('admin', 'tasks', [
      {
        id: 't5',
        label: 'should-not-fire',
        ball_state: 'waiting',
        last_transition_at: NOW - 20 * DAY_MS,
      },
    ] as AdminTask[]);

    const patterns = store.get<AdminPattern[]>('admin', 'patterns', []);
    expect(patterns).toHaveLength(0);
  });
});
