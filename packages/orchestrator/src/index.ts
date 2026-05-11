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
import { createGroceryOrchestrator } from './grocery';
import { createSleepOrchestrator } from './sleep';
import { createFinanceOrchestrator } from './finance';
import { createPatternsOrchestrator } from './patterns';

export type { Orchestrator } from './types';
export { createCycleOrchestrator } from './cycle';
export { createPetsOrchestrator } from './pets';
export { createBodyOrchestrator } from './body';
export { createGroceryOrchestrator } from './grocery';
export { createSleepOrchestrator } from './sleep';
export { createFinanceOrchestrator } from './finance';
export { createPatternsOrchestrator } from './patterns';

export interface RootOrchestrator extends Orchestrator {
  cycle: ReturnType<typeof createCycleOrchestrator>;
  pets: ReturnType<typeof createPetsOrchestrator>;
  body: ReturnType<typeof createBodyOrchestrator>;
  grocery: ReturnType<typeof createGroceryOrchestrator>;
  sleep: ReturnType<typeof createSleepOrchestrator>;
  finance: ReturnType<typeof createFinanceOrchestrator>;
  patterns: ReturnType<typeof createPatternsOrchestrator>;
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
  const groceryOrch = createGroceryOrchestrator(store);
  const sleepOrch = createSleepOrchestrator(store);
  const financeOrch = createFinanceOrchestrator(store);
  const patternsOrch = createPatternsOrchestrator(store);

  return {
    cycle: cycleOrch,
    pets: petsOrch,
    body: bodyOrch,
    grocery: groceryOrch,
    sleep: sleepOrch,
    finance: financeOrch,
    patterns: patternsOrch,

    init() {
      cycleOrch.init();
      petsOrch.init();
      bodyOrch.init();
      groceryOrch.init();
      sleepOrch.init();
      financeOrch.init();
      patternsOrch.init();
    },

    teardown() {
      cycleOrch.teardown();
      petsOrch.teardown();
      bodyOrch.teardown();
      groceryOrch.teardown();
      sleepOrch.teardown();
      financeOrch.teardown();
      patternsOrch.teardown();
    },
  };
}
