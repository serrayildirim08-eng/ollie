/**
 * FinanceModule — dark #0E0C14 bg, white text, no sky video.
 * Ported from void-app.html FinanceModule + FinanceNoticed + FinanceSignalsSection.
 * All logic via @ollie/logic/finance (pure fns, useMemo-wrapped).
 * Tone: dry, deadpan. No moralizing. No "you should save more".
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  detectRecurring,
  predictNextDue,
  savingsGoalProgress,
  trackADHDTaxEvents,
  detectSubscriptionStale,
  upcomingBills,
  safeToSpend,
  detectPatterns,
} from '@ollie/logic/finance';
import type {
  FinanceRecord,
  PatternCard,
  RecurringPattern,
  SavingsGoal,
  UpcomingBill,
  ADHDTaxSummary,
  StaleSubscription,
  SpendBand,
  DetectedSubscriptionCard,
  ADHDTaxRunningTotal as D3ADHDTaxRunningTotal,
  CycleSpendingPatternCard,
  SavingsTotals,
  RecurringCandidate,
} from '@ollie/logic/finance';
import { buildSavingsCardCopy } from '@ollie/logic/finance';
import { mkId } from '../../lib/mkId';
import { IncomeCard } from './IncomeCard';
import { emit } from '@ollie/events';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';
import {
  ImpulsePauseModal,
  thisMonthVariableTotal,
  pctOfVariable,
  findSimilarPurchases,
  isHoldEligible,
  type PendingPause,
} from './ImpulsePauseModal';
import {
  PrivacyToggle,
  isMaskedNow,
  maskMoney,
  type PrivacyState,
} from './PrivacyToggle';
import { AuditSubscriptions, useAuditEntryKicker } from './AuditSubscriptions';

// ─── palette tokens (dark) ───────────────────────────────────────────────────

const T = {
  text:    'rgba(255,255,255,0.88)',
  muted:   'rgba(255,255,255,0.48)',
  faint:   'rgba(255,255,255,0.28)',
  border:  'rgba(255,255,255,0.08)',
  paper:   'rgba(255,255,255,0.03)',
  accent:  '#C8A26A', // warm muted gold
  inputBg: 'rgba(255,255,255,0.06)',
} as const;

// ─── shared style helpers ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 9,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: T.muted,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 0',
  borderBottom: `1px solid ${T.border}`,
};

const inputStyle: React.CSSProperties = {
  background: T.inputBg,
  border: `1px solid ${T.border}`,
  color: T.text,
  padding: '8px 10px',
  borderRadius: 8,
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  outline: 'none',
};

const ghostBtn: React.CSSProperties = {
  background: 'none',
  border: `1px solid ${T.border}`,
  borderRadius: 20,
  padding: '5px 12px',
  fontFamily: "'DM Mono', monospace",
  fontSize: 9,
  letterSpacing: '0.14em',
  color: T.muted,
  cursor: 'pointer',
  textTransform: 'uppercase' as const,
};

const addBtn: React.CSSProperties = { ...ghostBtn, color: T.text };
const removeBtn: React.CSSProperties = {
  ...ghostBtn, opacity: 0.4,
  minWidth: 44, minHeight: 44,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n ?? 0));
}

// ─── stored types ────────────────────────────────────────────────────────────

interface StoredBill {
  id: string;
  name: string;
  preset?: string | null;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  dueDay: number;
  anchorMonth?: number | null;
  payments: Array<{ ts: number; amount: number; periodKey: string }>;
  lastPaidPeriod: string | null;
  ts: number;
}

interface StoredSub {
  id: string;
  name: string;
  amount: number;
  period: 'monthly' | 'yearly';
  marked_to_cancel_at?: number | null;
  ts: number;
}

interface StoredGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  ts: number;
}

interface StoredTax {
  id: string;
  text: string;
  amount: number;
  ts: number;
}

interface StoredTransaction {
  id: string;
  ts: number;
  amount: number;
  merchant: string;
  category: string;
  direction?: 'in' | 'out';
  notes?: string;
  returnable_until?: number | null;
  return_status?: string | null;
}

interface FinanceSettings {
  show_cross_cycle_correlation?: boolean;
  show_cross_sleep_correlation?: boolean;
  recurring_maturity_minocc?: number;
  buffer_pct?: number;
}

interface CycleCorrelation {
  run_length?: number;
  n?: number;
  note?: string;
  [key: string]: unknown;
}

interface SleepCorrelation {
  run_length?: number;
  n?: number;
  note?: string;
  [key: string]: unknown;
}

interface PostPaydaySpikesStore {
  spikes: Array<{ id?: string; [key: string]: unknown }>;
  window_days?: number;
}

// ─── preset bill shelf ───────────────────────────────────────────────────────

const FINANCE_PRESETS: Array<{
  key: string;
  name: string;
  freq: 'monthly' | 'quarterly' | 'yearly';
  group: string;
  match: string[];
}> = [
  { key: 'rent',         name: 'rent',              freq: 'monthly',   group: 'housing',   match: ['rent'] },
  { key: 'mortgage',     name: 'mortgage',           freq: 'monthly',   group: 'housing',   match: ['mortgage'] },
  { key: 'renters_ins',  name: 'renters insurance',  freq: 'yearly',    group: 'housing',   match: ['renters insurance'] },
  { key: 'electricity',  name: 'electricity',        freq: 'monthly',   group: 'utilities', match: ['electric', 'electricity'] },
  { key: 'water',        name: 'water',              freq: 'monthly',   group: 'utilities', match: ['water bill'] },
  { key: 'gas',          name: 'gas',                freq: 'monthly',   group: 'utilities', match: ['gas bill', 'natural gas'] },
  { key: 'internet',     name: 'internet',           freq: 'monthly',   group: 'utilities', match: ['internet', 'wifi'] },
  { key: 'phone',        name: 'phone',              freq: 'monthly',   group: 'utilities', match: ['phone bill', 'mobile'] },
  { key: 'car_payment',  name: 'car payment',        freq: 'monthly',   group: 'transport', match: ['car payment', 'car loan'] },
  { key: 'car_ins',      name: 'car insurance',      freq: 'quarterly', group: 'transport', match: ['car insurance', 'auto insurance'] },
  { key: 'health_ins',   name: 'health insurance',   freq: 'monthly',   group: 'health',    match: ['health insurance'] },
  { key: 'gym',          name: 'gym',                freq: 'monthly',   group: 'health',    match: ['gym'] },
];

const FINANCE_GROUPS = [
  { key: 'housing',   label: 'housing' },
  { key: 'utilities', label: 'utilities' },
  { key: 'transport', label: 'transport' },
  { key: 'health',    label: 'health' },
];

const FIN_TX_CATEGORIES = ['groceries', 'coffee', 'takeout', 'transport', 'subscriptions', 'bills', 'other'];

// ─── FinanceDonut ─────────────────────────────────────────────────────────────

interface DonutItem {
  key: string;
  name: string;
  value: number;
  freq: string;
  amount: number;
  color: string;
}

function FinanceDonut({ items, total, size = 180 }: { items: DonutItem[]; total: number; size?: number }) {
  const r = 68, stroke = 14, cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }} aria-hidden="true">
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
        {items.map((it) => {
          const len = total > 0 ? (it.value / total) * circumference : 0;
          const el = (
            <circle
              key={it.key}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={it.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              style={{ transition: 'stroke-dasharray 400ms ease-out' }}
            />
          );
          offset += len;
          return el;
        })}
      </g>
    </svg>
  );
}

// ─── FinanceD3Cards · Sprint 3 / D3 ───────────────────────────────────────
// Three quiet cards: subscription detection (Canva-style), adhd-tax 30-day
// running total, cycle-correlated spending. Lives next to "noticed" — never
// pushes, never toasts. Brand voice: lowercase, factual, no judgement.

function FinanceD3Cards() {
  const [subs] = useStoreSlice<DetectedSubscriptionCard[]>('finance', 'd3_subscriptions', []);
  const [tax] = useStoreSlice<D3ADHDTaxRunningTotal | null>('finance', 'd3_adhd_tax', null);
  const [cyc] = useStoreSlice<CycleSpendingPatternCard | null>('finance', 'd3_cycle_spending', null);
  const [subDismissed, setSubDismissed] = useStoreSlice<Record<string, number>>(
    'finance', 'd3_subs_dismissed', {},
  );

  const visibleSubs = (subs ?? []).filter((s) => !(subDismissed?.[s.pattern_id]));
  const showTax = tax && (tax.count_30d ?? 0) > 0;
  const showCyc = !!cyc;

  if (!visibleSubs.length && !showTax && !showCyc) return null;

  function dismissSub(id: string) {
    setSubDismissed({ ...(subDismissed ?? {}), [id]: Date.now() });
  }

  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
        ollie remembers
      </div>

      {visibleSubs.map((s) => (
        <div
          key={s.pattern_id}
          style={{
            padding: '18px 20px',
            background: T.paper,
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text }}>
            {s.copy}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                // F1 — record cancellation. Orchestrator listens and
                // appends to finance.cancellations + recomputes savings.
                emit('finance:subscription_cancelled', {
                  pattern_id: s.pattern_id,
                  merchant: s.merchant,
                  monthly_amount: s.amount,
                  ts: Date.now(),
                });
                dismissSub(s.pattern_id);
              }}
              style={{ ...d3BtnStyle, color: T.accent, borderColor: T.accent }}
            >
              cancelled
            </button>
            <button
              type="button"
              onClick={() => dismissSub(s.pattern_id)}
              style={d3BtnStyle}
            >
              this is intentional
            </button>
            <button
              type="button"
              onClick={() => {
                // Credibility audit NH6: schedule a 24h-out reminder
                // via the bus. The reminder scheduler in @ollie/router
                // listens and surfaces a toast on fire.
                try {
                  emit('void:reminder:scheduled', {
                    id: `cancel:${s.pattern_id}:${Date.now()}`,
                    fireAt: Date.now() + 24 * 3600_000,
                    message: `cancel ${s.merchant}? still on the list.`,
                    module: 'finance',
                    source: 'd3-subscription-card',
                  });
                } catch { /* non-fatal */ }
                dismissSub(s.pattern_id);
              }}
              style={d3BtnStyle}
            >
              remind me to cancel
            </button>
          </div>
        </div>
      ))}

      {showTax && tax && (
        <div
          style={{
            padding: '18px 20px',
            background: T.paper,
            borderBottom: `1px solid ${T.border}`,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            color: T.text,
          }}
        >
          {tax.copy}
        </div>
      )}

      {showCyc && cyc && (
        <div
          style={{
            padding: '18px 20px',
            background: T.paper,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            color: T.text,
          }}
        >
          {cyc.copy}
        </div>
      )}
    </section>
  );
}

// ─── ProtectiveCards · Sprint 4 · E5 ──────────────────────────────────────
// Quiet surface for cross-module protective chains. Reads
// `finance.protective_cards` (written by the cross-module router when
// e.g. sleep:short_sleep_run_detected fires). Empty array → renders nothing.

interface ProtectiveCard {
  id: string;
  reason: string;
  kind?: string;
  ts: number;
}

function ProtectiveCards() {
  const [cards, setCards] = useStoreSlice<ProtectiveCard[]>('finance', 'protective_cards', []);
  const [cycleCardVisible] = useStoreSlice<{ visible?: boolean; reason?: string; ts?: number } | null>('finance', 'cycle_card_visible', null);
  const list = (cards ?? []).filter((c) => c?.reason);
  if (list.length === 0 && !cycleCardVisible?.visible) return null;
  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
        easy on finance
      </div>
      {list.map((c) => (
        <div
          key={c.id}
          style={{ padding: '16px 20px', background: T.paper, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text }}>{c.reason}</span>
          <button
            type="button"
            onClick={() => setCards(list.filter((x) => x.id !== c.id))}
            style={d3BtnStyle}
            aria-label="dismiss"
          >dismiss</button>
        </div>
      ))}
      {cycleCardVisible?.visible && (
        <div style={{ padding: '16px 20px', background: T.paper, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text }}>
          {cycleCardVisible.reason ?? 'luteal phase began — pattern, not medical.'}
        </div>
      )}
    </section>
  );
}

// ─── RecurringCandidateCards ──────────────────────────────────────────────
// Surfaces candidates from detectRecurringEarly(). Fires on every braindump
// parse via finance.recurringCandidates (written by orchestrator).
// confirm → adds a bill to finance.bills; dismiss → hides permanently.
// Brand voice: factual, no judgment.

function fmtCandidateAmount(c: RecurringCandidate): string {
  if (c.estimatedAmount == null) return '';
  return ` · ~$${Math.round(c.estimatedAmount)}`;
}

function fmtCandidateInterval(c: RecurringCandidate): string {
  if (c.estimatedInterval == null) return '';
  if (c.estimatedInterval >= 28 && c.estimatedInterval <= 32) return 'monthly';
  if (c.estimatedInterval >= 85 && c.estimatedInterval <= 95) return 'quarterly';
  if (c.estimatedInterval >= 350 && c.estimatedInterval <= 380) return 'yearly';
  if (c.estimatedInterval >= 6 && c.estimatedInterval <= 8) return 'weekly';
  return `every ${c.estimatedInterval}d`;
}

function RecurringCandidateCards() {
  const [candidates] = useStoreSlice<RecurringCandidate[]>('finance', 'recurringCandidates', []);
  const [dismissed, setDismissed] = useStoreSlice<Record<string, number>>(
    'finance', '_recurringCandidatesDismissed', {},
  );
  const [confirmed, setConfirmed] = useStoreSlice<Record<string, number>>(
    'finance', '_recurringCandidatesConfirmed', {},
  );
  const [bills, setBills] = useStoreSlice<Array<{
    id: string; name: string; preset?: string | null; amount: number;
    frequency: 'monthly' | 'quarterly' | 'yearly'; dueDay: number;
    anchorMonth?: number | null; payments: Array<{ ts: number; amount: number; periodKey: string }>;
    lastPaidPeriod: string | null; ts: number;
  }>>('finance', 'bills', []);

  const list = (candidates ?? []).filter((c) => {
    const id = `${c.merchant_normalized}:${c.confidence}`;
    return !dismissed?.[id] && !confirmed?.[id];
  });

  if (list.length === 0) return null;

  function dismissCandidate(c: RecurringCandidate) {
    const id = `${c.merchant_normalized}:${c.confidence}`;
    setDismissed({ ...(dismissed ?? {}), [id]: Date.now() });
  }

  function confirmCandidate(c: RecurringCandidate) {
    const id = `${c.merchant_normalized}:${c.confidence}`;
    // Derive frequency from estimatedInterval; fall back to monthly
    let freq: 'monthly' | 'quarterly' | 'yearly' = 'monthly';
    if (c.estimatedInterval != null) {
      if (c.estimatedInterval >= 85 && c.estimatedInterval <= 95) freq = 'quarterly';
      else if (c.estimatedInterval >= 350 && c.estimatedInterval <= 380) freq = 'yearly';
    }
    const newBill = {
      id: mkId('bill'),
      name: c.merchant.toLowerCase().slice(0, 80),
      preset: null,
      amount: c.estimatedAmount ?? 0,
      frequency: freq,
      dueDay: new Date().getDate(),
      anchorMonth: null,
      payments: [],
      lastPaidPeriod: null,
      ts: Date.now(),
    };
    setBills([...(bills ?? []), newBill]);
    setConfirmed({ ...(confirmed ?? {}), [id]: Date.now() });
  }

  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
        looks recurring
      </div>
      {list.map((c) => {
        const id = `${c.merchant_normalized}:${c.confidence}`;
        const intervalLabel = fmtCandidateInterval(c);
        const amtLabel = fmtCandidateAmount(c);
        const copy = `${c.merchant.toLowerCase()}${amtLabel}${intervalLabel ? ` · ${intervalLabel}` : ''}`;
        const category = (c as { category?: string }).category ?? 'unknown';
        const isBill = category === 'bill';
        const isSubscription = category === 'subscription';
        const categoryLabel = isBill ? 'bill' : isSubscription ? 'subscription' : null;
        const addLabel = isSubscription ? 'add as subscription' : 'add as bill';
        const notLabel = isBill ? 'not a bill' : 'not recurring';
        const descLabel = isBill
          ? 'this looks like a recurring bill'
          : isSubscription
          ? 'this looks like a recurring subscription'
          : 'this looks like a recurring charge';
        return (
          <div
            key={id}
            style={{
              padding: '18px 20px',
              background: T.paper,
              borderBottom: `1px solid ${T.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text }}>
                {descLabel} — {copy}
              </span>
              {categoryLabel && (
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase' as const,
                  color: T.faint,
                  border: `1px solid ${T.border}`,
                  borderRadius: 3,
                  padding: '2px 5px',
                  flexShrink: 0,
                }}>
                  {categoryLabel}
                </span>
              )}
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.18em', color: T.faint, textTransform: 'uppercase' }}>
              {c.evidence.occurrenceCount} {c.evidence.occurrenceCount === 1 ? 'occurrence' : 'occurrences'} · {c.confidence} confidence
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => confirmCandidate(c)}
                style={{ ...d3BtnStyle, color: T.text, borderColor: T.border }}
              >
                {addLabel}
              </button>
              <button
                type="button"
                onClick={() => dismissCandidate(c)}
                style={d3BtnStyle}
              >
                {notLabel}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ─── SavingsCard · Sprint 2.5 / F1 ────────────────────────────────────────
// Decision #14 (locked 2026-05-11): passive voice, "saved" never "you saved"
// or "ollie saved you". Math is elapsed_months × monthly_amount, not
// annual projection. Re-subscribe preserves history.

function SavingsCard() {
  const [totals] = useStoreSlice<SavingsTotals | null>('finance', 'savings', null);
  const [showDetail, setShowDetail] = useState(false);
  if (!totals || totals.year_total <= 0) return null;
  const copy = buildSavingsCardCopy(totals);
  if (!copy) return null;

  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
        saved this year
      </div>
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          textAlign: 'left',
          padding: '18px 20px',
          background: T.paper,
          border: 'none',
          borderBottom: `1px solid ${T.border}`,
          cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 14,
          color: T.text,
        }}
        aria-expanded={showDetail}
      >
        {copy}
      </button>
      {showDetail && (
        <div style={{ padding: '14px 20px', background: T.paper, fontFamily: "'DM Mono', monospace", fontSize: 11, color: T.muted, letterSpacing: '0.04em' }}>
          <div style={{ marginBottom: 8 }}>all time · ${totals.all_time_total.toFixed(2)}</div>
          {totals.entries.map((e) => (
            <div key={e.cancellation.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>{e.cancellation.merchant} · {e.months_elapsed} mo</span>
              <span>${e.saved_amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const d3BtnStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  padding: '8px 12px',
  background: 'transparent',
  color: T.muted,
  border: `1px solid ${T.border}`,
  cursor: 'pointer',
  borderRadius: 12,
};

// ─── SavingsLedger · "set aside" book ─────────────────────────────────────
// A plain ledger of money the user deliberately tucked away ("set aside $X").
// Distinct from SavingsCard (which derives savings from cancelled subs) and
// from savings *goals* (target-driven). This is just a running record + log.
// Backend writes finance.savingsLedger; the UI can also append manually.
// Voice: factual, no praise, no streak. "set aside" — passive, never "you".

export interface SavingsLedgerEntry {
  id: string;
  amount: number;
  /** ms epoch */
  ts: number;
  /** optional free-text note: where it went / why */
  note?: string | null;
  /** 'manual' = typed here; anything else = surfaced by detection */
  source?: string;
}

/** Sum of all ledger amounts. Tolerates malformed entries. */
export function savingsLedgerTotal(entries: SavingsLedgerEntry[] | null | undefined): number {
  if (!Array.isArray(entries)) return 0;
  let sum = 0;
  for (const e of entries) {
    if (e && typeof e.amount === 'number' && isFinite(e.amount) && e.amount > 0) {
      sum += e.amount;
    }
  }
  return sum;
}

/** Newest-first, malformed entries dropped. */
export function sortedLedgerEntries(
  entries: SavingsLedgerEntry[] | null | undefined,
): SavingsLedgerEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e): e is SavingsLedgerEntry =>
      Boolean(e) && typeof e.amount === 'number' && isFinite(e.amount) && e.amount > 0 && typeof e.ts === 'number')
    .sort((a, b) => b.ts - a.ts);
}

function SavingsLedger() {
  const [ledger, setLedger] = useStoreSlice<SavingsLedgerEntry[]>('finance', 'savingsLedger', []);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const entries = useMemo(() => sortedLedgerEntries(ledger), [ledger]);
  const total = useMemo(() => savingsLedgerTotal(ledger), [ledger]);

  function addEntry() {
    const amt = Number.parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) return;
    const entry: SavingsLedgerEntry = {
      id: mkId('sl'),
      amount: Math.round(amt * 100) / 100,
      ts: Date.now(),
      note: note.trim().slice(0, 120) || null,
      source: 'manual',
    };
    setLedger([...(ledger ?? []), entry]);
    setAmount('');
    setNote('');
    setOpen(false);
  }

  function removeEntry(id: string) {
    setLedger((ledger ?? []).filter((e) => e.id !== id));
  }

  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
        <div style={labelStyle}>
          set aside{total > 0 ? ` · $${fmtMoney(total)}` : ''}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={addBtn}
          aria-expanded={open}
        >
          {open ? '× close' : '+ log'}
        </button>
      </div>

      {open && (
        <div style={{ display: 'flex', gap: 8, padding: '16px 0', flexWrap: 'wrap' }}>
          <input
            placeholder="$"
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="amount set aside"
            style={{ ...inputStyle, width: 90 }}
          />
          <input
            placeholder="note · optional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="set aside note"
            style={{ ...inputStyle, flex: '2 1 200px' }}
          />
          <button type="button" onClick={addEntry} style={addBtn}>save</button>
        </div>
      )}

      {entries.length === 0 && !open && (
        <div style={{ padding: '18px 0', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.muted, fontStyle: 'italic' }}>
          nothing set aside yet.
        </div>
      )}

      {entries.slice(0, 30).map((entry) => (
        <div key={entry.id} style={rowStyle}>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text }}>
              ${fmtMoney(entry.amount)}
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.muted, letterSpacing: '0.12em', marginTop: 4 }}>
              {entry.note ? `${entry.note} · ` : ''}
              {new Date(entry.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()}
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeEntry(entry.id)}
            aria-label="remove ledger entry"
            style={removeBtn}
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
}

// ─── ADHDTaxCandidateChip · gentle, sparse confirmation ───────────────────
// Backend emits finance:adhd_tax_candidate_detected and writes
// finance.adhdTaxCandidates. We surface ONE chip at a time, asking softly
// whether a charge was an inattention spend. "yes" → appends to the
// finance.adhd_tax list. Constitutional restraint: never every purchase,
// never shame. high-confidence auto_add candidates are filtered out — those
// the orchestrator already booked, so we'd double-ask.

export interface ADHDTaxCandidateSlice {
  id: string;
  record_id: string | null;
  category: 'late_fee' | 'replacement' | 'duplicate' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  amount: number | null;
  matched_phrase: string;
  copy: string;
  auto_add: boolean;
  ts: number;
}

/**
 * Pick at most ONE candidate to surface: not dismissed, not confirmed,
 * not auto_add (already booked by orchestrator), newest first. Sparse by
 * construction — one chip, not a feed.
 */
export function pickADHDTaxChip(
  candidates: ADHDTaxCandidateSlice[] | null | undefined,
  dismissed: Record<string, number> | null | undefined,
  confirmed: Record<string, number> | null | undefined,
): ADHDTaxCandidateSlice | null {
  if (!Array.isArray(candidates)) return null;
  const d = dismissed ?? {};
  const c = confirmed ?? {};
  const open = candidates
    .filter((x): x is ADHDTaxCandidateSlice => Boolean(x) && typeof x.id === 'string')
    .filter((x) => !x.auto_add && !d[x.id] && !c[x.id])
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return open[0] ?? null;
}

function ADHDTaxCandidateChip() {
  const [candidates] = useStoreSlice<ADHDTaxCandidateSlice[]>('finance', 'adhdTaxCandidates', []);
  const [dismissed, setDismissed] = useStoreSlice<Record<string, number>>(
    'finance', '_adhdTaxCandidateDismissed', {},
  );
  const [confirmed, setConfirmed] = useStoreSlice<Record<string, number>>(
    'finance', '_adhdTaxCandidateConfirmed', {},
  );
  const [tax, setTax] = useStoreSlice<StoredTax[]>('finance', 'adhd_tax', []);

  const chip = useMemo(
    () => pickADHDTaxChip(candidates, dismissed, confirmed),
    [candidates, dismissed, confirmed],
  );

  if (!chip) return null;

  function dismiss(c: ADHDTaxCandidateSlice) {
    setDismissed({ ...(dismissed ?? {}), [c.id]: Date.now() });
  }

  function confirm(c: ADHDTaxCandidateSlice) {
    const entry: StoredTax = {
      id: mkId('t'),
      text: (c.copy || c.matched_phrase || 'inattention spend').slice(0, 120),
      amount: c.amount ?? 0,
      ts: Date.now(),
    };
    setTax([...(tax ?? []), entry]);
    setConfirmed({ ...(confirmed ?? {}), [c.id]: Date.now() });
  }

  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
        worth a look
      </div>
      <div style={{ padding: '18px 20px', background: T.paper, borderBottom: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text, lineHeight: 1.5 }}>
          {chip.copy}
          {chip.amount != null ? ` — $${fmtMoney(chip.amount)}` : ''}. was this one a distracted spend?
        </span>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => confirm(chip)}
            style={{ ...d3BtnStyle, color: T.text, borderColor: T.border }}
          >
            yes — log it
          </button>
          <button type="button" onClick={() => dismiss(chip)} style={d3BtnStyle}>
            no
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── FinanceNoticed ───────────────────────────────────────────────────────────

function FinanceNoticed() {
  const [patterns] = useStoreSlice<PatternCard[]>('finance', 'patterns', []);
  const [dismissed, setDismissed] = useStoreSlice<Record<string, number>>('finance', 'patterns_dismissed', {});

  const list = Array.isArray(patterns) ? patterns : [];

  function idOf(p: PatternCard): string {
    if (!p?.pattern) return '?';
    if (p.pattern === 'doom-buying' && p.record_id) return `${p.pattern}:${p.record_id}`;
    if (p.pattern === 'hyperfocus-burst' && p.category) return `${p.pattern}:${p.category}`;
    if (p.pattern === 'duplicate-purchase' && p.record_id) return `${p.pattern}:${p.record_id}`;
    if (p.pattern === 'subscription-cancel-avoidance' && p.record_id) return `${p.pattern}:${p.record_id}`;
    if (p.pattern === 'return-abandonment' && p.record_id) return `${p.pattern}:${p.record_id}`;
    if (p.pattern === 'research-paralysis' && p.loop_id) return `${p.pattern}:${p.loop_id}`;
    return p.pattern;
  }

  function dismiss(id: string) {
    setDismissed({ ...(dismissed ?? {}), [id]: Date.now() });
  }

  const visible = list.filter((p) => p?.copy && !(dismissed?.[idOf(p)]));

  function metaFor(p: PatternCard): string[] {
    const bits: string[] = [];
    if (typeof p.burst_count === 'number') bits.push(`${p.burst_count} purchases`);
    if (p.category) bits.push(p.category);
    if (typeof p.variance_pct === 'number') bits.push(`${p.variance_pct}% variance`);
    if (typeof p.months_observed === 'number') bits.push(`${p.months_observed} months`);
    if (typeof p.similarity === 'number') bits.push(`${Math.round(p.similarity * 100)}% match`);
    if (typeof p.floor === 'number') bits.push(`floor ${p.floor}`);
    if (typeof p.days_marked === 'number') bits.push(`${p.days_marked} days marked`);
    if (typeof p.days_left === 'number')
      bits.push(p.days_left >= 0 ? `${p.days_left}d left` : 'window passed');
    if (typeof p.mention_count === 'number') bits.push(`${p.mention_count} mentions`);
    return bits;
  }

  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
        noticed
      </div>
      {visible.length === 0 ? (
        <div style={{
          padding: '18px 0',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          color: T.muted,
          fontStyle: 'italic',
        }}>
          no spending patterns surfaced yet.
        </div>
      ) : (
        visible.map((p, i) => {
          const id = idOf(p);
          const meta = metaFor(p);
          return (
            <div
              key={`${id}:${i}`}
              style={{
                padding: '18px 20px',
                background: T.paper,
                borderLeft: `2px solid ${T.accent}`,
                borderRadius: 2,
                marginTop: 12,
                position: 'relative',
              }}
            >
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="dismiss pattern"
                style={{
                  position: 'absolute', top: 10, right: 12,
                  background: 'transparent', border: 'none',
                  color: T.faint,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 14, cursor: 'pointer',
                  lineHeight: 1,
                  minWidth: 44, minHeight: 44,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ×
              </button>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9, letterSpacing: '0.24em',
                color: T.faint, textTransform: 'uppercase', paddingBottom: 8,
              }}>
                {(p.pattern ?? '').replace(/-/g, ' ')}
              </div>
              <div style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 15, color: T.text, lineHeight: 1.55, paddingRight: 24,
              }}>
                {p.copy}
              </div>
              {meta.length > 0 && (
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9, letterSpacing: '0.22em',
                  color: T.faint, textTransform: 'uppercase',
                  paddingTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap',
                }}>
                  {meta.map((m, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span>·</span>}
                      <span>{m}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {p.source?.citation && (
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9, letterSpacing: '0.18em',
                  color: T.faint, paddingTop: 8, lineHeight: 1.5,
                }}>
                  {p.source.url ? (
                    <a
                      href={p.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: T.faint, textDecoration: 'none', borderBottom: `1px dotted ${T.faint}` }}
                    >
                      {p.source.citation}
                    </a>
                  ) : p.source.citation}
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

// ─── FinanceSignalsSection ────────────────────────────────────────────────────

function FinanceSignalsSection({ masked = false }: { masked?: boolean }) {
  const [financeSettings] = useStoreSlice<FinanceSettings>('finance', 'settings', {});
  const [cycleCorrelation] = useStoreSlice<CycleCorrelation | null>('finance', 'cycleCorrelation', null);
  const [sleepCorrelation] = useStoreSlice<SleepCorrelation | null>('finance', 'sleepCorrelation', null);
  const [staleSubs] = useStoreSlice<StaleSubscription[]>('finance', 'staleSubs', []);
  const [postPaydaySpikes] = useStoreSlice<PostPaydaySpikesStore | null>('finance', 'postPaydaySpikes', null);
  const [anomalies] = useStoreSlice<FinanceRecord[]>('finance', 'anomalies', []);
  const $fmt = (n: number | null | undefined) => maskMoney(masked, fmtMoney(n));

  const xCycleOn = financeSettings?.show_cross_cycle_correlation === true;
  const xSleepOn = financeSettings?.show_cross_sleep_correlation === true;
  const cycleN = cycleCorrelation ? (cycleCorrelation.run_length ?? cycleCorrelation.n ?? 0) : 0;
  const sleepN = sleepCorrelation ? (sleepCorrelation.run_length ?? sleepCorrelation.n ?? 0) : 0;
  const showCycle = xCycleOn && cycleCorrelation != null && cycleN >= 3;
  const showSleep = xSleepOn && sleepCorrelation != null && sleepN >= 3;
  const showStale = staleSubs.length > 0;
  const showSpikes = postPaydaySpikes?.spikes != null && postPaydaySpikes.spikes.length >= 3;
  const showAnoms = anomalies.length > 0;

  if (!showCycle && !showSleep && !showStale && !showSpikes && !showAnoms) return null;

  const cardStyle: React.CSSProperties = {
    padding: '16px 18px',
    background: T.paper,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    marginBottom: 10,
  };
  const titleStyle: React.CSSProperties = {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 14,
    color: T.text,
    marginBottom: 6,
  };
  const bodyStyle: React.CSSProperties = {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.5,
  };
  const subStyle: React.CSSProperties = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 10,
    color: T.faint,
    letterSpacing: '0.12em',
    marginTop: 6,
    lineHeight: 1.5,
  };
  const sourceStyle: React.CSSProperties = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    color: T.faint,
    letterSpacing: '0.14em',
    marginTop: 8,
    opacity: 0.7,
  };

  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
        signals
      </div>
      <div style={{ paddingTop: 18 }}>
        {showCycle && cycleCorrelation && (
          <div style={cardStyle}>
            <div style={titleStyle}>cycle correlation</div>
            <div style={bodyStyle}>
              spending has clustered in your luteal phase across {cycleN} cycles. observation, not diagnosis.
            </div>
            {typeof cycleCorrelation.note === 'string' && cycleCorrelation.note && (
              <div style={subStyle}>{cycleCorrelation.note}</div>
            )}
            <div style={sourceStyle}>source · cycle module · {cycleN} cycles</div>
          </div>
        )}
        {showSleep && sleepCorrelation && (
          <div style={cardStyle}>
            <div style={titleStyle}>sleep correlation</div>
            <div style={bodyStyle}>
              poor-sleep nights are followed by{' '}
              {sleepN >= 5 ? 'consistent' : 'noticeable'} next-day spend bumps.
              observation, not diagnosis.
            </div>
            {typeof sleepCorrelation.note === 'string' && sleepCorrelation.note && (
              <div style={subStyle}>{sleepCorrelation.note}</div>
            )}
            <div style={sourceStyle}>source · sleep module · {sleepN} overlapping nights</div>
          </div>
        )}
        {showStale && (
          <div style={cardStyle}>
            <div style={titleStyle}>quiet subscriptions</div>
            <div style={{ ...bodyStyle, marginBottom: 8 }}>
              haven't been mentioned in 90+ days.
            </div>
            {staleSubs.slice(0, 5).map((s) => (
              <div
                key={s.pattern_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  color: T.muted,
                  letterSpacing: '0.06em',
                }}
              >
                <span>{s.display_name ?? 'unnamed'}</span>
                <span>{s.cadence}</span>
              </div>
            ))}
            <div style={sourceStyle}>source · finance recurring detector</div>
          </div>
        )}
        {showSpikes && postPaydaySpikes && (
          <div style={cardStyle}>
            <div style={titleStyle}>post-payday pattern</div>
            <div style={bodyStyle}>
              spend has spiked within {postPaydaySpikes.window_days ?? 3} days of payday
              across {postPaydaySpikes.spikes.length} cycles.
            </div>
            <div style={sourceStyle}>source · finance · stephens 2003</div>
          </div>
        )}
        {showAnoms && (
          <div style={cardStyle}>
            <div style={titleStyle}>unusual transactions</div>
            <div style={{ ...bodyStyle, marginBottom: 8 }}>
              outside your normal range (modified-z &gt; 3.5).
            </div>
            {anomalies.slice(0, 4).map((a) => (
              <div
                key={a.id ?? a.event_date}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  color: T.muted,
                  letterSpacing: '0.06em',
                }}
              >
                <span>{a.merchant ?? a.category ?? 'unlabeled'}</span>
                <span>
                  {a.amount != null ? `$${$fmt(a.amount)}` : ''}
                  {a.event_date ? ` · ${String(a.event_date).slice(5)}` : ''}
                </span>
              </div>
            ))}
            <div style={sourceStyle}>source · iglewicz & hoaglin 1993</div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── AuditEntryLink ──────────────────────────────────────────────────────────
// Compact "§ N to review" link surfaced inside the subscriptions section
// header. Uses the same store slices the audit screen consumes so the
// kicker count stays in sync without a recompute round-trip.

function AuditEntryLink({ onOpen }: { onOpen: () => void }) {
  const { candidateCount, kickerLabel } = useAuditEntryKicker();
  const hasCandidates = candidateCount > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="open subscription audit"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: hasCandidates ? T.accent : T.muted,
        fontFamily: "'DM Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.12em',
        padding: 0,
      }}
    >
      {`§ ${kickerLabel}`}
    </button>
  );
}

// ─── FinanceModule ────────────────────────────────────────────────────────────

export function FinanceModule() {
  // ── store slices ──────────────────────────────────────────────────────────
  const [records]  = useStoreSlice<FinanceRecord[]>('finance', 'records', []);
  const [goals, setGoals] = useStoreSlice<StoredGoal[]>('finance', 'goals', []);
  const [settings] = useStoreSlice<FinanceSettings>('finance', 'settings', {});

  // legacy slices (mirrored to records by orchestrator in void; we keep them
  // as the primary editable data surface here)
  const [bills, setBills] = useStoreSlice<StoredBill[]>('finance', 'bills', []);
  const [subs, setSubs]   = useStoreSlice<StoredSub[]>('finance', 'subscriptions', []);
  const [tax, setTax]     = useStoreSlice<StoredTax[]>('finance', 'adhd_tax', []);
  const [transactions, setTransactions] = useStoreSlice<StoredTransaction[]>('finance', 'transactions', []);

  // orchestrator-derived
  const [derivedSafeToSpend] = useStoreSlice<SpendBand | null>('finance', 'safeToSpend', null);

  // ── Sprint 6 · impulse pause + privacy mode ──────────────────────────────
  const [pendingPauses, setPendingPauses] = useStoreSlice<PendingPause[]>('finance', 'pendingPauses', []);
  const [savedByPause, setSavedByPause]   = useStoreSlice<{ count: number; total: number }>('finance', 'savedByPause', { count: 0, total: 0 });
  const [privacy, setPrivacy]             = useStoreSlice<PrivacyState>('finance', 'privacy', { enabled: false, unlockedUntil: 0 });

  // ── local UI state ────────────────────────────────────────────────────────
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [txOpen, setTxOpen] = useState(false);
  const [txDraft, setTxDraft] = useState({
    amount: '', merchant: '', category: 'groceries', returnable_until: '',
  });
  const [activePauseId, setActivePauseId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  // Tick once a minute while privacy mode is enabled so the auto-relock
  // window expires without a manual interaction. No-op when masked is off.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!privacy?.enabled || !privacy.unlockedUntil) return;
    const remaining = privacy.unlockedUntil - Date.now();
    if (remaining <= 0) { setTick((t) => t + 1); return; }
    const id = window.setTimeout(() => setTick((t) => t + 1), Math.min(remaining + 100, 60_000));
    return () => window.clearTimeout(id);
  }, [privacy, tick]);

  // Derived: are money figures currently hidden?
  const masked = useMemo(() => isMaskedNow(privacy, Date.now()), [privacy, tick]);
  // Bound formatter used everywhere a $-figure would be rendered.
  const $fmt = useCallback((n: number | null | undefined): string => {
    return maskMoney(masked, fmtMoney(n));
  }, [masked]);

  const now = useMemo(() => Date.now(), []);
  const nowDate = useMemo(() => new Date(now), [now]);
  const dateStr = nowDate
    .toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    .toLowerCase();

  // ── derived — logic fns (all useMemo) ───────────────────────────────────

  const detected = useMemo(
    () => detectRecurring(records, { minOccurrences: settings?.recurring_maturity_minocc ?? 3 }),
    [records, settings],
  );

  const upcomingBillList: UpcomingBill[] = useMemo(
    () => upcomingBills(detected.recurring, 14, now),
    [detected.recurring, now],
  );

  const adhdTaxSummary: ADHDTaxSummary = useMemo(
    () => trackADHDTaxEvents(records, 90, now),
    [records, now],
  );

  const staleSubs: StaleSubscription[] = useMemo(
    () => detectSubscriptionStale(detected.recurring, [], [] as string[], 90, now),
    [detected.recurring, now],
  );

  const goalProgressList = useMemo(
    () =>
      goals.map((g) =>
        savingsGoalProgress(
          { target: g.target, saved: g.saved, contributions: [] } satisfies SavingsGoal,
          records,
          now,
        ),
      ),
    [goals, records, now],
  );

  const computedSafeToSpend: SpendBand | null = useMemo(
    () => {
      if (derivedSafeToSpend) return derivedSafeToSpend;
      return safeToSpend(records, now, 7, settings ?? {});
    },
    [derivedSafeToSpend, records, now, settings],
  );

  const haveIncomeSignal =
    computedSafeToSpend != null &&
    !computedSafeToSpend.cold_start &&
    typeof computedSafeToSpend.central === 'number';

  const safeToSpendAmount = haveIncomeSignal ? Math.round(computedSafeToSpend!.central) : 0;
  const safeToSpendCaveat = computedSafeToSpend?.cold_start ? 'learning your income pattern' : null;

  // ── bill helpers ──────────────────────────────────────────────────────────

  function nextDueDate(b: StoredBill): Date {
    const freq = b.frequency ?? 'monthly';
    const dueDay = Math.max(1, +b.dueDay || 1);
    const anchorMonth = Math.min(12, Math.max(1, +(b.anchorMonth ?? 1) || 1));
    const y = nowDate.getFullYear(), m = nowDate.getMonth();
    const today = nowDate.getDate();
    const todayD = new Date(y, m, today);
    const dimOf = (yr: number, mo: number) => new Date(yr, mo + 1, 0).getDate();
    const clamp = (d: number, yr: number, mo: number) => Math.min(Math.max(d, 1), dimOf(yr, mo));

    if (freq === 'yearly') {
      const am = anchorMonth - 1;
      const thisY = new Date(y, am, clamp(dueDay, y, am));
      if (thisY >= todayD) return thisY;
      return new Date(y + 1, am, clamp(dueDay, y + 1, am));
    }
    if (freq === 'quarterly') {
      const anchorRem = (anchorMonth - 1) % 3;
      for (let i = 0; i < 6; i++) {
        const tm = m + i;
        if (tm % 3 === anchorRem) {
          const ty = y + Math.floor(tm / 12);
          const tmn = ((tm % 12) + 12) % 12;
          const cand = new Date(ty, tmn, clamp(dueDay, ty, tmn));
          if (cand >= todayD) return cand;
        }
      }
    }
    const thisMonth = new Date(y, m, clamp(dueDay, y, m));
    if (thisMonth >= todayD) return thisMonth;
    return new Date(y, m + 1, clamp(dueDay, y, m + 1));
  }

  function periodKeyForDate(b: StoredBill, d: Date): string {
    const yr = d.getFullYear(), mo = d.getMonth();
    if (b.frequency === 'yearly') return String(yr);
    if (b.frequency === 'quarterly') return `${yr}-Q${Math.floor(mo / 3) + 1}`;
    return `${yr}-${String(mo + 1).padStart(2, '0')}`;
  }

  function isPaidCurrent(b: StoredBill): boolean {
    const due = nextDueDate(b);
    return b.lastPaidPeriod === periodKeyForDate(b, due);
  }

  function daysUntil(b: StoredBill): number {
    const target = nextDueDate(b);
    const from = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    return Math.round((target.getTime() - from.getTime()) / 86_400_000);
  }

  function monthlyEquivalent(b: StoredBill): number {
    const a = +b.amount || 0;
    if (b.frequency === 'yearly') return a / 12;
    if (b.frequency === 'quarterly') return a / 3;
    return a;
  }

  const sortedBills = useMemo(
    () => [...bills].sort((a, b) => daysUntil(a) - daysUntil(b)),
    [bills], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const unpaidBills = useMemo(
    () => sortedBills.filter((b) => !isPaidCurrent(b)),
    [sortedBills], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nextBill = unpaidBills[0] ?? sortedBills[0] ?? null;
  const nextDays = nextBill ? daysUntil(nextBill) : null;

  const billsMonthly = useMemo(
    () => bills.reduce((s, b) => s + monthlyEquivalent(b), 0),
    [bills], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const subsMonthly = useMemo(
    () => subs.reduce((s, x) => s + (x.period === 'yearly' ? (+x.amount || 0) / 12 : (+x.amount || 0)), 0),
    [subs],
  );

  const SHADES = [0.95, 0.78, 0.64, 0.52, 0.42, 0.34, 0.27, 0.21, 0.17, 0.13, 0.10, 0.08];
  const donutItems: DonutItem[] = useMemo(
    () =>
      [...bills]
        .map((b) => ({
          key: b.id,
          name: b.name,
          value: monthlyEquivalent(b),
          freq: b.frequency ?? 'monthly',
          amount: +b.amount || 0,
        }))
        .filter((it) => it.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((it, i) => ({
          ...it,
          color: `rgba(255,255,255,${SHADES[i] !== undefined ? SHADES[i] : 0.08})`,
        })),
    [bills], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  const taxThisMonth = tax.filter((t) => t.ts >= monthStart);
  const taxMTD = taxThisMonth.reduce((s, t) => s + (+t.amount || 0), 0);

  const usedPresetKeys = useMemo(() => new Set(bills.map((b) => b.preset).filter(Boolean)), [bills]);

  // ── handlers ──────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  function cancel() { setOpenForm(null); setDraft({}); }
  function startDraft(type: string) { setOpenForm(type); setDraft({}); }

  function markPaid(bill: StoredBill) {
    const due = nextDueDate(bill);
    const periodKey = periodKeyForDate(bill, due);
    const already = bill.lastPaidPeriod === periodKey;
    let next: StoredBill;
    if (already) {
      const payments = [...(bill.payments ?? [])];
      for (let i = payments.length - 1; i >= 0; i--) {
        if (payments[i].periodKey === periodKey) { payments.splice(i, 1); break; }
      }
      const newLast = payments.length ? payments[payments.length - 1].periodKey : null;
      next = { ...bill, payments, lastPaidPeriod: newLast };
    } else {
      const payments = [...(bill.payments ?? []), { ts: Date.now(), amount: +bill.amount || 0, periodKey }];
      next = { ...bill, payments, lastPaidPeriod: periodKey };
    }
    setBills(bills.map((x) => (x.id === bill.id ? next : x)));
  }

  function addBill() {
    if (!draft.name) return;
    const freq = (draft.frequency ?? 'monthly') as StoredBill['frequency'];
    const bill: StoredBill = {
      id: mkId('b'),
      name: draft.name.slice(0, 80),
      preset: draft.preset ?? null,
      amount: +draft.amount || 0,
      frequency: freq,
      dueDay: +draft.dueDay || 1,
      anchorMonth: freq === 'monthly' ? null : (+draft.anchorMonth || nowDate.getMonth() + 1),
      payments: [],
      lastPaidPeriod: null,
      ts: Date.now(),
    };
    setBills([...bills, bill]);
    cancel();
  }

  function addBillFromPreset(preset: typeof FINANCE_PRESETS[number]) {
    setOpenForm('bill');
    setDraft({
      preset: preset.key,
      name: preset.name,
      frequency: preset.freq,
      anchorMonth: preset.freq === 'monthly' ? '' : String(nowDate.getMonth() + 1),
    });
  }

  function commitEdit(id: string, patch: Partial<Pick<StoredBill, 'name' | 'amount' | 'dueDay' | 'frequency' | 'anchorMonth'>>) {
    setBills(
      bills.map((b) =>
        b.id === id
          ? {
              ...b,
              name: patch.name !== undefined ? String(patch.name).slice(0, 80) : b.name,
              amount: patch.amount !== undefined ? +patch.amount || 0 : b.amount,
              dueDay: patch.dueDay !== undefined ? +patch.dueDay || 1 : b.dueDay,
              frequency: (patch.frequency ?? b.frequency) as StoredBill['frequency'],
              anchorMonth: patch.anchorMonth != null ? +patch.anchorMonth : b.anchorMonth,
            }
          : b,
      ),
    );
    setEditingBillId(null);
  }

  function addSub() {
    if (!draft.name) return;
    const sub: StoredSub = {
      id: mkId('s'),
      name: draft.name.slice(0, 80),
      amount: +draft.amount || 0,
      period: (draft.period ?? 'monthly') as StoredSub['period'],
      marked_to_cancel_at: null,
      ts: Date.now(),
    };
    setSubs([...subs, sub]);
    cancel();
  }

  function addGoal() {
    if (!draft.name || !draft.target) return;
    const goal: StoredGoal = {
      id: mkId('g'),
      name: draft.name.slice(0, 80),
      target: +draft.target || 0,
      saved: +draft.saved || 0,
      ts: Date.now(),
    };
    setGoals([...goals, goal]);
    cancel();
  }

  function bumpGoal(id: string, delta: number) {
    setGoals(goals.map((g) => (g.id === id ? { ...g, saved: Math.max(0, (+g.saved || 0) + delta) } : g)));
  }

  function addTax() {
    if (!draft.text) return;
    const entry: StoredTax = {
      id: mkId('t'),
      text: draft.text.slice(0, 120),
      amount: +draft.amount || 0,
      ts: Date.now(),
    };
    setTax([...tax, entry]);
    cancel();
  }

  function closeTxForm() {
    setTxOpen(false);
    setTxDraft({ amount: '', merchant: '', category: 'groceries', returnable_until: '' });
  }

  function parseReturnableUntil(raw: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [yy, mm, dd] = raw.split('-').map(Number);
    if (!yy || !mm || !dd) return null;
    const t = new Date(yy, mm - 1, dd, 23, 59, 59).getTime();
    return Number.isFinite(t) ? t : null;
  }

  function commitTransaction(args: {
    amount: number;
    merchant: string;
    category: string;
    returnable_until: number | null;
  }): StoredTransaction {
    const entry: StoredTransaction = {
      id: mkId('tx'),
      ts: Date.now(),
      amount: args.amount,
      merchant: args.merchant.slice(0, 80),
      category: args.category,
      direction: 'out',
      notes: '',
      returnable_until: args.returnable_until,
      return_status: null,
    };
    setTransactions([...transactions, entry]);
    return entry;
  }

  function saveTx() {
    const amt = parseFloat(txDraft.amount);
    if (!amt || isNaN(amt) || amt <= 0) return;
    const entry = commitTransaction({
      amount: amt,
      merchant: txDraft.merchant,
      category: txDraft.category,
      returnable_until: parseReturnableUntil(txDraft.returnable_until),
    });
    closeTxForm();
    showToast(`logged · $${Math.round(amt)} ${entry.category}.`);
  }

  // Sprint 6 · impulse pause: stash the draft + 24h timer instead of committing.
  function startPause() {
    const amt = parseFloat(txDraft.amount);
    if (!amt || isNaN(amt) || amt <= 0) return;
    const startTs = Date.now();
    const expires = startTs + 24 * 3600_000;
    const pause: PendingPause = {
      id: mkId('pause'),
      amount: amt,
      merchant: txDraft.merchant.slice(0, 80),
      category: txDraft.category,
      ts: startTs,
      expires_at: expires,
      draft: { returnable_until: parseReturnableUntil(txDraft.returnable_until) },
    };
    setPendingPauses([...(pendingPauses ?? []), pause]);
    try {
      emit('finance:impulse_pause_started', {
        id: pause.id,
        amount: pause.amount,
        merchant: pause.merchant,
        category: pause.category,
        ts: pause.ts,
        expires_at: pause.expires_at,
      });
      // Re-use the existing reminder pathway so the user sees a toast when
      // the 24h window closes. Backend agent's `finance:impulse_pause_summary`
      // worker is independent — it aggregates resolved pauses on a separate
      // schedule.
      emit('void:reminder:scheduled', {
        id: `impulse:${pause.id}`,
        fireAt: pause.expires_at,
        message: `24h hold passed · $${Math.round(pause.amount)}${pause.merchant ? ` · ${pause.merchant.toLowerCase()}` : ''}`,
        module: 'finance',
        source: 'impulse-pause',
      });
    } catch { /* event bus non-fatal */ }
    setActivePauseId(pause.id);
    closeTxForm();
    showToast(`held · $${Math.round(amt)}. resolve when ready.`);
  }

  function resolvePause(pause: PendingPause, outcome: 'purchased' | 'skipped') {
    setPendingPauses((pendingPauses ?? []).filter((p) => p.id !== pause.id));
    try {
      emit('finance:impulse_pause_resolved', {
        id: pause.id,
        amount: pause.amount,
        merchant: pause.merchant,
        outcome,
        ts: Date.now(),
      });
    } catch { /* non-fatal */ }
    if (outcome === 'purchased') {
      commitTransaction({
        amount: pause.amount,
        merchant: pause.merchant,
        category: pause.category,
        returnable_until: pause.draft.returnable_until,
      });
      showToast(`logged · $${Math.round(pause.amount)} ${pause.category}.`);
    } else {
      setSavedByPause({
        count: (savedByPause?.count ?? 0) + 1,
        total: (savedByPause?.total ?? 0) + pause.amount,
      });
      showToast(`saved · $${Math.round(pause.amount)}.`);
    }
    if (activePauseId === pause.id) setActivePauseId(null);
  }

  function heroCaption(): string | null {
    if (!nextBill) return null;
    const paidAll = bills.length > 0 && unpaidBills.length === 0;
    if (paidAll) return 'all caught up this cycle.';
    const amt = nextBill.amount ? ` · $${$fmt(nextBill.amount)}` : '';
    const tail =
      nextDays === 0 ? '. today.'
      : nextDays === 1 ? '. tomorrow. just saying.'
      : nextDays !== null && nextDays <= 3 ? '. soon.'
      : '.';
    return `${nextBill.name.toLowerCase()}${amt}${tail}`;
  }

  // bill groups for preset shelf
  const billGroups = FINANCE_GROUPS.map((g) => ({
    ...g,
    presets: FINANCE_PRESETS.filter((p) => p.group === g.key),
  }));

  // ── render ────────────────────────────────────────────────────────────────

  // Audit overlay takes over the screen when open. It uses the v2 paper
  // design system; the rest of FinanceModule stays on the dark v1
  // ledger style until the broader v2 redesign lands.
  if (auditOpen) {
    return <AuditSubscriptions onBack={() => setAuditOpen(false)} />;
  }

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: '#14130F',
        color: T.text,
        boxSizing: 'border-box',
        overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        style={{
          maxWidth: 780,
          margin: '0 auto',
          padding: '52px clamp(20px, 5vw, 40px) 140px',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 48 }}>
          <div>
            <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(30px, 7vw, 40px)', fontWeight: 400, margin: 0, color: T.text }}>
              finance.
            </h1>
            <div style={{ ...labelStyle, marginTop: 6 }}>{dateStr}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PrivacyToggle
              state={privacy ?? { enabled: false, unlockedUntil: 0 }}
              onChange={setPrivacy}
              onToast={showToast}
            />
            <button
              type="button"
              onClick={() => setTxOpen((o) => !o)}
              style={{ ...ghostBtn, color: T.text }}
            >
              {txOpen ? '× close' : '+ log tx'}
            </button>
            <ModuleHelp moduleId="finance" />
          </div>
        </div>

        {/* Log transaction inline form */}
        {txOpen && (
          <div style={{ marginBottom: 40, padding: '18px 20px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`, borderRadius: 14 }}>
            <div style={{ ...labelStyle, marginBottom: 12 }}>log transaction</div>
            <div className="fin-tx-grid" style={{ display: 'grid', gridTemplateColumns: '110px 1fr 150px auto', gap: 10, alignItems: 'center' }}>
              <input
                autoFocus
                value={txDraft.amount}
                onChange={(e) => setTxDraft((d) => ({ ...d, amount: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && saveTx()}
                placeholder="amount"
                type="number"
                step="0.01"
                min="0"
                aria-label="transaction amount"
                style={{ ...inputStyle, borderRadius: 10, padding: '10px 12px', fontSize: 13 }}
              />
              <input
                value={txDraft.merchant}
                onChange={(e) => setTxDraft((d) => ({ ...d, merchant: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && saveTx()}
                placeholder="merchant"
                aria-label="merchant"
                style={{ ...inputStyle, borderRadius: 10, padding: '10px 12px', fontSize: 13 }}
              />
              <select
                value={txDraft.category}
                onChange={(e) => setTxDraft((d) => ({ ...d, category: e.target.value }))}
                aria-label="category"
                style={{ ...inputStyle, borderRadius: 10, padding: '10px 12px', fontSize: 13 }}
              >
                {FIN_TX_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" onClick={saveTx} style={{ ...ghostBtn, color: T.text, padding: '10px 18px' }}>
                save
              </button>
            </div>

            {/* Sprint 6 · impulse hold opt-in. Surfaces only when the
                drafted category is a non-essential variable category. */}
            {isHoldEligible(txDraft.category) && parseFloat(txDraft.amount) > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
                <span style={{ ...labelStyle, fontSize: 9, opacity: 0.8 }}>impulse?</span>
                <button
                  type="button"
                  onClick={startPause}
                  aria-label="hold this purchase for 24 hours"
                  style={{
                    ...ghostBtn,
                    color: T.accent,
                    borderColor: T.accent,
                    padding: '8px 14px',
                    fontSize: 10,
                  }}
                >
                  hold 24 hours
                </button>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: T.faint, letterSpacing: '0.12em' }}>
                  optional · stashes the draft. resolve later.
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <label style={{ ...labelStyle, fontSize: 9, opacity: 0.8 }}>returnable until</label>
              <input
                type="date"
                value={txDraft.returnable_until}
                onChange={(e) => setTxDraft((d) => ({ ...d, returnable_until: e.target.value }))}
                aria-label="returnable until (optional)"
                style={{ ...inputStyle, borderRadius: 10, padding: '8px 10px', fontSize: 12 }}
              />
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: T.faint, letterSpacing: '0.12em' }}>
                optional
              </span>
            </div>
            {transactions.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ ...labelStyle, opacity: 0.8, fontSize: 9 }}>recent · {transactions.length} logged</div>
                {[...transactions].slice(-4).reverse().map((t) => (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'DM Mono', monospace", fontSize: 11, color: T.muted, letterSpacing: '0.05em' }}>
                    <span>${$fmt(t.amount)} · {t.category}{t.merchant ? ` · ${t.merchant}` : ''}</span>
                    <span>{new Date(t.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Next due hero */}
        <div style={{ marginBottom: 40 }}>
          <div style={labelStyle}>next due</div>
          {nextBill ? (
            <>
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 72, lineHeight: 1, margin: '14px 0 8px', color: T.text }}>
                {nextDays === 0 ? 'today' : `${nextDays}d`}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: 'rgba(255,255,255,0.6)' }}>
                {heroCaption()}
              </div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.faint, marginTop: 10, letterSpacing: '0.14em' }}>
                monthly burn · ${$fmt(billsMonthly + subsMonthly)}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 44, lineHeight: 1.2, margin: '14px 0 6px', color: T.text }}>
                nothing due.
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.muted }}>
                add a bill below when ready.
              </div>
            </>
          )}
        </div>

        {/* Safe-to-spend */}
        <div style={{ marginBottom: 48, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
          <div style={{ ...labelStyle, letterSpacing: '0.22em' }}>safe to spend this week</div>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 56, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.01em', margin: '14px 0 4px', color: T.text }}>
            {haveIncomeSignal ? `$${$fmt(safeToSpendAmount)}` : '—'}
          </div>
          {haveIncomeSignal && computedSafeToSpend && typeof computedSafeToSpend.sigma === 'number' && computedSafeToSpend.sigma > 0 && (
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.faint, marginTop: 8 }}>
              range · ${$fmt(Math.max(0, Math.round(computedSafeToSpend.central - computedSafeToSpend.sigma)))} — ${$fmt(Math.round(computedSafeToSpend.central + computedSafeToSpend.sigma))}
            </div>
          )}
          {safeToSpendCaveat && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontStyle: 'italic', color: T.faint, marginTop: 10, lineHeight: 1.5, maxWidth: 480 }}>
              {safeToSpendCaveat}
            </div>
          )}
          {!haveIncomeSignal && !safeToSpendCaveat && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: T.faint, marginTop: 10, lineHeight: 1.5, maxWidth: 480 }}>
              log income a few times. the number warms up after 3 recurring payments detected.
            </div>
          )}
        </div>

        {/* Variable-income surface — silent when sparse */}
        <IncomeCard records={records} now={now} masked={masked} $fmt={$fmt} />

        {/* Upcoming bills (derived) */}
        {upcomingBillList.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
              upcoming · next 14 days
            </div>
            {upcomingBillList.map((ub) => (
              <div key={ub.bill.id} style={rowStyle}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: T.text }}>
                    {ub.bill.display_name ?? ub.bill.merchant_normalized}
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: ub.daysUntil <= 3 ? 'rgba(220,160,100,0.75)' : T.muted, letterSpacing: '0.12em', marginTop: 4 }}>
                    {ub.daysUntil === 0 ? 'today' : `${ub.daysUntil}d`}
                    {ub.bill.amount_median != null ? ` · ~$${$fmt(ub.bill.amount_median)}` : ''}
                    {` · ${ub.confidence} confidence`}
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Signals */}
        <FinanceSignalsSection masked={masked} />

        {/* Bill overview donut */}
        {donutItems.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
              <div style={labelStyle}>overview · {donutItems.length} bill{donutItems.length === 1 ? '' : 's'}</div>
            </div>
            <div style={{ display: 'flex', gap: 36, alignItems: 'center', padding: '28px 0 8px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}>
                <FinanceDonut items={donutItems} total={billsMonthly} size={180} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.22em', color: T.muted, textTransform: 'uppercase', marginBottom: 4 }}>per month</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 30, color: T.text, lineHeight: 1 }}>${$fmt(billsMonthly)}</div>
                  {subsMonthly > 0 && (
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: T.faint, letterSpacing: '0.14em', marginTop: 6 }}>+${$fmt(subsMonthly)} subs</div>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                {donutItems.map((it) => {
                  const pct = billsMonthly > 0 ? (it.value / billsMonthly) * 100 : 0;
                  const shown = it.freq === 'monthly' ? it.amount : it.value;
                  const freqTag = it.freq === 'yearly' ? ` · $${$fmt(it.amount)}/yr` : it.freq === 'quarterly' ? ` · $${$fmt(it.amount)}/qtr` : '';
                  return (
                    <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: it.color, flexShrink: 0 }} aria-hidden="true" />
                      <div style={{ flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.muted, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>
                        ${$fmt(shown)}{freqTag ? '' : '/mo'}{freqTag}
                      </div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.faint, letterSpacing: '0.1em', minWidth: 34, textAlign: 'right' }}>
                        {pct < 1 ? '<1' : Math.round(pct)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Recurring candidate cards — braindump-driven early detection */}
        <RecurringCandidateCards />

        {/* Recurring bills */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
            <div style={labelStyle}>recurring bills</div>
            <button type="button" onClick={() => openForm === 'bill' ? cancel() : startDraft('bill')} style={addBtn}>
              {openForm === 'bill' ? '× close' : '+ custom'}
            </button>
          </div>

          {/* Preset shelf */}
          <div style={{ padding: '18px 0 4px' }}>
            {billGroups.map((g) => (
              <div key={g.key} style={{ marginBottom: 14 }}>
                <div style={{ ...labelStyle, fontSize: 8, marginBottom: 8, opacity: 0.8 }}>{g.label}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {g.presets.map((p) => {
                    const used = usedPresetKeys.has(p.key);
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => addBillFromPreset(p)}
                        disabled={used}
                        aria-label={`add ${p.name} bill`}
                        style={{
                          background: used ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${used ? 'rgba(255,255,255,0.05)' : T.border}`,
                          borderRadius: 16,
                          padding: '7px 13px',
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.08em',
                          color: used ? T.faint : T.text,
                          cursor: used ? 'default' : 'pointer',
                          opacity: used ? 0.45 : 1,
                        }}
                      >
                        {used ? '✓ ' : '+ '}{p.name}
                        {p.freq !== 'monthly' && (
                          <span style={{ opacity: 0.5, marginLeft: 6 }}>· {p.freq === 'yearly' ? 'yr' : 'qtr'}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {openForm === 'bill' && (
            <div style={{ padding: '14px 0 18px', borderTop: `1px solid ${T.border}`, marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <input
                  placeholder="name"
                  value={draft.name ?? ''}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  aria-label="bill name"
                  style={{ ...inputStyle, flex: '2 1 200px' }}
                />
                <input
                  placeholder="$"
                  type="number"
                  value={draft.amount ?? ''}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  aria-label="bill amount"
                  style={{ ...inputStyle, width: 100 }}
                />
                <input
                  placeholder="day 1–31"
                  type="number"
                  min="1"
                  max="31"
                  value={draft.dueDay ?? ''}
                  onChange={(e) => setDraft({ ...draft, dueDay: e.target.value })}
                  aria-label="due day"
                  style={{ ...inputStyle, width: 110 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={draft.frequency ?? 'monthly'}
                  onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}
                  aria-label="frequency"
                  style={{ ...inputStyle, width: 130 }}
                >
                  <option value="monthly">monthly</option>
                  <option value="quarterly">quarterly</option>
                  <option value="yearly">yearly</option>
                </select>
                {(draft.frequency === 'quarterly' || draft.frequency === 'yearly') && (
                  <select
                    value={draft.anchorMonth ?? String(nowDate.getMonth() + 1)}
                    onChange={(e) => setDraft({ ...draft, anchorMonth: e.target.value })}
                    aria-label="anchor month"
                    style={{ ...inputStyle, width: 140 }}
                  >
                    {['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map((n, i) => (
                      <option key={n} value={i + 1}>
                        {draft.frequency === 'quarterly' ? `q anchor · ${n}` : `month · ${n}`}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" onClick={addBill} style={addBtn}>save</button>
              </div>
            </div>
          )}

          {sortedBills.length === 0 && (
            <div style={{ padding: '18px 0', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.muted, fontStyle: 'italic' }}>
              no bills yet.
            </div>
          )}

          {sortedBills.map((b) => {
            const d = daysUntil(b);
            const paid = isPaidCurrent(b);
            const soon = !paid && d <= 3;
            const freqLabel = b.frequency === 'yearly' ? 'yr' : b.frequency === 'quarterly' ? 'qtr' : 'mo';
            const isEditing = editingBillId === b.id;

            if (isEditing) {
              const nameRef = React.createRef<HTMLInputElement>();
              const amtRef  = React.createRef<HTMLInputElement>();
              const dayRef  = React.createRef<HTMLInputElement>();
              return (
                <div key={b.id} style={{ padding: '16px 0', borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <input ref={nameRef} defaultValue={b.name} aria-label="edit name" style={{ ...inputStyle, flex: '2 1 180px' }} />
                    <input ref={amtRef} defaultValue={String(b.amount)} type="number" aria-label="edit amount" style={{ ...inputStyle, width: 100 }} />
                    <input ref={dayRef} defaultValue={String(b.dueDay)} type="number" min="1" max="31" aria-label="edit due day" style={{ ...inputStyle, width: 110 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => commitEdit(b.id, {
                        name: nameRef.current?.value,
                        amount: amtRef.current?.value !== undefined ? +amtRef.current.value : undefined,
                        dueDay: dayRef.current?.value !== undefined ? +dayRef.current.value : undefined,
                      })}
                      style={addBtn}
                    >
                      save
                    </button>
                    <button type="button" onClick={() => setEditingBillId(null)} style={ghostBtn}>cancel</button>
                    <button
                      type="button"
                      onClick={() => { setBills(bills.filter((x) => x.id !== b.id)); setEditingBillId(null); }}
                      style={{ ...removeBtn, marginLeft: 'auto' }}
                      aria-label={`remove bill ${b.name}`}
                    >
                      remove
                    </button>
                  </div>
                </div>
              );
            }

            const countdown = paid ? `paid · next in ${d}d` : d === 0 ? 'today' : `${d}d`;
            const meta = [`day ${b.dueDay}`];
            if (b.frequency !== 'monthly') meta.push(freqLabel);
            if (b.amount) meta.push(`$${$fmt(b.amount)}`);

            return (
              <div
                key={b.id}
                role="button"
                aria-label={`edit bill ${b.name}`}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setEditingBillId(b.id); }}
                style={{ ...rowStyle, opacity: paid ? 0.55 : 1, cursor: 'pointer' }}
                onClick={() => setEditingBillId(b.id)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: T.text, textDecoration: paid ? 'line-through' : 'none' }}>
                    {b.name}
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: soon ? 'rgba(220,160,100,0.75)' : T.muted, letterSpacing: '0.12em', marginTop: 4 }}>
                    {countdown} · {meta.join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); markPaid(b); }}
                  aria-label={paid ? `unmark ${b.name} as paid` : `mark ${b.name} as paid`}
                  style={{ ...ghostBtn, color: paid ? 'rgba(160,200,150,0.7)' : T.text, marginRight: 6, borderColor: paid ? 'rgba(160,200,150,0.3)' : T.border }}
                >
                  {paid ? '✓ paid' : 'mark paid'}
                </button>
              </div>
            );
          })}
        </section>

        {/* Subscriptions */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
            <div style={labelStyle}>subscriptions{subs.length > 0 ? ` · $${$fmt(subsMonthly)}/mo` : ''}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {subs.length > 0 && <AuditEntryLink onOpen={() => setAuditOpen(true)} />}
              <button type="button" onClick={() => openForm === 'sub' ? cancel() : startDraft('sub')} style={addBtn}>
                {openForm === 'sub' ? '× close' : '+ add'}
              </button>
            </div>
          </div>
          {openForm === 'sub' && (
            <div style={{ display: 'flex', gap: 8, padding: '16px 0', flexWrap: 'wrap' }}>
              <input placeholder="name" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="subscription name" style={{ ...inputStyle, flex: '2 1 200px' }} />
              <input placeholder="$" type="number" value={draft.amount ?? ''} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} aria-label="subscription amount" style={{ ...inputStyle, width: 90 }} />
              <select value={draft.period ?? 'monthly'} onChange={(e) => setDraft({ ...draft, period: e.target.value })} aria-label="billing period" style={{ ...inputStyle, width: 120 }}>
                <option value="monthly">monthly</option>
                <option value="yearly">yearly</option>
              </select>
              <button type="button" onClick={addSub} style={addBtn}>save</button>
            </div>
          )}
          {subs.length === 0 && openForm !== 'sub' && (
            <div style={{ padding: '18px 0', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.muted, fontStyle: 'italic' }}>none. rare.</div>
          )}
          {subs.map((s) => {
            const marked = typeof s.marked_to_cancel_at === 'number';
            const daysMarked = marked ? Math.floor((Date.now() - (s.marked_to_cancel_at as number)) / 86_400_000) : 0;
            const toggleMark = () => {
              const nextMarked = marked ? null : Date.now();
              setSubs(subs.map((x) => (x.id === s.id ? { ...x, marked_to_cancel_at: nextMarked } : x)));
            };
            return (
              <div key={s.id} style={rowStyle}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: T.text }}>{s.name}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.muted, letterSpacing: '0.12em', marginTop: 4 }}>
                    ${$fmt(s.amount)}/{s.period === 'yearly' ? 'yr' : 'mo'}
                    {s.period === 'yearly' ? ` · ≈$${$fmt(s.amount / 12)}/mo` : ''}
                    {marked ? ` · marked ${daysMarked}d` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={toggleMark}
                    aria-label={marked ? 'unmark subscription for cancel' : 'mark subscription for cancel'}
                    style={{ ...ghostBtn, color: marked ? 'rgba(220,160,100,0.85)' : T.muted, borderColor: marked ? 'rgba(220,160,100,0.4)' : T.border, fontSize: 10 }}
                  >
                    {marked ? '✓ marked' : 'mark for cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (marked && !window.confirm(`really remove ${s.name}?`)) return; setSubs(subs.filter((x) => x.id !== s.id)); }}
                    aria-label={`remove subscription ${s.name}`}
                    style={removeBtn}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        {/* Savings goals */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
            <div style={labelStyle}>savings goals</div>
            <button type="button" onClick={() => openForm === 'goal' ? cancel() : startDraft('goal')} style={addBtn}>
              {openForm === 'goal' ? '× close' : '+ add'}
            </button>
          </div>
          {openForm === 'goal' && (
            <div style={{ display: 'flex', gap: 8, padding: '16px 0', flexWrap: 'wrap' }}>
              <input placeholder="what for" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="goal name" style={{ ...inputStyle, flex: '2 1 200px' }} />
              <input placeholder="target $" type="number" value={draft.target ?? ''} onChange={(e) => setDraft({ ...draft, target: e.target.value })} aria-label="goal target" style={{ ...inputStyle, width: 120 }} />
              <input placeholder="saved" type="number" value={draft.saved ?? ''} onChange={(e) => setDraft({ ...draft, saved: e.target.value })} aria-label="amount saved" style={{ ...inputStyle, width: 110 }} />
              <button type="button" onClick={addGoal} style={addBtn}>save</button>
            </div>
          )}
          {goals.length === 0 && openForm !== 'goal' && (
            <div style={{ padding: '18px 0', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.muted, fontStyle: 'italic' }}>no goals yet.</div>
          )}
          {goals.map((g, idx) => {
            const progress = goalProgressList[idx];
            const pct = progress && progress.target > 0 ? Math.min(100, Math.round((progress.saved / progress.target) * 100)) : 0;
            return (
              <div key={g.id} style={{ padding: '18px 0', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: T.text }}>{g.name}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.muted, letterSpacing: '0.12em' }}>
                    ${$fmt(g.saved)} / ${$fmt(g.target)} · {pct}%
                  </div>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${g.name} savings progress`}
                  style={{ height: 2, background: T.border, borderRadius: 1, overflow: 'hidden' }}
                >
                  <div style={{ width: `${pct}%`, height: '100%', background: 'rgba(255,255,255,0.55)', transition: 'width 300ms' }} />
                </div>
                {progress?.pace && (
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: T.faint, marginTop: 8, letterSpacing: '0.12em' }}>
                    ~${$fmt(progress.pace.monthlyContribution)}/mo · {progress.pace.eta ? `eta ${new Date(progress.pace.eta).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }).toLowerCase()}` : 'at this rate'}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => bumpGoal(g.id, 10)} style={ghostBtn}>+$10</button>
                  <button type="button" onClick={() => bumpGoal(g.id, 50)} style={ghostBtn}>+$50</button>
                  <button type="button" onClick={() => bumpGoal(g.id, 100)} style={ghostBtn}>+$100</button>
                  <button type="button" onClick={() => bumpGoal(g.id, -10)} style={{ ...ghostBtn, opacity: 0.5 }}>−$10</button>
                  <button type="button" onClick={() => setGoals(goals.filter((x) => x.id !== g.id))} aria-label={`remove goal ${g.name}`} style={{ ...removeBtn, marginLeft: 'auto' }}>remove</button>
                </div>
              </div>
            );
          })}
        </section>

        {/* ADHD-tax candidate chip — gentle, sparse, one at a time */}
        <ADHDTaxCandidateChip />

        {/* ADHD tax */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
            <div style={labelStyle}>
              adhd tax{taxThisMonth.length > 0 ? ` · $${$fmt(taxMTD)} this month` : ''}
            </div>
            <button type="button" onClick={() => openForm === 'tax' ? cancel() : startDraft('tax')} style={addBtn}>
              {openForm === 'tax' ? '× close' : '+ log'}
            </button>
          </div>
          {/* ADHD tax summary from logic */}
          {adhdTaxSummary.count > 0 && (
            <div style={{ padding: '12px 0', fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.faint, letterSpacing: '0.12em' }}>
              {adhdTaxSummary.count} events · ${$fmt(adhdTaxSummary.total)} total (90 days)
            </div>
          )}
          {openForm === 'tax' && (
            <div style={{ display: 'flex', gap: 8, padding: '16px 0', flexWrap: 'wrap' }}>
              <input placeholder="what was it" value={draft.text ?? ''} onChange={(e) => setDraft({ ...draft, text: e.target.value })} aria-label="adhd tax description" style={{ ...inputStyle, flex: '2 1 200px' }} />
              <input placeholder="$" type="number" value={draft.amount ?? ''} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} aria-label="adhd tax amount" style={{ ...inputStyle, width: 90 }} />
              <button type="button" onClick={addTax} style={addBtn}>save</button>
            </div>
          )}
          {tax.length === 0 && openForm !== 'tax' && (
            <div style={{ padding: '18px 0', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: T.muted, fontStyle: 'italic' }}>none logged.</div>
          )}
          {[...tax].sort((a, b) => b.ts - a.ts).slice(0, 20).map((entry) => (
            <div key={entry.id} style={rowStyle}>
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text }}>{entry.text}</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: T.muted, letterSpacing: '0.12em', marginTop: 4 }}>
                  {entry.amount ? `$${$fmt(entry.amount)} · ` : ''}
                  {new Date(entry.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()}
                </div>
              </div>
              <button type="button" onClick={() => setTax(tax.filter((x) => x.id !== entry.id))} aria-label="remove entry" style={removeBtn}>×</button>
            </div>
          ))}
        </section>

        {/* Sprint 6 · held purchases (impulse pause flow). Resolves to the
            modal on click; auto-presents the modal when a pause was just
            started or its 24h window has lapsed. */}
        {(pendingPauses?.length ?? 0) > 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
              <div style={labelStyle}>held · {pendingPauses.length}</div>
              {(savedByPause?.count ?? 0) > 0 && (
                <div style={{ ...labelStyle, color: T.accent, letterSpacing: '0.18em' }}>
                  saved by pause · ${$fmt(savedByPause?.total ?? 0)} · {savedByPause?.count ?? 0}×
                </div>
              )}
            </div>
            {pendingPauses.map((p) => {
              const expired = p.expires_at <= Date.now();
              const hLeft = Math.max(0, Math.round((p.expires_at - Date.now()) / 3600_000));
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePauseId(p.id)}
                  aria-label={`open held purchase ${p.merchant || p.category}`}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                    padding: '16px 20px',
                    background: T.paper,
                    border: 'none',
                    borderBottom: `1px solid ${T.border}`,
                    cursor: 'pointer',
                    color: T.text,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15 }}>
                    ${$fmt(p.amount)}{p.merchant ? ` · ${p.merchant.toLowerCase()}` : ''} · {p.category}
                  </span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: expired ? T.accent : T.muted, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                    {expired ? 'window passed' : `${hLeft}h left`}
                  </span>
                </button>
              );
            })}
          </section>
        )}
        {(savedByPause?.count ?? 0) > 0 && (pendingPauses?.length ?? 0) === 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{ paddingBottom: 10, borderBottom: `1px solid ${T.border}`, ...labelStyle }}>
              saved by pause
            </div>
            <div style={{ padding: '18px 20px', background: T.paper, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: T.text }}>
              ${$fmt(savedByPause?.total ?? 0)} across {savedByPause?.count ?? 0} pause{savedByPause?.count === 1 ? '' : 's'}. didn't buy.
            </div>
          </section>
        )}

        {/* D3 Canva-style alerts (quiet cards, no push) */}
        <FinanceD3Cards />

        {/* F1 savings tracker (quiet card, passive voice) */}
        <SavingsCard />

        {/* "set aside" ledger — plain record of money tucked away */}
        <SavingsLedger />

        {/* E5 protective chain surface — sleep deprivation, cycle, etc. */}
        <ProtectiveCards />

        {/* Patterns (noticed) */}
        <FinanceNoticed />
      </div>

      {/* Sprint 6 · impulse pause modal. The active pause is whichever id
          is currently held in local state. Closing the modal does NOT
          resolve the pause — it stays pending in the store. */}
      {(() => {
        if (!activePauseId) return null;
        const active = (pendingPauses ?? []).find((p) => p.id === activePauseId);
        if (!active) return null;
        const monthVariable = thisMonthVariableTotal(transactions, Date.now());
        const pct = pctOfVariable(active.amount, monthVariable);
        const similar = findSimilarPurchases(
          transactions,
          { merchant: active.merchant, category: active.category },
          Date.now(),
        );
        return (
          <ImpulsePauseModal
            open
            pause={active}
            variableBudgetPct={pct}
            similar={similar}
            onSkip={(p) => resolvePause(p, 'skipped')}
            onPurchase={(p) => resolvePause(p, 'purchased')}
            onClose={() => setActivePauseId(null)}
          />
        );
      })()}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.08)',
            border: `1px solid ${T.border}`,
            borderRadius: 24,
            padding: '10px 20px',
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            color: T.text,
            letterSpacing: '0.08em',
            zIndex: 30,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          {toast}
        </div>
      )}

      {/* ── responsive ── */}
      <style>{`
        @media (max-width: 640px) {
          .fin-tx-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
