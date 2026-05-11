/**
 * @ollie/logic · finance public API
 *
 * All functions are pure: no wall-clock reads, no store access, no DOM.
 * `now` is always an explicit millisecond timestamp parameter.
 */

export * from './types';
export { normalizeMerchant, jaroSimilarity, jaroWinkler, merchantSimilarity } from './jaro';
export { isoDate, daysBetween, fMean, fMedian, fMad, DAY_MS } from './math';
export { parseFinanceDump } from './parse';
export { mergeRecord } from './merge';
export {
  detectRecurring,
  predictNextDue,
  computeMonthlyOutflow,
  monthOverMonthDelta,
} from './recurring';
export { detectAnomaly, detectPostPaydaySpikes, trackADHDTaxEvents, detectSubscriptionStale } from './anomaly';
export {
  savingsGoalProgress,
  upcomingBills,
  classifyPayFrequency,
  safeToSpend,
  forecast30d,
} from './reports';
export { spearmanRho, correlateFinanceWithCycle, correlateFinanceWithSleepDebt } from './correlate';
export { scoreBSAS, recordScaleResult, scaleCadenceStatus, BSAS_ITEMS, BSAS_CITED_URL } from './bsas';
export { detectPatterns, tagResearchLoops, RESEARCH_LOOP_RE } from './patterns';
export {
  detectSubscriptions,
  adhdTaxRunningTotal,
  detectCycleSpendingPattern,
  detectD3Patterns,
} from './pattern-detection';
export type {
  DetectedSubscriptionCard,
  DetectedSubscriptionCadence,
  ADHDTaxRunningTotal,
  CycleBoundary,
  CycleSpendingPatternCard,
  D3Output,
} from './pattern-detection';
export {
  computeSavings,
  monthsBetween,
  buildSavingsCardCopy,
  buildMonthlyDigestCopy,
  savingsThisMonth,
  cancellationsAccruedThisMonth,
} from './savings';
export type {
  Cancellation,
  SavingsEntry,
  SavingsTotals,
} from './savings';
