/**
 * serverReminder · unit tests
 *
 * The injectable server-reminder seam: the pure handlers call
 * `scheduleServerReminder` fire-and-forget; the app composition root
 * installs the real durable path via `setServerReminder`.
 *
 * Coverage:
 *   1. default is a no-op — safe to call before the bridge is installed
 *      (i.e. not signed in / sync off) and never throws.
 *   2. setServerReminder installs a real fn that receives spec + fireAt.
 *   3. a throwing installed fn is swallowed (handler row write never breaks).
 *   4. clearServerReminder restores the no-op (sign-out / identity change).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scheduleServerReminder,
  setServerReminder,
  clearServerReminder,
} from './serverReminder';
import type { NotificationSpec } from '@ollie/notifications';

const spec: NotificationSpec = {
  title: 'call',
  body: 'mama',
  category: 'REMINDER',
  dedupe_key: 'reminder:task-1',
};

beforeEach(() => {
  clearServerReminder();
});

describe('scheduleServerReminder', () => {
  it('is a no-op by default (unauthed / bridge not installed) and never throws', () => {
    expect(() => scheduleServerReminder(spec, Date.now() + 60_000)).not.toThrow();
  });

  it('forwards spec + fireAt to the installed capability', () => {
    const installed = vi.fn();
    setServerReminder(installed);

    const fireAt = Date.now() + 60_000;
    scheduleServerReminder(spec, fireAt);

    expect(installed).toHaveBeenCalledOnce();
    expect(installed).toHaveBeenCalledWith(spec, fireAt);
  });

  it('swallows errors thrown by the installed capability', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setServerReminder(() => {
      throw new Error('boom');
    });

    expect(() => scheduleServerReminder(spec, Date.now())).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('clearServerReminder restores the no-op so a stale closure cannot fire', () => {
    const installed = vi.fn();
    setServerReminder(installed);
    clearServerReminder();

    scheduleServerReminder(spec, Date.now() + 60_000);
    expect(installed).not.toHaveBeenCalled();
  });
});
