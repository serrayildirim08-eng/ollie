import { describe, it, expect } from 'vitest';
import { routeNotificationAction, ACTION_COMPLETE, ACTION_SNOOZE } from './notificationActions';

describe('routeNotificationAction', () => {
  it('complete + valid admin meta', () => {
    expect(routeNotificationAction(ACTION_COMPLETE, { module: 'admin', refId: 't1' }))
      .toEqual({ op: 'complete', meta: { module: 'admin', refId: 't1' } });
  });
  it('snooze + valid work meta', () => {
    expect(routeNotificationAction(ACTION_SNOOZE, { module: 'work', refId: 'w9' }))
      .toEqual({ op: 'snooze', meta: { module: 'work', refId: 'w9' } });
  });
  it('ignores unknown action id', () => {
    expect(routeNotificationAction('nope', { module: 'admin', refId: 't1' })).toBeNull();
  });
  it('ignores missing meta', () => {
    expect(routeNotificationAction(ACTION_COMPLETE, undefined)).toBeNull();
  });
  it('ignores bad module', () => {
    expect(routeNotificationAction(ACTION_COMPLETE, { module: 'grocery' as 'admin', refId: 't1' })).toBeNull();
  });
  it('ignores missing refId', () => {
    expect(routeNotificationAction(ACTION_COMPLETE, { module: 'admin' })).toBeNull();
  });
  it('ignores default tap (no actionId)', () => {
    expect(routeNotificationAction(undefined, { module: 'admin', refId: 't1' })).toBeNull();
  });
});
