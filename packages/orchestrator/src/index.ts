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
import type { NotificationSpec } from '@ollie/notifications';
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
import { scheduleWeeklyReview } from './body-weekly';
import { scheduleBodyCorrelationPass, runBodyCorrelationPass } from './body-correlations';
import { createOrphanCueBridge } from './orphan-cue-bridge';
import { createMatterRoutingOrchestrator } from './matter-routing';

export type { Orchestrator } from './types';
export { appendCapped, DEFAULT_DEDUP_CAP } from './dedup-store';
export { createCycleOrchestrator } from './cycle';
export { createPetsOrchestrator } from './pets';
export { createBodyOrchestrator } from './body';
export { createGroceryOrchestrator } from './grocery';
export { createSleepOrchestrator } from './sleep';
export { createFinanceOrchestrator } from './finance';
export { createPatternsOrchestrator } from './patterns';
export type { ModuleInsight } from './patterns';
export { createAdminOrchestrator } from './admin';
export { createDumpOrchestrator } from './dump';
export { createHabitsOrchestrator } from './habits';
export { createWorkOrchestrator } from './work';
export { createGoalsOrchestrator } from './goals';
export { createBurhanOrchestrator } from './burhan';
export { createMedicationOrchestrator } from './medication';
export {
  createOrphanCueBridge,
  appendCueTelemetry,
  BRIDGED_CUE_EVENTS,
  CUE_TELEMETRY_CAP,
} from './orphan-cue-bridge';
export type {
  BridgedCueEvent,
  CueTelemetryEntry,
  OrphanCueBridgeOptions,
} from './orphan-cue-bridge';
export {
  createResearchOrchestrator,
  runResearchPipeline,
  RESEARCH_INTAKE_EVENT,
  SCRUBBABLE_TABLES,
} from './research';
export type {
  LabelClient,
  ResearchOrchestratorOptions,
  ScrubbableTable,
  ScrubbableWrite,
} from './research';
export {
  computeWeeklyReview,
  emitWeeklyReview,
  scheduleWeeklyReview,
  nextSunday19,
  isoWeekKey,
  SPARSE_THRESHOLD,
} from './body-weekly';
export type { WeeklyReviewInput, WeeklyReviewResult, WeeklyReviewSummary, WeeklyReviewEmitOptions } from './body-weekly';
export {
  runBodyCorrelationPass,
  scheduleBodyCorrelationPass,
  nextLocal03,
  initPatternDetectedSubscriber,
} from './body-correlations';
export type {
  RunBodyCorrelationPassOpts,
  ScheduleBodyCorrelationPassOpts,
} from './body-correlations';
export { runBodySignalsPass } from './body-signals';
export type { RunBodySignalsOpts } from './body-signals';
export {
  routeBrainDump,
  dispatchAction,
  applyGroceryMutations,
  matchItem,
} from './braindump-dispatch';
export type {
  RouteBrainDumpResult,
  DispatchLocale,
  DispatchOptions,
  FinanceSlice,
  GroceryPurchaseEvent,
  GroceryRoutedItem,
  GroceryRoutedAction,
  GroceryRoutingResult,
  GroceryRoutingSource,
  GroceryListContext,
} from './braindump-dispatch';
export {
  createMatterRoutingOrchestrator,
  runMatterRoutingPass,
  collectRoutableDumps,
} from './matter-routing';
export type {
  MatterRoutingOptions,
  MatterRoutingPassResult,
  LooseDumpRef,
} from './matter-routing';

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
  orphanCueBridge: ReturnType<typeof createOrphanCueBridge>;
  matterRouting: ReturnType<typeof createMatterRoutingOrchestrator>;
}

export interface RootOrchestratorOptions {
  /** APNs push scheduler injected from the app layer. Passed through to
   *  cycle / sleep / body / habits / finance orchestrators. Omit in tests
   *  and contexts without APNs (desktop, web). */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
  /** Opt-in for ovulation notifications (cycle.cycle:ovulation_imminent). */
  ovulationOptIn?: boolean;
}

/**
 * Wire all sub-orchestrators and return a single object with `init()` /
 * `teardown()`. The `store` parameter is the @ollie/store singleton;
 * events are consumed from the @ollie/events module-level bus.
 */
export function createOrchestrator(
  store: Store,
  opts: RootOrchestratorOptions = {},
): RootOrchestrator {
  const cycleOrch = createCycleOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
    ovulationOptIn: opts.ovulationOptIn,
  });
  const petsOrch = createPetsOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const bodyOrch = createBodyOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const groceryOrch = createGroceryOrchestrator(store);
  const sleepOrch = createSleepOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const financeOrch = createFinanceOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const patternsOrch = createPatternsOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const adminOrch = createAdminOrchestrator(store);
  const dumpOrch = createDumpOrchestrator(store);
  const habitsOrch = createHabitsOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const workOrch = createWorkOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const goalsOrch = createGoalsOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  const burhanOrch = createBurhanOrchestrator(store);
  const medicationOrch = createMedicationOrchestrator(store, {
    scheduleNotification: opts.scheduleNotification,
  });
  // Audit #3: gives every orphan cross-module cue a real consumer.
  const orphanCueBridge = createOrphanCueBridge(store);
  // WORK-VISION Phase 2: batches dumps → matters (deterministic, no AI).
  const matterRoutingOrch = createMatterRoutingOrchestrator(store);

  // ── client-side timed passes ──────────────────────────────────────────
  // These two are NOT createXOrchestrator()-shaped — they are
  // self-arming schedulers that return a teardown fn. They are folded
  // into this root composer (not booted ad-hoc by the app) so they can
  // never be silently un-wired again — the architecture audit's
  // explicit recommendation. `init()` arms them; `teardown()` disarms.
  //   - scheduleWeeklyReview          → emits body:weekly_review Sun 19:00
  //   - scheduleBodyCorrelationPass   → emits pattern:detected daily 03:00
  //     (the ONLY emitter of pattern:detected — without this the
  //     initPatternDetectedSubscriber push path can never fire).
  let weeklyReviewTeardown: (() => void) | null = null;
  let bodyCorrelationTeardown: (() => void) | null = null;
  let firstCorrelationPass: ReturnType<typeof setTimeout> | null = null;

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
    orphanCueBridge,
    matterRouting: matterRoutingOrch,

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
      orphanCueBridge.init();
      matterRoutingOrch.init();

      // Arm the two timed passes. Idempotent — re-arming clears any
      // prior timer first.
      weeklyReviewTeardown?.();
      weeklyReviewTeardown = scheduleWeeklyReview({
        store,
        now: () => Date.now(),
        scheduleNotification: opts.scheduleNotification ?? null,
      });
      // `skipFirstRun` so the cold-start correlation pass does NOT run
      // synchronously inside init(): the app boot sequence may register
      // the `pattern:detected` push subscriber on the line AFTER
      // createOrchestrator().init(), and a synchronous first-pass emit
      // would land before that subscriber exists. We instead run the
      // first pass on a 0ms timer — after the synchronous boot finishes.
      bodyCorrelationTeardown?.();
      bodyCorrelationTeardown = scheduleBodyCorrelationPass({ store, skipFirstRun: true });
      if (firstCorrelationPass) clearTimeout(firstCorrelationPass);
      firstCorrelationPass = setTimeout(() => {
        firstCorrelationPass = null;
        try { runBodyCorrelationPass({ store }); } catch { /* non-fatal */ }
      }, 0);
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
      orphanCueBridge.teardown();
      matterRoutingOrch.teardown();

      weeklyReviewTeardown?.();
      weeklyReviewTeardown = null;
      bodyCorrelationTeardown?.();
      bodyCorrelationTeardown = null;
      if (firstCorrelationPass) { clearTimeout(firstCorrelationPass); firstCorrelationPass = null; }
    },
  };
}
