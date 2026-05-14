/**
 * Integration test: root orchestrator boot wires scheduleNotification
 * to all sub-orchestrators (finance baseline + body as P2 representative).
 *
 * Validates the injection point added in apps/web/src/store.ts so that
 * APNs server-side pushes actually fire end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, emit } from '@ollie/events';
import { createOrchestrator } from '../src/index';
import type { NotificationSpec } from '@ollie/notifications';

const FIXED_NOW = new Date('2026-05-14T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

describe('boot-layer scheduleNotification injection', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createOrchestrator>;
  let calls: Array<{ spec: NotificationSpec; fireAt: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    calls = [];
    orch = createOrchestrator(store, {
      scheduleNotification: (spec, fireAt) => { calls.push({ spec, fireAt }); },
    });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  // ── finance baseline (known-working pattern) ─────────────────────────────
  it('finance:bill_due_predicted → scheduleNotification called with REMINDER spec', () => {
    const dueAt = FIXED_NOW + 2 * DAY_MS;
    emit('finance:bill_due_predicted', {
      pattern_id: 'pat-netflix',
      merchant: 'netflix',
      amount: 15.99,
      due_at: dueAt,
      days_until: 2,
      ts: FIXED_NOW,
    });

    const financeCall = calls.find((c) => c.spec.dedupe_key?.startsWith('finance:bill_due_predicted'));
    expect(financeCall).toBeDefined();
    expect(financeCall!.spec.category).toBe('REMINDER');
    expect(financeCall!.spec.title).toContain('netflix');
    expect(financeCall!.spec.title).toContain('2 days');
    expect(financeCall!.spec.action_url).toBe('/finance');
  });

  // ── body (P2 representative) ──────────────────────────────────────────────
  it('body:supplement_due → scheduleNotification called with REMINDER spec', () => {
    emit('body:supplement_due', {
      supplementId: 'sup-mg',
      supplementName: 'magnesium',
      reminderHHMM: '08:00',
      ts: FIXED_NOW,
    });

    // supplement subscriber uses a 10ms flush timer
    vi.advanceTimersByTime(20);

    const bodyCall = calls.find((c) => c.spec.dedupe_key?.startsWith('body:supplement_due'));
    expect(bodyCall).toBeDefined();
    expect(bodyCall!.spec.category).toBe('REMINDER');
    expect(bodyCall!.spec.title).toBe('magnesium. just a heads up.');
    expect(bodyCall!.spec.action_url).toBe('/body');
  });

  it('body:posture_nudge → scheduleNotification called with REMINDER spec', () => {
    emit('body:posture_nudge', {
      hourBucket: 14,
      ts: FIXED_NOW,
    });

    const postureCall = calls.find((c) => c.spec.dedupe_key?.startsWith('body:posture_nudge'));
    expect(postureCall).toBeDefined();
    expect(postureCall!.spec.category).toBe('REMINDER');
    expect(postureCall!.spec.title).toBe('stand up. or sit better. either works.');
  });

  // ── no-injection guard ────────────────────────────────────────────────────
  it('scheduleNotification NOT called when not injected', () => {
    orch.teardown();
    _clearAllHandlers();
    const orchNoInject = createOrchestrator(store);
    orchNoInject.init();

    emit('finance:bill_due_predicted', {
      pattern_id: 'pat-x',
      merchant: 'spotify',
      amount: 9.99,
      due_at: FIXED_NOW + 2 * DAY_MS,
      days_until: 2,
      ts: FIXED_NOW,
    });
    emit('body:posture_nudge', { hourBucket: 10, ts: FIXED_NOW });
    vi.advanceTimersByTime(20);

    // calls array was created for the injected orch — it must still be empty
    expect(calls).toHaveLength(0);

    orchNoInject.teardown();
  });
});
