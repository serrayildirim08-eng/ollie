import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emit,
  on,
  once,
  REGISTRY,
  SHAPES,
  validatePayload,
  _clearAllHandlers,
} from '../src/index';

describe('@ollie/events · runtime', () => {
  beforeEach(() => {
    _clearAllHandlers();
  });

  it('delivers an event to a subscriber', () => {
    const seen: unknown[] = [];
    on('cycle:period_logged', (p) => seen.push(p));
    emit('cycle:period_logged', { ts: 123, source: 'user' });
    expect(seen).toEqual([{ ts: 123, source: 'user' }]);
  });

  it('returns an unsubscribe function from on()', () => {
    const seen: unknown[] = [];
    const unsub = on('cycle:period_logged', (p) => seen.push(p));
    emit('cycle:period_logged', { ts: 1, source: 'user' });
    unsub();
    emit('cycle:period_logged', { ts: 2, source: 'user' });
    expect(seen).toHaveLength(1);
  });

  it('once() fires only the first event', () => {
    const seen: unknown[] = [];
    once('cycle:period_logged', (p) => seen.push(p));
    emit('cycle:period_logged', { ts: 1, source: 'user' });
    emit('cycle:period_logged', { ts: 2, source: 'user' });
    expect(seen).toHaveLength(1);
  });

  it('a thrown handler does not block other subscribers', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: unknown[] = [];
    on('cycle:period_logged', () => {
      throw new Error('boom');
    });
    on('cycle:period_logged', (p) => seen.push(p));
    emit('cycle:period_logged', { ts: 1, source: 'user' });
    expect(seen).toHaveLength(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('warns on unregistered event names but still dispatches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    on('not:a:real:event', (p) => seen.push(p));
    emit('not:a:real:event', { foo: 1 });
    expect(warn).toHaveBeenCalled();
    expect(seen).toEqual([{ foo: 1 }]);
    warn.mockRestore();
  });

  it('drops emit on payload shape mismatch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    on('cycle:period_logged', (p) => seen.push(p));
    emit('cycle:period_logged', { ts: 123 }); // missing `source`
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('@ollie/events · registry + shapes', () => {
  it('has expected events registered', () => {
    expect(REGISTRY).toHaveProperty('cycle:period_logged');
    expect(REGISTRY).toHaveProperty('void:braindump:submitted');
    expect(REGISTRY).toHaveProperty('pets:care_logged');
    expect(REGISTRY).toHaveProperty('finance:record_added');
  });

  it('SHAPES is a subset of REGISTRY', () => {
    for (const name of Object.keys(SHAPES)) {
      expect(REGISTRY).toHaveProperty(name);
    }
  });

  it('validatePayload accepts both v:2 and v:1 braindump shapes', () => {
    expect(
      validatePayload('void:braindump:submitted', {
        v: 2,
        items: [],
        raw: 'hi',
        ts: 1,
        idempotency_key: 'k',
        route_path: '/',
      }),
    ).toEqual({ ok: true });

    expect(
      validatePayload('void:braindump:submitted', { id: 'x', text: 'hi', ts: 1 }),
    ).toEqual({ ok: true });
  });

  it('validatePayload rejects a braindump that matches neither shape', () => {
    const result = validatePayload('void:braindump:submitted', { foo: 'bar' });
    expect(result.ok).toBe(false);
  });

  it('events without a SHAPES entry are accepted', () => {
    expect(validatePayload('grocery:duplicate_detected', { whatever: true })).toEqual({ ok: true });
  });
});
