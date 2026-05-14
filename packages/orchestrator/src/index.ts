/**
 * @ollie/orchestrator — reactive glue between store, events, and logic.
 *
 * The only place that calls @ollie/logic.* functions.
 * UI components read already-computed values from @ollie/store.
 *
 * Phase 3d: cycle orchestrator wired.
 * Pets / body / grocery / sleep / finance / patterns / admin / dump composed.
 * Sprint 0 CL1a: habits / work / goals sub-orchestrators added.
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
import { createAdminOrchestrator } from './admin';
import { createDumpOrchestrator } from './dump';
import { createHabitsOrchestrator } from './habits';
import { createWorkOrchestrator } from './work';
import { createGoalsOrchestrator } from './goals';
import { createBurhanOrchestrator } from './burhan';
import { createMedicationOrchestrator } from './medication';

export type { Orchestrator } from './types';
export { createCycleOrchestrator } from './cycle';
export { createPetsOrchestrator } from './pets';
export { createBodyOrchestrator } from './body';
export { createGroceryOrchestrator } from './grocery';
export { createSleepOrchestrator } from './sleep';
export { createFinanceOrchestrator } from './finance';
export { createPatternsOrchestrator } from './patterns';
export { createAdminOrchestrator } from './admin';
export { createDumpOrchestrator } from './dump';
export { createHabitsOrchestrator } from './habits';
export { createWorkOrchestrator } from './work';
export { createGoalsOrchestrator } from './goals';
export { createBurhanOrchestrator } from './burhan';
export { createMedicationOrchestrator } from './medication';
export {
  computeWeeklyReview,
  emitWeeklyReview,
  scheduleWeeklyReview,
  nextSunday19,
  isoWeekKey,
  SPARSE_THRESHOLD,
} from './body-weekly';
export type { WeeklyReviewInput, WeeklyReviewResult, WeeklyReviewSummary, WeeklyReviewEmitOptions } from './body-weekly';

export interface RootOrchestrator extends Orchestrator {
  cycle: ReturnType<typeof createCycleOrchestrator>;
  pets: ReturnType<typeof createPetsOrchestrator>;
  body: ReturnType<typeof createBodyOrchestrator>;
  grocery: ReturnType<typeof createGroceryOrchestrator>;
  sleep: ReturnType<typeof createSleepOrchestrator>;
  finance: ReturnType<typeof createFinanceOrchestrator>;
  patterns: ReturnType<typeof createPatternsOrchestrator>;
  admin: ReturnType<typeof createAdminOrchestrator>;
  dump: ReturnType<typeof createDumpOrchestrator>;
  habits: ReturnType<typeof createHabitsOrchestrator>;
  work: ReturnType<typeof createWorkOrchestrator>;
  goals: ReturnType<typeof createGoalsOrchestrator>;
  burhan: ReturnType<typeof createBurhanOrchestrator>;
  medication: ReturnType<typeof createMedicationOrchestrator>;
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
  const adminOrch = createAdminOrchestrator(store);
  const dumpOrch = createDumpOrchestrator(store);
  const habitsOrch = createHabitsOrchestrator(store);
  const workOrch = createWorkOrchestrator(store);
  const goalsOrch = createGoalsOrchestrator(store);
  const burhanOrch = createBurhanOrchestrator(store);
  const medicationOrch = createMedicationOrchestrator(store);

  return {
    cycle: cycleOrch,
    pets: petsOrch,
    body: bodyOrch,
    grocery: groceryOrch,
    sleep: sleepOrch,
    finance: financeOrch,
    patterns: patternsOrch,
    admin: adminOrch,
    dump: dumpOrch,
    habits: habitsOrch,
    work: workOrch,
    goals: goalsOrch,
    burhan: burhanOrch,
    medication: medicationOrch,

    init() {
      cycleOrch.init();
      petsOrch.init();
      bodyOrch.init();
      groceryOrch.init();
      sleepOrch.init();
      financeOrch.init();
      patternsOrch.init();
      adminOrch.init();
      dumpOrch.init();
      habitsOrch.init();
      workOrch.init();
      goalsOrch.init();
      burhanOrch.init();
      medicationOrch.init();
    },

    teardown() {
      cycleOrch.teardown();
      petsOrch.teardown();
      bodyOrch.teardown();
      groceryOrch.teardown();
      sleepOrch.teardown();
      financeOrch.teardown();
      patternsOrch.teardown();
      adminOrch.teardown();
      dumpOrch.teardown();
      habitsOrch.teardown();
      workOrch.teardown();
      goalsOrch.teardown();
      burhanOrch.teardown();
      medicationOrch.teardown();
    },
  };
}
