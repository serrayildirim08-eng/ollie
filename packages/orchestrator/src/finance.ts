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
 *   finance:record_added      — new FinanceRecord ingested from a dump item
 *   finance:pattern_detected  — new PatternCard pattern key observed
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  parseFinanceDump,
  mergeRecord,
  detectRecurring,
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
      setKey('monthly', computeMonthlyOutflow(records, 0, now));
      setKey('momDelta', monthOverMonthDelta(records, 3, now));
      setKey('adhdTax', trackADHDTaxEvents(records, 90, now));
      setKey(
        'staleSubs',
        detectSubscriptionStale(
          detect.recurring,
          dumps,
          new Set(settings.dismissed_stale_pattern_ids),
          settings.stale_subscription_threshold_days,
          now,
        ),
      );
      setKey('upcoming', upcomingBills(detect.recurring, 14, now));

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

      setKey('lastRecomputeAt', now);
    } catch (err) {
      console.error('[orchestrator/finance] recomputeDerived failed:', err);
    }
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
