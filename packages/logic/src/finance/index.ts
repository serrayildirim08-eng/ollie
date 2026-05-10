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
