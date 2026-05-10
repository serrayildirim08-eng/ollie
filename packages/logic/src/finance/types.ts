/**
 * @ollie/logic · finance types
 */

export type Direction = 'in' | 'out';
export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular';
export type PatternStatus = 'mature' | 'early_detection';
export type PatternKind = 'income' | 'bill' | 'subscription';
export type ADHDTaxType = 'late_fee' | 'replacement' | 'unused' | 'duplicate';
export type AnomalyFraming = 'high' | 'low';
export type BSASCategory = 'at_risk_screen' | 'within_normal_range';
export type PayFrequency = 'weekly' | 'biweekly' | 'monthly' | 'irregular' | 'cold_start';
export type PayConfidence = 'high' | 'medium' | 'low' | 'prior';
export type BandConfidence = 'high' | 'medium' | 'low';

export interface FinanceRecord {
  id?: string;
  created_at?: number;
  last_edited_at?: number;
  extractor_version?: string;
  raw_source_id?: string | null;
  raw_span?: { start: number; end: number } | null;
  event_date: string;           // YYYY-MM-DD
  amount: number | null;
  currency: string;
  merchant: string | null;
  merchant_normalized: string | null;
  category?: string | null;
  notes?: string | null;
  direction: Direction;
  tokens?: string[];
  is_adhd_tax?: boolean;
  adhd_tax_type?: ADHDTaxType | null;
  cycle_phase?: string | null;
  journal_entry_ids?: string[];
  kind?: string;
  sub_meta?: { marked_to_cancel_at?: number };
  returnable_until?: number;
  return_status?: string;
}

export interface ParsedFinanceDump {
  record: Omit<FinanceRecord, 'id' | 'created_at' | 'last_edited_at'> | null;
  span: { start: number; end: number } | null;
}

export interface RecurringPattern {
  id: string;
  merchant_normalized: string;
  display_name: string | undefined;
  record_ids: string[];
  cadence: Cadence;
  interval_days_median: number;
  interval_days_mad: number;
  amount_median: number | null;
  amount_mad: number;
  last_at: number;
  first_seen_at: number;
  last_seen_at: number;
  status: PatternStatus;
  kind: PatternKind;
  user_dismissed_stale: boolean;
  key?: string;
  cusum_split_parent_id?: string;
}

export interface DetectRecurringResult {
  recurring: RecurringPattern[];
  earlyDetection: RecurringPattern[];
  oneOffs: FinanceRecord[];
}

export interface NextDuePrediction {
  dueAt: number | null;
  confidence: BandConfidence;
  rangeDays: number | null;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  modZ: number | null;
  framing: AnomalyFraming | null;
}

export interface PostPaydaySpike {
  spike_id: string;
  income_record_id: string | undefined;
  day_offset: number;
  spike_date: string;
  day_total: number;
  personal_28d_median: number;
  ratio: number;
  modZ: number;
  framing: 'observation';
}

export interface MonthlyFlowResult {
  outflow: number;
  inflow: number;
  count: number;
  net: number;
}

export interface MoMDelta {
  thisMonth: number;
  baseline: number;
  delta: number;
  direction: 'up' | 'down' | 'flat';
}

export interface ADHDTaxSummary {
  count: number;
  total: number;
  byType: Record<string, { count: number; total: number }>;
}

export interface StaleSubscription {
  pattern_id: string;
  display_name: string | undefined;
  days_since: number;
  cadence: Cadence;
}

export interface SavingsGoal {
  target: number;
  saved?: number;
  contributions?: Array<{ amount?: number; ts?: number }>;
}

export interface SavingsGoalProgressResult {
  saved: number;
  target: number;
  remaining: number;
  pace: { monthlyContribution: number; eta: number | null } | null;
}

export interface UpcomingBill {
  bill: RecurringPattern;
  daysUntil: number;
  dueAt: number;
  confidence: BandConfidence;
}

export interface BLSPrior {
  mode: string;
  intervalDaysCentral: number;
  intervalDaysSigma: number;
}

export interface PayFrequencyResult {
  freq: PayFrequency;
  confidence: PayConfidence;
  interval_days_median: number | null;
  interval_days_mad: number | null;
  cold_start: boolean;
  prior?: BLSPrior;
  n_events: number;
}

export interface ContributingPattern {
  id: string;
  kind: 'income' | 'bill';
  expected: number;
  hits?: number;
}

export interface SpendBand {
  central: number;
  sigma: number;
  band: [number, number];
  horizonDays: number;
  cold_start: boolean;
  contributing_patterns: ContributingPattern[];
}

export interface SpearmanResult {
  rho: number;
  n: number;
}

export interface CycleFinanceCorrelation {
  luteal_median_daily: number;
  follicular_median_daily: number;
  menstrual_median_daily: number;
  ovulation_median_daily: number;
  luteal_vs_rest_ratio: number;
  spearman_rho: number;
  n_days: number;
  n_cycles: number;
  cited_urls: string[];
}

export interface SleepFinanceCorrelation {
  spearman_rho: number;
  n_days: number;
  low_sleep_days_median_spend: number;
  normal_sleep_days_median_spend: number;
  cited_urls: string[];
  confidence: 'low';
}

export interface BSASItem {
  id: string;
  component: string;
  text: string;
}

export interface BSASResult {
  scale: 'bsas';
  score: number;
  max_score: number;
  category: BSASCategory;
  subscore_at_risk: number;
  itemCount: number;
  item_responses: number[];
  cited_url: string;
}

export interface ScaleHistoryEntry {
  scale: string;
  date: string;
  score: number;
  components: {
    item_responses?: number[];
    subscore_at_risk?: number;
    category?: string;
  };
  cited_url: string;
}

export interface RecordScaleResult {
  history: ScaleHistoryEntry[];
  appended: boolean;
  reason: string;
  days_remaining?: number;
}

export interface ScaleCadenceStatus {
  last_admin_at: string | null;
  days_since: number | null;
  next_eligible_at: string | null;
  quarterly_due: boolean;
}

export interface FinanceSource {
  citation: string;
  url: string;
}

export interface PatternCard {
  pattern: string;
  copy: string;
  copy_es?: string;
  source?: FinanceSource;
  record_id?: string | undefined;
  prior_id?: string;
  similarity?: number;
  loop_id?: string;
  mention_count?: number;
  burst_count?: number;
  category?: string;
  ids?: string[];
  days_marked?: number;
  days_left?: number;
  floor?: number;
  ceiling?: number;
  variance_pct?: number;
  months_observed?: number;
}

export interface DumpEntry {
  ts: number;
  text: string;
}

export interface ResearchLoop {
  id: string;
  topic_key: string;
  product_key: string;
  mentions: Array<{ dump_ts: number; at: number }>;
  deadline_at: number | null;
  parked_at: number | null;
  last_mentioned_at?: number;
  count?: number;
}

export interface DetectPatternsState {
  now: number;
  records: FinanceRecord[];
  dumps: DumpEntry[];
  research_loops: ResearchLoop[];
}

export interface FinanceSettings {
  buffer_pct?: number;
  price_drift_tolerance?: number;
}
