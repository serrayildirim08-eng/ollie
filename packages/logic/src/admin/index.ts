/**
 * @ollie/logic · admin public API
 *
 * All functions are pure: no wall-clock reads, no store access, no DOM.
 * `now` is always an explicit millisecond timestamp.
 */

export * from './types';
export {
  OPEN_LOOP_RE,
  IF_THEN_RE,
  PHONE_RE,
  FORM_RE,
  EMAIL_RE,
  WEB_RE,
  ONECLICK_RE,
  PAPERWORK_RE,
  DEFER_RE,
  TWOMIN_RE,
  PEAK_RE,
  LOW_EF_RE,
  CRASH_RE,
  DELAY_CUE_RE,
  SCHEDULE_RE,
  DECISION_TOPIC_RE,
  FIREHOSE_STOPWORDS,
  SOURCES,
} from './constants';

// Phase 1
export {
  detectOpenLoopMissing,
  detectPhoneTask,
  scheduleRenewalCues,
  detectStaleBall,
  classifyActivationCost,
  detectLast5Pct,
} from './phase1';

// Phase 2
export {
  detectPaperworkSplit,
  detectFirehoseDump,
  detectDeferChain,
  detectTwoMinuteTask,
  detectRecurringPattern,
} from './phase2';

// Phase 3
export {
  efCost,
  efStateFromDump,
  sortByState,
  getDocRefs,
  addDocRef,
  parseCostOfDelay,
  surfaceCostOfDelay,
  detectRecurringDecision,
  buildDecisionRecall,
  detectScheduleFromDump,
  detectScheduleDrift,
} from './phase3';
