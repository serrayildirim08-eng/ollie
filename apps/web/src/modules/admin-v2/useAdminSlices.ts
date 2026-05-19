/**
 * admin-v2 · useAdminSlices — live store bridge
 *
 * Subscribes to the EXISTING `admin.tasks` slice (the same key the live
 * `AdminModule` reads + writes) and returns it as one `AdminSlices` object
 * for the v2 selectors. Read-only here; mutations go through `useAdminActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes. Mirrors
 * body-v2/useBodySlices.ts.
 */
import { useMemo } from 'react';
import { useStoreSlice } from '../../store';
import type { AdminSlices, AdminItem } from './selectors';

export function useAdminSlices(): AdminSlices {
  const [tasks] = useStoreSlice<AdminItem[]>('admin', 'tasks', []);

  return useMemo<AdminSlices>(
    () => ({
      tasks: Array.isArray(tasks)
        ? tasks.filter((t): t is AdminItem => Boolean(t) && typeof t === 'object')
        : [],
    }),
    [tasks],
  );
}
