/**
 * apps/native · notify/datelessLadderHook.ts  —  handler-side entry into the
 * date-less reminder ladder.
 *
 * The admin + work `create_task` handlers call this when a task is created. It
 * lazily resolves the app store singleton (so merely importing a handler in a
 * bare unit test never triggers the store's boot migrations) and starts the
 * ladder for a DATE-LESS task. No-op when a dueDate is present.
 *
 * Best-effort + fire-and-forget: a thrown store/ladder error never blocks the
 * task write (the row already landed by the time this runs).
 */

import type { LadderModule } from './datelessLadder';

export interface StartLadderInput {
  module: LadderModule;
  taskId: string;
  text: string;
  dueDate?: string | null;
  createdAt?: number;
}

/**
 * Start the date-less ladder for a freshly-created task. Async + best-effort —
 * the caller should `void` it. Resolves the store + ladder modules on demand.
 */
export async function startDatelessLadderFor(input: StartLadderInput): Promise<void> {
  try {
    // Fast exit before touching the store: a dated task uses the normal path.
    if (input.dueDate != null && input.dueDate.toString().trim() !== '') return;
    const [{ store }, ladder] = await Promise.all([
      import('../store'),
      import('./datelessLadder'),
    ]);
    ladder.startDatelessLadder(store, input);
  } catch (err) {
    console.error('[ladder] startDatelessLadderFor failed (non-fatal):', err);
  }
}

/**
 * Single chokepoint for "a task was completed" — cancels every remaining ladder
 * notification for the row and forgets its ladder state. Call from BOTH the
 * notification "Got it ✓" path AND every in-app completion (todo check-off, box
 * toggles). Idempotent + best-effort: harmless for a task that never had a
 * ladder (cancelLadder no-ops when no entry / no scheduled tier exists).
 */
export async function onTaskCompleted(module: LadderModule, taskId: string): Promise<void> {
  try {
    const [{ store }, ladder] = await Promise.all([
      import('../store'),
      import('./datelessLadder'),
    ]);
    ladder.cancelLadder(module, taskId, store);
  } catch (err) {
    console.error('[ladder] onTaskCompleted failed (non-fatal):', err);
  }
}
