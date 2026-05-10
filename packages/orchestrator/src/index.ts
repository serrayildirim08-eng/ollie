/**
 * @ollie/orchestrator — reactive glue between store, events, and logic.
 *
 * The only place that calls @ollie/logic.* functions.
 * UI components read already-computed values from @ollie/store.
 *
 * Phase 3d: cycle orchestrator wired.
 * Pets / body / grocery / sleep / finance / patterns come in follow-up phases.
 */

import type { Store } from '@ollie/store';
import type { Orchestrator } from './types';
import { createCycleOrchestrator } from './cycle';

export type { Orchestrator } from './types';
export { createCycleOrchestrator } from './cycle';

export interface RootOrchestrator extends Orchestrator {
  cycle: ReturnType<typeof createCycleOrchestrator>;
}

/**
 * Wire all sub-orchestrators and return a single object with `init()` /
 * `teardown()`. The `store` parameter is the @ollie/store singleton;
 * events are consumed from the @ollie/events module-level bus.
 */
export function createOrchestrator(store: Store): RootOrchestrator {
  const cycleOrch = createCycleOrchestrator(store);

  return {
    cycle: cycleOrch,

    init() {
      cycleOrch.init();
    },

    teardown() {
      cycleOrch.teardown();
    },
  };
}
