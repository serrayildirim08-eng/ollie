/**
 * remindIn.ts · unit tests
 *
 * Coverage:
 *   - computeScheduledAt: unit math + sanity-guard rejection paths
 *   - injectScheduledAt: absent / injected / dropped branches
 */

import { describe, it, expect } from 'vitest';
import {
  computeScheduledAt,
  injectScheduledAt,
  type RemindInResolved,
} from '../src/router/remindIn';

describe('computeScheduledAt', () => {
  const NOW = 1_700_000_000_000; // fixed deterministic anchor

  it('converts seconds correctly', () => {
    expect(computeScheduledAt(30, 'sec', NOW)).toBe(NOW + 30_000);
  });

  it('converts minutes correctly', () => {
    expect(computeScheduledAt(1, 'min', NOW)).toBe(NOW + 60_000);
    expect(computeScheduledAt(5, 'min', NOW)).toBe(NOW + 300_000);
  });

  it('converts hours correctly', () => {
    expect(computeScheduledAt(2, 'hr', NOW)).toBe(NOW + 7_200_000);
  });

  it('converts days correctly', () => {
    expect(computeScheduledAt(3, 'day', NOW)).toBe(NOW + 3 * 86_400_000);
  });

  it('returns null on unknown unit', () => {
    expect(computeScheduledAt(1, 'week', NOW)).toBeNull();
    expect(computeScheduledAt(1, '', NOW)).toBeNull();
  });

  it('returns null on non-positive amount', () => {
    expect(computeScheduledAt(0, 'min', NOW)).toBeNull();
    expect(computeScheduledAt(-5, 'min', NOW)).toBeNull();
  });

  it('returns null on non-finite amount', () => {
    expect(computeScheduledAt(Number.NaN, 'min', NOW)).toBeNull();
    expect(computeScheduledAt(Number.POSITIVE_INFINITY, 'min', NOW)).toBeNull();
  });

  it('enforces the 30-day sanity ceiling', () => {
    expect(computeScheduledAt(30, 'day', NOW)).toBe(NOW + 30 * 86_400_000);
    expect(computeScheduledAt(31, 'day', NOW)).toBeNull();
    expect(computeScheduledAt(5000, 'day', NOW)).toBeNull();
  });

  it('does NOT cap on the equivalent hour count (only day-unit is guarded)', () => {
    // 31 days expressed as hours stays under the day-guard ceiling on purpose
    // — the guard is about LLM-emitted units, not about absolute reach.
    expect(computeScheduledAt(31 * 24, 'hr', NOW)).toBe(NOW + 31 * 24 * 3_600_000);
  });
});

describe('injectScheduledAt', () => {
  const NOW = 1_700_000_000_000;

  it('returns absent when payload has no remindIn', () => {
    const payload: Record<string, unknown> = { module: 'admin', action: 'create_task', text: 'do x' };
    const status = injectScheduledAt(payload, NOW);
    expect(status.status).toBe('absent');
    expect(payload.remindIn).toBeUndefined();
  });

  it('injects scheduledAtMs on a valid hint and reports injected', () => {
    const payload: Record<string, unknown> = {
      module: 'admin',
      action: 'create_phone_task',
      person: 'mama',
      remindIn: { amount: 1, unit: 'min' },
    };
    const status = injectScheduledAt(payload, NOW);
    expect(status.status).toBe('injected');
    if (status.status === 'injected') {
      expect(status.scheduledAtMs).toBe(NOW + 60_000);
    }
    expect((payload.remindIn as RemindInResolved).scheduledAtMs).toBe(NOW + 60_000);
    expect((payload.remindIn as RemindInResolved).amount).toBe(1);
    expect((payload.remindIn as RemindInResolved).unit).toBe('min');
  });

  it('drops + removes a malformed remindIn (missing keys)', () => {
    const payload: Record<string, unknown> = {
      module: 'admin',
      action: 'create_task',
      text: 'x',
      remindIn: { foo: 'bar' },
    };
    const status = injectScheduledAt(payload, NOW);
    expect(status.status).toBe('dropped');
    if (status.status === 'dropped') {
      expect(status.reason).toBe('bad_shape');
    }
    expect(payload.remindIn).toBeUndefined();
  });

  it('drops + removes a remindIn whose amount/unit fails sanity', () => {
    const payload: Record<string, unknown> = {
      module: 'admin',
      action: 'create_task',
      text: 'x',
      remindIn: { amount: 5000, unit: 'day' },
    };
    const status = injectScheduledAt(payload, NOW);
    expect(status.status).toBe('dropped');
    if (status.status === 'dropped') {
      expect(status.reason).toBe('out_of_range');
    }
    expect(payload.remindIn).toBeUndefined();
  });

  it('drops on null remindIn (still object-shaped guard)', () => {
    const payload: Record<string, unknown> = {
      module: 'admin',
      action: 'create_task',
      text: 'x',
      remindIn: null,
    };
    const status = injectScheduledAt(payload, NOW);
    expect(status.status).toBe('dropped');
    expect(payload.remindIn).toBeUndefined();
  });
});
