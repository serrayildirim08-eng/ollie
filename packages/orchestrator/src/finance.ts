/**
 * @ollie/orchestrator · finance
 *
 * Ported from window.VOID.orchestrator.finance in void-app.html (~lines 27100–27570).
 * The only caller of @ollie/logic/finance functions.
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "finance"):
 *   records                 FinanceRecord[]       raw + ingested records
 *   recurring               RecurringPattern[]    from detectRecurring
 *   earlyDetection          RecurringPattern[]    immature patterns
 *   monthly                 MonthlyFlowResult     from computeMonthlyOutflow
 *   momDelta                MoMDelta              from monthOverMonthDelta
 *   adhdTax                 ADHDTaxSummary        from trackADHDTaxEvents
 *   staleSubs               StaleSubscription[]   from detectSubscriptionStale
 *   upcoming                UpcomingBill[]        from upcomingBills
 *   incomePatterns          RecurringPattern[]    income-only recurring
 *   payFrequency            PayFrequencyResult    from classifyPayFrequency
 *   safeToSpend             SpendBand             from safeToSpend
 *   forecast30d             object                from forecast30d
 *   anomalies               AnomalyCard[]         Iglewicz-Hoaglin anomaly cards
 *   postPaydaySpikes        PostPaydaySpike[]     from detectPostPaydaySpikes
 *   patterns                PatternCard[]         F1-F7 render-cards
 *   research_loops          ResearchLoop[]        tagged research-paralysis loops
 *   lastRecomputeAt         number
 *
 * Events emitted:
 *   finance:record_added             — new FinanceRecord ingested from a dump item
 *   finance:pattern_detected         — new PatternCard pattern key observed
 *   finance:bill_due_predicted       — upcoming bill within 3 days (for push scheduling)
 *
 * Push notifications (APNs pipeline):
 *   Subscribers added in init() listen to the 4 finance events listed in the brief
 *   and call the injected scheduleNotification() callback with a NotificationSpec.
 *   The callback is optional — no-op when not injected (e.g. in tests or desktop).
 *   Caller (app boot) injects a wrapper around scheduleServerJob().
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import {
  parseFinanceDump,
  mergeRecord,
  detectRecurring,
  detectRecurringEarly,
  computeMonthlyOutflow,
  monthOverMonthDelta,
  trackADHDTaxEvents,
  detectSubscriptionStale,
  upcomingBills,
  classifyPayFrequency,
  safeToSpend,
  forecast30d,
  detectAnomaly,
  detectPostPaydaySpikes,
  detectPatterns,
  tagResearchLoops,
  detectD3Patterns,
  computeSavings,
  detectSavingsTransfers,
  detectSavingsFromBraindump,
  detectADHDTaxFromTxn,
  detectDuplicatePurchases,
  detectADHDTaxFromBraindump,
} from '@ollie/logic/finance';
import type {
  DetectedSubscriptionCard,
  ADHDTaxRunningTotal as D3ADHDTaxRunningTotal,
  CycleSpendingPatternCard,
  CycleBoundary,
  Cancellation,
  SavingsTotals,
  SavingsTransfer,
  ADHDTaxCandidate,
  DuplicatePurchase,
} from '@ollie/logic/finance';
import type {
  FinanceRecord,
  RecurringPattern,
  PatternCard,
  ResearchLoop,
  DumpEntry,
} from '@ollie/logic/finance';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;
const MAX_DUMP_LEN = 4000;

export interface FinanceOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /**
   * Optional push-notification scheduler injected by the app layer.
   * When present, the orchestrator calls it with a NotificationSpec + fireAt
   * for each finance event that warrants a server-side scheduled push.
   * Wraps scheduleServerJob() from @ollie/notifications/server-schedule.
   * Omit in tests or environments without APNs (desktop, web).
   */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
}

// Settings shape mirroring DEFAULT_SETTINGS in void-app.html §finance.orchestrator.
interface FinanceSettings {
  currency: string;
  currency_symbol: string;
  week_starts: string;
  month_anchor: number;
  show_monthly_outflow: boolean;
  show_recurring_detection: boolean;
  show_anomaly_flags: boolean;
  show_stale_subscriptions: boolean;
  show_safe_to_spend: boolean;
  show_forecast_band: boolean;
  show_post_payday_spikes: boolean;
  // §9.18 default off — cross-module correlations are opt-in
  show_cross_cycle_correlation: boolean;
  show_cross_sleep_correlation: boolean;
  stale_subscription_threshold_days: number;
  anomaly_modified_z_threshold: number;
  price_drift_tolerance: number;
  buffer_pct: number;
  recurring_maturity_minocc: number;
  categories: string[];
  adhd_tax_types: string[];
  dismissed_stale_pattern_ids: string[];
  dismissed_anomaly_ids: string[];
  scale_history: unknown[];
}

const DEFAULT_SETTINGS: FinanceSettings = {
  currency: 'USD',
  currency_symbol: '$',
  week_starts: 'mon',
  month_anchor: 1,
  show_monthly_outflow: true,
  show_recurring_detection: true,
  show_anomaly_flags: true,
  show_stale_subscriptions: true,
  show_safe_to_spend: true,
  show_forecast_band: true,
  show_post_payday_spikes: true,
  show_cross_cycle_correlation: false,
  show_cross_sleep_correlation: false,
  stale_subscription_threshold_days: 90,
  anomaly_modified_z_threshold: 3.5,
  price_drift_tolerance: 0.15,
  buffer_pct: 0.10,
  recurring_maturity_minocc: 3,
  categories: [],
  adhd_tax_types: ['late_fee', 'replacement', 'unused', 'duplicate', 'other'],
  dismissed_stale_pattern_ids: [],
  dismissed_anomaly_ids: [],
  scale_history: [],
};

interface DumpItem {
  ts?: number;
  text?: string;
  data?: string;
  action?: string;
}

interface ProcessResult {
  ok: boolean;
  reason?: string;
  id?: string;
}

interface AnomalyCard {
  id: string;
  pattern_id: string;
  record_id: string;
  merchant: string | null;
  amount: number;
  median: number | null;
  modZ: number | null;
  framing: string | null;
  event_date: string;
}

export function createFinanceOrchestrator(
  store: Store,
  opts: FinanceOrchestratorOptions = {},
): Orchestrator & { processDump(item: DumpItem): ProcessResult; processBacklog(): void; recomputeDerived(): void } {
  const getNow = opts.now ?? (() => Date.now());
  const scheduleNotification = opts.scheduleNotification ?? null;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── helpers ───────────────────────────────────────────────────────────────

  function getSettings(): FinanceSettings {
    const s = store.get<Partial<FinanceSettings> | null>('finance', 'settings', undefined) ?? null;
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  }

  function getRecords(): FinanceRecord[] {
    return store.get<FinanceRecord[]>('finance', 'records', []) ?? [];
  }

  function setRecords(v: FinanceRecord[]): void {
    store.set('finance', 'records', v);
  }

  function setKey(k: string, v: unknown): void {
    store.set('finance', k, v);
  }

  // ── processDump ───────────────────────────────────────────────────────────

  function processDump(dumpItem: DumpItem): ProcessResult {
    if (!dumpItem || !dumpItem.ts) return { ok: false, reason: 'no-ts' };
    const raw = dumpItem.text ?? dumpItem.data ?? '';
    if (!raw || raw.length > MAX_DUMP_LEN) return { ok: false, reason: 'empty-or-too-long' };
    const settings = getSettings();
    const parsed = parseFinanceDump(raw, dumpItem.ts, undefined, settings.currency);
    if (!parsed || !parsed.record) return { ok: false, reason: 'no-finance-content' };

    const records = getRecords();
    if (records.some((r) => r.raw_source_id === String(dumpItem.ts))) {
      return { ok: true, reason: 'already-processed' };
    }

    const built = mergeRecord(null, { ...parsed.record, raw_source_id: String(dumpItem.ts) } as FinanceRecord, dumpItem.ts);
    const next = [...records, built].sort((a, b) =>
      (a.event_date ?? '').localeCompare(b.event_date ?? ''),
    );
    setRecords(next);

    try {
      events.emit('finance:record_added', {
        id: built.id,
        kind: built.kind,
        amount: built.amount,
        direction: built.direction,
        merchant: built.merchant,
        merchant_normalized: built.merchant_normalized,
        category: built.category,
        is_adhd_tax: built.is_adhd_tax,
        ts: dumpItem.ts,
      });
    } catch { /* non-fatal */ }

    return { ok: true, id: built.id };
  }

  // ── recomputeDerived ──────────────────────────────────────────────────────

  function recomputeDerived(): void {
    try {
      const records = getRecords();
      const settings = getSettings();
      const now = getNow();
      const rawDumps = store.get<Array<{ ts?: number; text?: string }>>('dump', 'items', []) ?? [];
      // Filter to well-formed DumpEntry shape required by logic functions.
      const dumps: DumpEntry[] = rawDumps
        .filter((d): d is DumpEntry => typeof d?.ts === 'number' && typeof d?.text === 'string');

      const detect = detectRecurring(records, { minOccurrences: settings.recurring_maturity_minocc });
      setKey('recurring', detect.recurring);
      setKey('earlyDetection', detect.earlyDetection);

      // ── Early recurring candidates (1-2 occurrences) ─────────────────────
      // Runs on every recompute (i.e. every braindump parse) and emits
      // finance:recurring_candidate_detected for newly seen candidates.
      // UI reads finance.recurringCandidates and surfaces confirm/dismiss cards.
      try {
        const candidates = detectRecurringEarly(records);
        setKey('recurringCandidates', candidates);

        // Emit only for candidates not already emitted or confirmed/dismissed.
        const dismissed = store.get<Record<string, number>>('finance', '_recurringCandidatesDismissed', {}) ?? {};
        const confirmed = store.get<Record<string, number>>('finance', '_recurringCandidatesConfirmed', {}) ?? {};
        const seenEmit = new Set(store.get<string[]>('finance', '_recurringCandidatesEmitted', []) ?? []);
        const freshEmitted: string[] = [];

        for (const c of candidates) {
          const id = `${c.merchant_normalized}:${c.confidence}`;
          if (seenEmit.has(id)) continue;
          if (dismissed[id] || confirmed[id]) continue;
          try {
            events.emit('finance:recurring_candidate_detected', {
              merchant: c.merchant,
              merchant_normalized: c.merchant_normalized,
              estimatedAmount: c.estimatedAmount,
              estimatedInterval: c.estimatedInterval,
              nextDueDate: c.nextDueDate,
              confidence: c.confidence,
              evidence: c.evidence,
              ts: now,
            });
          } catch { /* non-fatal */ }
          freshEmitted.push(id);
        }
        if (freshEmitted.length) {
          store.set('finance', '_recurringCandidatesEmitted', [...seenEmit, ...freshEmitted]);
        }
      } catch (err) {
        console.error('[orchestrator/finance] detectRecurringEarly failed', err);
      }
      setKey('monthly', computeMonthlyOutflow(records, 0, now));
      setKey('momDelta', monthOverMonthDelta(records, 3, now));
      setKey('adhdTax', trackADHDTaxEvents(records, 90, now));
      const staleSubs = detectSubscriptionStale(
        detect.recurring,
        dumps,
        new Set(settings.dismissed_stale_pattern_ids),
        settings.stale_subscription_threshold_days,
        now,
      );
      setKey('staleSubs', staleSubs);

      // Emit finance:subscription_stale for newly stale subs (dedup per pattern_id).
      try {
        const seenStale = new Set(store.get<string[]>('finance', '_staleSubEmittedIds', []) ?? []);
        const freshStale: string[] = [];
        for (const s of staleSubs) {
          if (!s?.pattern_id || seenStale.has(s.pattern_id)) continue;
          const pattern = detect.recurring.find((p) => p.id === s.pattern_id);
          const amount = pattern?.amount_median ?? 0;
          freshStale.push(s.pattern_id);
          events.emit('finance:subscription_stale', {
            pattern_id: s.pattern_id,
            merchant: s.display_name ?? s.pattern_id,
            amount,
            days_since: s.days_since,
            ts: now,
          });
        }
        if (freshStale.length) {
          store.set('finance', '_staleSubEmittedIds', [...seenStale, ...freshStale]);
        }
      } catch { /* non-fatal */ }
      const upcoming = upcomingBills(detect.recurring, 14, now);
      setKey('upcoming', upcoming);

      // Emit finance:bill_due_predicted for bills within 3 days (new ones only).
      try {
        const seenBillDue = new Set(store.get<string[]>('finance', '_billDuePredictedIds', []) ?? []);
        const freshBillDue: string[] = [];
        for (const bill of upcoming) {
          if (bill.daysUntil > 3) continue;
          const dedupeId = `${bill.bill.id}:${bill.dueAt}`;
          if (seenBillDue.has(dedupeId)) continue;
          freshBillDue.push(dedupeId);
          events.emit('finance:bill_due_predicted', {
            pattern_id: bill.bill.id,
            merchant: bill.bill.display_name ?? bill.bill.merchant_normalized,
            amount: bill.bill.amount_median ?? 0,
            due_at: bill.dueAt,
            days_until: bill.daysUntil,
            ts: now,
          });
        }
        if (freshBillDue.length) {
          store.set('finance', '_billDuePredictedIds', [...seenBillDue, ...freshBillDue]);
        }
      } catch { /* non-fatal */ }

      const incomeRecs = records.filter((r) => r?.direction === 'in');
      const detectIncome = detectRecurring(incomeRecs, { minOccurrences: settings.recurring_maturity_minocc });
      setKey('incomePatterns', detectIncome.recurring);
      setKey('payFrequency', classifyPayFrequency(incomeRecs, now));
      setKey('safeToSpend', safeToSpend(records, now, 7, settings));
      setKey('forecast30d', forecast30d(records, now, settings));

      // Phase 3: anomaly cards (Iglewicz-Hoaglin 1993). Gate: N≥3 + 72h cooldown + not dismissed.
      const COOLDOWN_MS = 72 * 60 * 60 * 1000;
      const dismissedAnom = new Set(settings.dismissed_anomaly_ids ?? []);
      const anomalyCards: AnomalyCard[] = [];
      const byId = new Map<string, FinanceRecord>();
      for (const r of records) if (r?.id) byId.set(r.id, r);

      for (const p of detect.recurring) {
        if (!p?.record_ids || p.record_ids.length < (settings.recurring_maturity_minocc || 3)) continue;
        let latestEdit = 0;
        for (const rid of p.record_ids) {
          const rec = byId.get(rid);
          if (rec?.last_edited_at) latestEdit = Math.max(latestEdit, rec.last_edited_at);
        }
        if (now - latestEdit < COOLDOWN_MS) continue;
        for (const rid of p.record_ids) {
          const rec = byId.get(rid);
          if (!rec || rec.amount == null) continue;
          const res = detectAnomaly(rec, p, { threshold: settings.anomaly_modified_z_threshold });
          if (!res.isAnomaly) continue;
          const cardId = `${p.id}-${rid}`;
          if (dismissedAnom.has(cardId)) continue;
          anomalyCards.push({
            id: cardId,
            pattern_id: p.id,
            record_id: rid,
            merchant: p.display_name ?? null,
            // rec.amount is non-null here — guarded above by `rec.amount == null` continue
            amount: rec.amount as number,
            median: p.amount_median ?? null,
            modZ: res.modZ,
            framing: res.framing,
            event_date: rec.event_date ?? '',
          });
        }
      }
      setKey('anomalies', anomalyCards);

      // Credibility audit NC2: emit spending-spike on a NEW anomaly card
      // (transition only, not on every recompute). Routes to body
      // suggest-rest-check via the cross-module router.
      try {
        const seen = new Set(store.get<string[]>('finance', '_anomalyEmittedIds', []) ?? []);
        const fresh: string[] = [];
        for (const card of anomalyCards) {
          if (!seen.has(card.id) && card.modZ != null) {
            events.emit('finance:spending_spike_detected', {
              amount: card.amount,
              baseline_median: card.median ?? card.amount,
              ratio: card.median ? card.amount / card.median : (card.modZ ?? 1),
              ts: now,
            });
            fresh.push(card.id);
          }
        }
        if (fresh.length) {
          store.set('finance', '_anomalyEmittedIds', [...seen, ...fresh]);
        }
      } catch { /* non-fatal */ }

      const discRecs = records.filter(
        (r) => r?.direction === 'out' && r.kind !== 'bill' && r.kind !== 'sub' && r.amount != null,
      );
      setKey('postPaydaySpikes', detectPostPaydaySpikes(incomeRecs, discRecs, now, {}));

      // F1-F7 pattern detection with research-loop tagging.
      try {
        let researchLoops = store.get<ResearchLoop[]>('finance', 'research_loops', []) ?? [];
        try {
          researchLoops = tagResearchLoops(
            dumps,
            researchLoops,
            now,
          );
          store.set('finance', 'research_loops', researchLoops);
        } catch { /* tagging failure must not block pattern pipeline */ }

        const prev = store.get<PatternCard[]>('finance', 'patterns', []) ?? [];
        const prevKeys = new Set(prev.map((p) => p.pattern).filter(Boolean));

        const cards = detectPatterns({ records, dumps, research_loops: researchLoops, now }) ?? [];
        setKey('patterns', cards);

        for (const card of cards) {
          if (card.pattern && !prevKeys.has(card.pattern)) {
            try {
              events.emit('finance:pattern_detected', {
                pattern: card.pattern,
                confidence: 'medium',
                ts: now,
              });
            } catch { /* non-fatal */ }
          }
        }
      } catch (err) {
        console.error('[orchestrator/finance] detectPatterns failed', err);
      }

      // ── Sprint 3 / D3 · Canva-style pattern detection ───────────────────
      try {
        const cycleBoundaries =
          store.get<CycleBoundary[]>('cycle', 'cycles', [])?.map((c: unknown) => {
            const o = c as { startTs?: number; endTs?: number | null; lengthDays?: number };
            return {
              startTs: o.startTs ?? 0,
              endTs: o.endTs ?? null,
              lengthDays: o.lengthDays,
            };
          }) ?? [];
        const d3 = detectD3Patterns({ records, cycles: cycleBoundaries, now });

        // dedupe vs previous
        const prevSubs = store.get<DetectedSubscriptionCard[]>('finance', 'd3_subscriptions', []) ?? [];
        const prevSubIds = new Set(prevSubs.map((s) => s.pattern_id));
        setKey('d3_subscriptions', d3.subscriptions);
        for (const s of d3.subscriptions) {
          if (!prevSubIds.has(s.pattern_id)) {
            try {
              events.emit('finance:subscription_detected', {
                pattern_id: s.pattern_id,
                merchant: s.merchant,
                amount: s.amount,
                cadence: s.cadence,
                occurrence_count: s.occurrence_count,
                ts: now,
              });
            } catch { /* non-fatal */ }
          }
        }

        const prevTax = store.get<D3ADHDTaxRunningTotal | null>('finance', 'd3_adhd_tax', null);
        setKey('d3_adhd_tax', d3.adhdTax);
        if (!prevTax || prevTax.total_30d !== d3.adhdTax.total_30d || prevTax.count_30d !== d3.adhdTax.count_30d) {
          try {
            events.emit('finance:adhd_tax_updated', {
              total_30d: d3.adhdTax.total_30d,
              count_30d: d3.adhdTax.count_30d,
              ts: now,
            });
          } catch { /* non-fatal */ }
        }

        const prevCyc = store.get<CycleSpendingPatternCard | null>('finance', 'd3_cycle_spending', null);
        setKey('d3_cycle_spending', d3.cycleSpending);
        if (d3.cycleSpending && (!prevCyc || prevCyc.cycle_count !== d3.cycleSpending.cycle_count)) {
          try {
            events.emit('finance:cycle_spending_pattern_detected', {
              luteal_ratio: d3.cycleSpending.luteal_ratio,
              follicular_median: d3.cycleSpending.follicular_median,
              luteal_median: d3.cycleSpending.luteal_median,
              cycle_count: d3.cycleSpending.cycle_count,
              ts: now,
            });
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        console.error('[orchestrator/finance] D3 pattern detection failed', err);
      }

      // ── Sprint 3 / D3 · subscription_cancelled + bill_paid_on_time ──────
      // Watch RecurringPattern records for `user_dismissed_stale` (= cancel
      // confirmed) and bill records with kind='bill' that have an on-time
      // last_at relative to their cadence median.
      try {
        const seenCancelled = new Set(
          store.get<string[]>('finance', '_subCancelledIds', []) ?? [],
        );
        const seenPaidOnTime = new Set(
          store.get<string[]>('finance', '_billPaidOnTimeIds', []) ?? [],
        );
        const newCancelled: string[] = [];
        const newPaid: string[] = [];

        for (const p of detect.recurring) {
          if (!p?.id) continue;
          if (p.kind === 'subscription' && p.user_dismissed_stale && !seenCancelled.has(p.id)) {
            newCancelled.push(p.id);
            try {
              events.emit('finance:subscription_cancelled', {
                pattern_id: p.id,
                merchant: p.display_name ?? p.merchant_normalized,
                ts: now,
              });
            } catch { /* non-fatal */ }
          }
          if (p.kind === 'bill' && p.last_at && !seenPaidOnTime.has(`${p.id}:${p.last_at}`)) {
            // "Paid on time" = the most recent occurrence is within
            // interval_days_median (± mad) of the previous one, and the
            // last_at is within the last 30 days. Cheap heuristic — full
            // logic would consult bill.due_date vs paid_at.
            if (
              p.interval_days_median > 0 &&
              now - p.last_at < 30 * 86_400_000 &&
              p.record_ids?.length >= 2
            ) {
              newPaid.push(`${p.id}:${p.last_at}`);
              try {
                events.emit('finance:bill_paid_on_time', {
                  pattern_id: p.id,
                  merchant: p.display_name ?? p.merchant_normalized,
                  ts: p.last_at,
                });
              } catch { /* non-fatal */ }
            }
          }
        }
        if (newCancelled.length) {
          store.set('finance', '_subCancelledIds', [...seenCancelled, ...newCancelled]);
        }
        if (newPaid.length) {
          store.set('finance', '_billPaidOnTimeIds', [...seenPaidOnTime, ...newPaid]);
        }
      } catch (err) {
        console.error('[orchestrator/finance] subscription/bill transition emit failed', err);
      }

      // ── Sprint 2.5 / F1 · savings totals ────────────────────────────────
      try {
        const cancellations = store.get<Cancellation[]>('finance', 'cancellations', []) ?? [];
        const totals = computeSavings(cancellations, now);
        setKey('savings', totals satisfies SavingsTotals);
      } catch (err) {
        console.error('[orchestrator/finance] savings totals failed', err);
      }

      // ── savings_milestone · emit on 25/50/75/100% threshold crossings ────
      try {
        type SavingsGoalStore = { id: string; name: string; target: number; saved: number };
        const goals = store.get<SavingsGoalStore[]>('finance', 'goals', []) ?? [];
        const prevMilestones = store.get<Record<string, number>>('finance', '_savingsMilestoneLastPct', {}) ?? {};
        const updatedMilestones: Record<string, number> = { ...prevMilestones };
        const THRESHOLDS = [25, 50, 75, 100];
        for (const goal of goals) {
          if (!goal?.id || !goal.target || goal.target <= 0) continue;
          const current = typeof goal.saved === 'number' ? goal.saved : 0;
          const pct = Math.min(100, (current / goal.target) * 100);
          const lastPct = prevMilestones[goal.id] ?? 0;
          for (const threshold of THRESHOLDS) {
            if (pct >= threshold && lastPct < threshold) {
              try {
                events.emit('finance:savings_milestone', {
                  goal_id: goal.id,
                  goal_name: goal.name ?? goal.id,
                  current,
                  target: goal.target,
                  milestone_pct: threshold,
                  ts: now,
                });
              } catch { /* non-fatal */ }
              // Track the highest crossed threshold for this goal.
              updatedMilestones[goal.id] = threshold;
              break;
            }
          }
          // If no threshold crossed, still persist current position so
          // future recomputes have an accurate baseline.
          if (!(goal.id in updatedMilestones) || updatedMilestones[goal.id] === prevMilestones[goal.id]) {
            updatedMilestones[goal.id] = Math.max(prevMilestones[goal.id] ?? 0, THRESHOLDS.filter((t) => pct >= t).pop() ?? 0);
          }
        }
        store.set('finance', '_savingsMilestoneLastPct', updatedMilestones);
      } catch (err) {
        console.error('[orchestrator/finance] savings_milestone emit failed', err);
      }

      // ── impulse_pause_summary · monthly digest on the 1st of each month ─
      // Reads finance.impulse_pauses (written by UI when user taps "pause"
      // on an impulse-buy card). Emits once per calendar month via a
      // date-keyed dedup sentinel.
      try {
        const today = new Date(now);
        const dayOfMonth = today.getUTCDate();
        if (dayOfMonth === 1) {
          // month_start is the first ms of this calendar month (UTC).
          const monthStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
          const digestKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
          const lastDigest = store.get<string>('finance', '_impulsePauseDigestMonth', '') ?? '';
          if (lastDigest !== digestKey) {
            type ImpulsePause = { amount?: number; ts?: number };
            const pauses = store.get<ImpulsePause[]>('finance', 'impulse_pauses', []) ?? [];
            // Count pauses in the previous calendar month.
            const prevMonthStart = Date.UTC(
              today.getUTCMonth() === 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear(),
              today.getUTCMonth() === 0 ? 11 : today.getUTCMonth() - 1,
              1,
            );
            const relevant = pauses.filter(
              (p) => typeof p?.ts === 'number' && p.ts >= prevMonthStart && p.ts < monthStart,
            );
            const count = relevant.length;
            const total = relevant.reduce((s, p) => s + (p.amount ?? 0), 0);
            if (count > 0) {
              events.emit('finance:impulse_pause_summary', {
                count,
                total: Math.round(total * 100) / 100,
                month_start: prevMonthStart,
                ts: now,
              });
            }
            store.set('finance', '_impulsePauseDigestMonth', digestKey);
          }
        }
      } catch (err) {
        console.error('[orchestrator/finance] impulse_pause_summary emit failed', err);
      }

      // ── anomaly_detected · per-day dedup to prevent flooding ─────────────
      // Fires for each new AnomalyCard not yet notified, capped to 1 per
      // merchant per UTC calendar day. Routes through dedicated push event
      // (separate from spending_spike_detected which feeds the body module).
      try {
        const todayKey = new Date(now).toISOString().slice(0, 10);
        const seenAnomNotified = new Set(
          store.get<string[]>('finance', '_anomalyNotifiedIds', []) ?? [],
        );
        const freshAnomNotified: string[] = [];
        // Per-day merchant guard: no more than 1 anomaly push per merchant per day.
        const merchantDaysSeen = new Set<string>();
        for (const card of anomalyCards) {
          if (seenAnomNotified.has(card.id)) continue;
          const merchantDayKey = `${card.merchant ?? '_'}:${todayKey}`;
          if (merchantDaysSeen.has(merchantDayKey)) continue;
          merchantDaysSeen.add(merchantDayKey);
          freshAnomNotified.push(card.id);
          events.emit('finance:anomaly_detected', {
            anomaly_id: card.id,
            merchant: card.merchant,
            amount: card.amount,
            median: card.median,
            ts: now,
          });
        }
        if (freshAnomNotified.length) {
          store.set('finance', '_anomalyNotifiedIds', [...seenAnomNotified, ...freshAnomNotified]);
        }
      } catch (err) {
        console.error('[orchestrator/finance] anomaly_detected emit failed', err);
      }

      // ── Money module gap closure · savings deposit detection ─────────────
      try {
        const savingsTransfers = detectSavingsTransfers(records);
        setKey('savingsTransfers', savingsTransfers satisfies SavingsTransfer[]);

        const seenSavings = new Set(
          store.get<string[]>('finance', '_savingsDepositEmittedIds', []) ?? [],
        );
        const freshSavings: string[] = [];
        for (const t of savingsTransfers) {
          if (t.confidence === 'low') continue;
          if (seenSavings.has(t.id)) continue;
          freshSavings.push(t.id);
          try {
            events.emit('finance:savings_deposit_detected', {
              transfer_id: t.id,
              record_id: t.record_id,
              paired_record_id: t.paired_record_id,
              amount: t.amount,
              date: t.date,
              memo: t.memo,
              matched_keyword: t.matched_keyword,
              confidence: t.confidence,
              is_matched_pair: t.is_matched_pair,
              ts: now,
            });
          } catch { /* non-fatal */ }
        }

        // Also scan recent dump text for savings mentions.
        const braindumpSeenKeys = new Set<string>(seenSavings);
        for (const d of dumps) {
          const bdCandidates = detectSavingsFromBraindump(d.text);
          for (const candidate of bdCandidates) {
            if (candidate.confidence === 'low') continue;
            const dumpKey = `braindump:${d.ts}:${candidate.matched_keyword}`;
            if (braindumpSeenKeys.has(dumpKey)) continue;
            braindumpSeenKeys.add(dumpKey);
            freshSavings.push(dumpKey);
            try {
              events.emit('finance:savings_deposit_detected', {
                transfer_id: dumpKey,
                record_id: null,
                paired_record_id: null,
                amount: candidate.amount,
                date: new Date(d.ts).toISOString().slice(0, 10),
                memo: candidate.text,
                matched_keyword: candidate.matched_keyword,
                confidence: candidate.confidence,
                is_matched_pair: false,
                ts: now,
              });
            } catch { /* non-fatal */ }
          }
        }
        if (freshSavings.length) {
          store.set('finance', '_savingsDepositEmittedIds', [...seenSavings, ...freshSavings]);
        }
      } catch (err) {
        console.error('[orchestrator/finance] savings deposit detection failed', err);
      }

      // ── Money module gap closure · ADHD tax auto-detection ───────────────
      try {
        const seenAdhdTax = new Set(
          store.get<string[]>('finance', '_adhdTaxCandidateEmittedIds', []) ?? [],
        );
        const freshAdhdTax: string[] = [];

        // Per-record memo analysis.
        for (const r of records) {
          if (!r?.id) continue;
          const candidate = detectADHDTaxFromTxn(r);
          if (!candidate) continue;
          const key = `txn:${r.id}:${candidate.category}`;
          if (seenAdhdTax.has(key)) continue;
          freshAdhdTax.push(key);
          try {
            events.emit('finance:adhd_tax_candidate_detected', {
              record_id: candidate.record_id,
              category: candidate.category,
              confidence: candidate.confidence,
              amount: candidate.amount,
              matched_phrase: candidate.matched_phrase,
              copy: candidate.copy,
              auto_add: candidate.auto_add,
              ts: now,
            });
          } catch { /* non-fatal */ }
        }

        // Duplicate purchase detection.
        const duplicates: DuplicatePurchase[] = detectDuplicatePurchases(records, 7);
        setKey('duplicatePurchaseCandidates', duplicates);
        for (const dup of duplicates) {
          const key = `dup:${[...dup.record_ids].sort().join(',')}`;
          if (seenAdhdTax.has(key)) continue;
          freshAdhdTax.push(key);
          try {
            events.emit('finance:adhd_tax_candidate_detected', {
              record_id: dup.record_ids[0] ?? null,
              category: 'duplicate',
              confidence: dup.confidence,
              amount: dup.amounts[0] ?? null,
              matched_phrase: 'duplicate purchase',
              copy: dup.copy,
              auto_add: false,
              ts: now,
            });
          } catch { /* non-fatal */ }
        }

        // Braindump keyword scan.
        for (const d of dumps) {
          const bdAdhdCandidates = detectADHDTaxFromBraindump(d.text);
          for (const candidate of bdAdhdCandidates) {
            if (candidate.confidence === 'low') continue;
            const key = `braindump:${d.ts}:${candidate.matched_phrase}`;
            if (seenAdhdTax.has(key)) continue;
            freshAdhdTax.push(key);
            try {
              events.emit('finance:adhd_tax_candidate_detected', {
                record_id: null,
                category: candidate.category,
                confidence: candidate.confidence,
                amount: null,
                matched_phrase: candidate.matched_phrase,
                copy: candidate.copy,
                auto_add: false,
                ts: now,
              });
            } catch { /* non-fatal */ }
          }
        }

        if (freshAdhdTax.length) {
          store.set('finance', '_adhdTaxCandidateEmittedIds', [...seenAdhdTax, ...freshAdhdTax]);
        }
      } catch (err) {
        console.error('[orchestrator/finance] ADHD tax detection failed', err);
      }

      setKey('lastRecomputeAt', now);
    } catch (err) {
      console.error('[orchestrator/finance] recomputeDerived failed:', err);
    }
  }

  // ── Sprint 2.5 / F1 · cancellation recording ──────────────────────────────
  // When the user taps "cancelled" on a d3-subscription card, the UI
  // emits `finance:subscription_cancelled` (already wired in the D3
  // path). This handler turns that event into a Cancellation entry
  // append + marks the underlying d3_subscriptions entry inactive.
  function onSubscriptionCancelled(payload: unknown): void {
    const p = (payload ?? {}) as { pattern_id?: string; merchant?: string; monthly_amount?: number; ts?: number };
    if (!p.pattern_id || !p.merchant) return;
    const ts = typeof p.ts === 'number' ? p.ts : getNow();

    const list = store.get<Cancellation[]>('finance', 'cancellations', []) ?? [];
    if (list.some((c) => c.id === p.pattern_id)) {
      // already recorded — preserve historic count (Decision #14 rule)
      return;
    }
    // Determine monthly_amount: prefer payload, else look up the
    // d3_subscriptions card by pattern_id, else fall back to the
    // RecurringPattern amount_median.
    let monthly = typeof p.monthly_amount === 'number' ? p.monthly_amount : null;
    if (monthly == null) {
      const subs = store.get<DetectedSubscriptionCard[]>('finance', 'd3_subscriptions', []) ?? [];
      const sub = subs.find((s) => s.pattern_id === p.pattern_id);
      if (sub) monthly = sub.amount;
    }
    if (monthly == null) {
      const recurring = store.get<RecurringPattern[]>('finance', 'recurring', []) ?? [];
      const r = recurring.find((rp) => rp.id === p.pattern_id);
      if (r?.amount_median != null) monthly = r.amount_median;
    }
    if (monthly == null || monthly <= 0) return;

    const entry: Cancellation = {
      id: p.pattern_id,
      merchant: p.merchant,
      monthly_amount: monthly,
      cancelled_at: ts,
      surfaced_by_ollie: true,
    };
    store.set('finance', 'cancellations', [...list, entry]);
    try {
      events.emit('finance:savings_recorded', {
        id: entry.id,
        merchant: entry.merchant,
        monthly_amount: entry.monthly_amount,
        cancelled_at: entry.cancelled_at,
        surfaced_by_ollie: entry.surfaced_by_ollie,
        ts,
      });
    } catch { /* non-fatal */ }
    // Trigger a recompute so finance.savings reflects the new entry.
    schedule();
  }

  // ── processBacklog ────────────────────────────────────────────────────────

  function processBacklog(): void {
    try {
      const dumps = store.get<DumpItem[]>('dump', 'items', []) ?? [];
      // Also scan legacy finance.items — written by applyRoute for home/dashboard inputs.
      const legacy = store.get<DumpItem[]>('finance', 'items', []) ?? [];
      const merged = [...dumps, ...legacy].filter((d) => d?.ts);

      const records = getRecords();
      const seen = new Set(records.map((r) => r.raw_source_id).filter(Boolean));
      const batch = merged.filter((d) => !seen.has(String(d.ts))).slice(-40);

      for (const d of batch) {
        try { processDump(d); }
        catch (err) { console.warn('[orchestrator/finance] processDump failed for dump', d?.ts, err); }
      }
      recomputeDerived();
    } catch (err) {
      console.error('[orchestrator/finance] processBacklog failed:', err);
    }
  }

  // ── schedule (debounced recompute) ────────────────────────────────────────

  function schedule(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; recomputeDerived(); }, DEBOUNCE_MS);
  }

  // ── init / teardown ───────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    if (!store.get('finance', 'settings', null)) {
      setKey('settings', DEFAULT_SETTINGS);
    }

    unsubs.push(store.subscribeKey('dump', 'items', () => {
      try { processBacklog(); } catch (err) { console.error('[orchestrator/finance] dump.items tick failed', err); }
    }));
    // Legacy finance.items path — written by applyRoute before v:2 braindump event.
    unsubs.push(store.subscribeKey('finance', 'items', () => {
      try { processBacklog(); } catch (err) { console.error('[orchestrator/finance] finance.items tick failed', err); }
    }));
    unsubs.push(store.subscribeKey('finance', 'records', () => {
      try { schedule(); } catch (err) { console.error('[orchestrator/finance] finance.records tick failed', err); }
    }));
    unsubs.push(store.subscribeKey('finance', 'cancellations', () => {
      try { schedule(); } catch (err) { console.error('[orchestrator/finance] cancellations tick failed', err); }
    }));
    unsubs.push(events.on('finance:subscription_cancelled', (p) => {
      try { onSubscriptionCancelled(p); }
      catch (err) { console.error('[orchestrator/finance] onSubscriptionCancelled failed', err); }
    }));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string; text?: string }>; ts?: number; raw?: string; text?: string };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'finance');
            if (myItems.length === 0) {
              recomputeDerived();
              return;
            }
            const ts = p.ts ?? getNow();
            for (const it of myItems) {
              processDump({ ts, text: it.text ?? p.raw ?? p.text ?? '' });
            }
            recomputeDerived();
            return;
          }
          processBacklog();
        } catch (err) {
          console.error('[orchestrator/finance] braindump tick failed', err);
        }
      }),
    );

    // ── APNs push subscribers ────────────────────────────────────────────
    // Wire the 4 finance events to scheduleServerJob via the injected callback.
    // Callback is null when APNs is not configured (desktop, web, tests).

    if (scheduleNotification) {
      // finance:bill_due_predicted → push 3 days before due date
      unsubs.push(events.on('finance:bill_due_predicted', (raw) => {
        try {
          const p = (raw ?? {}) as {
            pattern_id?: string;
            merchant?: string;
            amount?: number;
            due_at?: number;
            days_until?: number;
          };
          if (typeof p.due_at !== 'number' || !p.merchant) return;
          const merchant = p.merchant;
          const amount = typeof p.amount === 'number' ? p.amount : null;
          const days = typeof p.days_until === 'number' ? p.days_until : 3;
          const amountStr = amount != null ? ` — $${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '';
          // fire 3 days before due (or now if already within 3 days)
          const fireAt = p.due_at - 3 * 86_400_000;
          scheduleNotification(
            {
              title: `${merchant} due in ${days} day${days === 1 ? '' : 's'}${amountStr}`,
              category: 'REMINDER',
              dedupe_key: `finance:bill_due_predicted:${p.pattern_id ?? merchant}:${p.due_at}`,
              action_url: '/finance',
            },
            Math.max(fireAt, getNow()),
          );
        } catch { /* non-fatal */ }
      }));

      // finance:subscription_detected → push next morning (8am local, approximated as +16h from now)
      unsubs.push(events.on('finance:subscription_detected', (raw) => {
        try {
          const p = (raw ?? {}) as {
            pattern_id?: string;
            merchant?: string;
            amount?: number;
          };
          if (!p.merchant || !p.pattern_id) return;
          const merchant = p.merchant;
          const amount = typeof p.amount === 'number' ? p.amount : null;
          const timesStr = amount != null ? ` ${amount > 0 ? `$${amount}` : ''}` : '';
          // next morning ≈ 16 hours from now (avoids computing local tz on server)
          const fireAt = getNow() + 16 * 60 * 60 * 1000;
          scheduleNotification(
            {
              title: `${merchant} charged${timesStr} — worth cancelling?`,
              category: 'PATTERN_ALERT',
              dedupe_key: `finance:subscription_detected:${p.pattern_id}`,
              action_url: '/finance/subscriptions',
            },
            fireAt,
          );
        } catch { /* non-fatal */ }
      }));

      // finance:cycle_spending_pattern_detected → push 2 days before next luteal start
      unsubs.push(events.on('finance:cycle_spending_pattern_detected', (raw) => {
        try {
          const p = (raw ?? {}) as { cycle_count?: number; ts?: number };
          if (!p.cycle_count) return;
          // Compute next luteal start from cycle store data.
          // Formula mirrors pattern-detection.ts: lutealStart = cycleStart + floor(lenDays/2) * DAY
          const cycles = store.get<Array<{ startTs?: number; endTs?: number | null; lengthDays?: number }>>('cycle', 'cycles', []) ?? [];
          if (cycles.length === 0) return;
          const sorted = [...cycles]
            .filter((c) => typeof c?.startTs === 'number')
            .sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));
          const lastCycle = sorted[sorted.length - 1];
          if (!lastCycle?.startTs) return;
          const avgLen = sorted.length > 1
            ? Math.round(sorted.reduce((s, c) => s + (c.lengthDays ?? 28), 0) / sorted.length)
            : (lastCycle.lengthDays ?? 28);
          const lutealStartTs = lastCycle.startTs + Math.floor(avgLen / 2) * 86_400_000;
          // fire 2 days before luteal start; skip if already past
          const fireAt = lutealStartTs - 2 * 86_400_000;
          if (fireAt <= getNow()) return;
          scheduleNotification(
            {
              title: 'spending tends to shift this phase',
              body: 'pattern, not a rule — spending tends to spike around luteal phase',
              category: 'PATTERN_ALERT',
              dedupe_key: `finance:cycle_spending_pattern_detected:${lastCycle.startTs}`,
              action_url: '/finance',
              // TODO: add ES translation when i18n layer supports notification copy
            },
            fireAt,
          );
        } catch { /* non-fatal */ }
      }));

      // finance:adhd_tax_updated → weekly digest only (aggregation_group prevents per-event spam)
      unsubs.push(events.on('finance:adhd_tax_updated', (raw) => {
        try {
          const p = (raw ?? {}) as { total_30d?: number; count_30d?: number };
          if (typeof p.total_30d !== 'number' || p.count_30d == null || p.count_30d < 1) return;
          const total = p.total_30d;
          // Weekly digest fires Sunday 9am — approximate as 7 days from now.
          // Actual aggregation_group deduplication prevents flooding.
          const fireAt = getNow() + 7 * 24 * 60 * 60 * 1000;
          scheduleNotification(
            {
              title: `${p.count_30d} adhd-tax item${p.count_30d === 1 ? '' : 's'} tracked this month — $${total.toFixed(0)} total`,
              category: 'PATTERN_ALERT',
              dedupe_key: `finance:adhd_tax_digest:${new Date(getNow()).toISOString().slice(0, 10)}`,
              aggregation_group: 'finance:adhd_tax_digest',
              action_url: '/finance/adhd-tax',
            },
            fireAt,
          );
        } catch { /* non-fatal */ }
      }));

      // finance:subscription_stale → push next morning (~16h) once per pattern
      // TODO: ES
      unsubs.push(events.on('finance:subscription_stale', (raw) => {
        try {
          const p = (raw ?? {}) as {
            pattern_id?: string;
            merchant?: string;
            amount?: number;
            days_since?: number;
          };
          if (!p.pattern_id || !p.merchant) return;
          const merchant = p.merchant;
          const days = typeof p.days_since === 'number' ? p.days_since : 90;
          const amount = typeof p.amount === 'number' ? p.amount : null;
          const amountStr = amount != null && amount > 0 ? ` $${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '';
          const fireAt = getNow() + 16 * 60 * 60 * 1000;
          scheduleNotification(
            {
              title: `${merchant} — not opened in ${days} days. still paying${amountStr}.`,
              category: 'PATTERN_ALERT',
              dedupe_key: `finance:subscription_stale:${p.pattern_id}`,
              action_url: '/finance/subscriptions',
            },
            fireAt,
          );
        } catch { /* non-fatal */ }
      }));

      // finance:savings_milestone → immediate push (milestone is the moment)
      // TODO: ES
      unsubs.push(events.on('finance:savings_milestone', (raw) => {
        try {
          const p = (raw ?? {}) as {
            goal_id?: string;
            goal_name?: string;
            current?: number;
            target?: number;
            milestone_pct?: number;
          };
          if (!p.goal_id || typeof p.current !== 'number' || typeof p.target !== 'number') return;
          if (typeof p.milestone_pct !== 'number') return;
          const name = p.goal_name ?? p.goal_id;
          const currentStr = p.current.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          const targetStr = p.target.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          scheduleNotification(
            {
              title: `${name}: $${currentStr} of $${targetStr}. quietly growing.`,
              category: 'PATTERN_ALERT',
              dedupe_key: `finance:savings_milestone:${p.goal_id}:${p.milestone_pct}`,
              action_url: '/finance/goals',
            },
            getNow(),
          );
        } catch { /* non-fatal */ }
      }));

      // finance:impulse_pause_summary → monthly digest, fires same day (1st of month)
      // aggregation_group coalesces multiple emits within the digest window.
      // TODO: ES
      unsubs.push(events.on('finance:impulse_pause_summary', (raw) => {
        try {
          const p = (raw ?? {}) as { count?: number; total?: number };
          if (typeof p.count !== 'number' || p.count < 1) return;
          const total = typeof p.total === 'number' ? p.total : 0;
          const totalStr = total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          const digestKey = new Date(getNow()).toISOString().slice(0, 7); // YYYY-MM
          scheduleNotification(
            {
              title: `${p.count} impulse buy${p.count === 1 ? '' : 's'} paused this month. saved approx $${totalStr}.`,
              category: 'PATTERN_ALERT',
              dedupe_key: `finance:impulse_pause_digest:${digestKey}`,
              aggregation_group: 'finance:impulse_pause_digest',
              action_url: '/finance',
            },
            getNow(),
          );
        } catch { /* non-fatal */ }
      }));

      // finance:anomaly_detected → push within 1h (already per-day deduped at emit site)
      // TODO: ES
      unsubs.push(events.on('finance:anomaly_detected', (raw) => {
        try {
          const p = (raw ?? {}) as {
            anomaly_id?: string;
            merchant?: string | null;
            amount?: number;
            median?: number | null;
          };
          if (!p.anomaly_id || typeof p.amount !== 'number') return;
          const amountStr = p.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          const fireAt = getNow() + 60 * 60 * 1000; // ~1h from now
          scheduleNotification(
            {
              title: `this $${amountStr} charge looks unusual. confirm or flag?`,
              category: 'PATTERN_ALERT',
              dedupe_key: `finance:anomaly_detected:${p.anomaly_id}`,
              action_url: '/finance',
            },
            fireAt,
          );
        } catch { /* non-fatal */ }
      }));
    }

    // Cold start — backfill + initial derived compute.
    try { processBacklog(); } catch (err) { console.error('[orchestrator/finance] first-run backfill failed', err); }
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
    initialized = false;
  }

  return { init, teardown, processDump, processBacklog, recomputeDerived };
}
