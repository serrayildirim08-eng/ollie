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
  detectRecurringEarly,
  predictNextDue,
  computeMonthlyOutflow,
  monthOverMonthDelta,
} from './recurring';
export type {
  RecurringCandidate,
  RecurringCandidateEvidence,
  RecurringCandidateCategory,
  EarlyConfidence,
  DetectRecurringEarlyOpts,
} from './recurring';
export { classifyRecurringCategory } from './recurring';
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
export {
  detectSavingsTransfers,
  matchTransfersToGoals,
  detectSavingsFromBraindump,
} from './savings-detection';
export type {
  SavingsTransfer,
  SavingsTransferConfidence,
  GoalAttribution,
  BraindumpSavingsCandidate,
} from './savings-detection';
export {
  detectADHDTaxFromTxn,
  detectDuplicatePurchases,
  detectADHDTaxFromBraindump,
} from './adhd-tax-detection';
export type {
  ADHDTaxCandidate,
  ADHDTaxCandidateCategory,
  ADHDTaxConfidence,
  DuplicatePurchase,
} from './adhd-tax-detection';

// ─── money-module gap closure ─────────────────────────────────────────
// Variable-income tracking. Renamed export to avoid collision with
// reports.ts:classifyPayFrequency (which has a different return shape).
export {
  classifyPayFrequency as classifyPayFrequencyDetailed,
  detectInvoicePayments,
  monthlyVolatility,
} from './income-detection';
export type {
  PayFrequencyLabel,
  PayFrequencyConfidence,
  PayFrequencyEvidence,
  ClassifyPayFrequencyResult,
  InvoicePayment,
  DetectInvoicePaymentsOpts,
  MonthlyVolatilityResult,
} from './income-detection';

// Tax set-aside calculator (US / UK / EU)
export {
  calculateUSSelfEmployedSetAside,
  calculateUKSelfEmployedSetAside,
  calculateEUFreelancerSetAside,
  monthlySetAsideReminder,
  FINANCE_TAX_SETASIDE_DUE_EVENT,
} from './tax-setaside';
export type {
  USState,
  USSetAsideOpts,
  USSetAsideResult,
  UKSetAsideResult,
  EUCountry,
  EUSetAsideResult,
  TaxCalculator,
  MonthlySetAsideReminder,
  FinanceTaxSetAsideDuePayload,
} from './tax-setaside';

// Subscription audit (heuristic dormancy detection) — see
// subscription-dormancy.ts. Pure client-side scoring; consumer must
// pass already-decrypted brain-dump entries.
export {
  SUBSCRIPTION_ALIASES,
  SUBSCRIPTION_ALIAS_COUNT,
  matchAliasKey,
  scanMentions,
} from './subscription-aliases';
export type { SubscriptionAliasKey, MentionScan } from './subscription-aliases';
export {
  SUBSCRIPTION_CANCEL_URLS,
  SUBSCRIPTION_CANCEL_URL_COUNT,
  APPLE_SUBSCRIPTIONS_DEEP_LINK,
  getCancelUrl,
  isAppleManaged,
} from './cancel-urls';
export { scoreDormancy, summarize } from './subscription-dormancy';
export type {
  DormancyRecommendation,
  DormancySignal,
  DormancySummary,
  StoredSubLike,
  BrainDumpEntry,
} from './subscription-dormancy';

// Export (CSV + structured annual ADHD-tax report)
export {
  exportToCSV,
  exportADHDTaxReport,
  encryptExport,
} from './export';
export type {
  ExportCSVOpts,
  MonthBreakdown,
  ExportADHDTaxReportResult,
  TaxCategory,
  EncryptedExportEnvelope,
  EncryptExportOpts,
  CryptoPrimitives,
} from './export';
