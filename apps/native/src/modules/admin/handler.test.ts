/**
 * Admin module · handler unit tests
 *
 * Coverage:
 *   - undo for `create_task` removes the task row by id
 *   - undo for `log_renewal` removes the renewal row by id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  tasks: {
    add: vi.fn().mockResolvedValue({ id: 'task-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  renewals: {
    add: vi.fn().mockResolvedValue({ id: 'ren-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { tasks, renewals } from './repo';
import { adminHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('adminHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create_task: undo removes the task row by id', async () => {
    const fragment: Fragment = {
      text: 'call dentist',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'call dentist' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await adminHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(tasks.remove)).toHaveBeenCalledWith('task-id');
  });

  it('log_renewal: undo removes the renewal row by id', async () => {
    const fragment: Fragment = {
      text: 'passport renewal due march',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'log_renewal', renewal_type: 'passport', due_date: '2027-03-01' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await adminHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(renewals.remove)).toHaveBeenCalledWith('ren-id');
  });
});
