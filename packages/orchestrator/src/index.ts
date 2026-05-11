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
import { createPetsOrchestrator } from './pets';
import { createBodyOrchestrator } from './body';

export type { Orchestrator } from './types';
export { createCycleOrchestrator } from './cycle';
export { createPetsOrchestrator } from './pets';
export { createBodyOrchestrator } from './body';

export interface RootOrchestrator extends Orchestrator {
  cycle: ReturnType<typeof createCycleOrchestrator>;
  pets: ReturnType<typeof createPetsOrchestrator>;
  body: ReturnType<typeof createBodyOrchestrator>;
}

/**
 * Wire all sub-orchestrators and return a single object with `init()` /
 * `teardown()`. The `store` parameter is the @ollie/store singleton;
 * events are consumed from the @ollie/events module-level bus.
 */
export function createOrchestrator(store: Store): RootOrchestrator {
  const cycleOrch = createCycleOrchestrator(store);
  const petsOrch = createPetsOrchestrator(store);
  const bodyOrch = createBodyOrchestrator(store);

  return {
    cycle: cycleOrch,
    pets: petsOrch,
    body: bodyOrch,

    init() {
      cycleOrch.init();
      petsOrch.init();
      bodyOrch.init();
    },

    teardown() {
      cycleOrch.teardown();
      petsOrch.teardown();
      bodyOrch.teardown();
    },
  };
}
