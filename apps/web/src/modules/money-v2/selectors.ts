/**
 * money-v2 · selectors — the real-data bridge
 *
 * Pure functions that turn the EXISTING `finance.*` store slices into the
 * view-model the v2 money screens render. No store reads, no DOM, no
 * wall-clock — `now` is always passed in. This is the only place the v2
 * UI touches the finance data shape, so the live finance module's store
 * keys stay the single source of truth.
 *
 * The redesign is a UI rebuild: this file reuses the live finance pure
 * fns (`safeToSpend`, `detectRecurring`, `upcomingBills`,
 * `savingsGoalProgress`, `trackADHDTaxEvents`, `classifyPayFrequency`,
 * `calculateUSSelfEmployedSetAside`) — exactly what FinanceModule.tsx
 * computes — and reads exactly the slices FinanceModule.tsx writes.
 */
import {
  safeToSpend,
  savingsGoalProgress,
  trackADHDTaxEvents,
  classifyPayFrequency,
  calculateUSSelfEmployedSetAside,
} from '@ollie/logic/finance';
import type {
  FinanceRecord,
  FinanceSettings,
  SpendBand,
  ADHDTaxSummary,
} from '@ollie/logic/finance';

// ─── stored slice shapes (mirror FinanceModule.tsx) ──────────────────────────

export interface StoredBill {
  id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  dueDay: number;
  anchorMonth?: number | null;
  ts: number;
}

export interface StoredSub {
  id: string;
  name: string;
  amount: number;
  period: 'monthly' | 'yearly';
  marked_to_cancel_at?: number | null;
  ts: number;
}

export interface StoredGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  contributions?: Array<{ amount?: number; ts?: number }>;
  ts: number;
}

export interface StoredTax {
  id: string;
  text: string;
  amount: number;
  ts: number;
  adhd_tax_type?: string | null;
}

export interface PrivacyState {
  enabled: boolean;
  unlockedUntil: number;
}

/** the complete set of finance slices the v2 money module consumes */
export interface FinanceSlices {
  records: FinanceRecord[];
  bills: StoredBill[];
  subscriptions: StoredSub[];
  goals: StoredGoal[];
  adhd_tax: StoredTax[];
  settings: FinanceSettings;
  privacy: PrivacyState;
  /** orchestrator-derived band, if present; else recomputed */
  safeToSpend: SpendBand | null;
}

const DAY_MS = 86_400_000;

// ─── small format helpers ────────────────────────────────────────────────────

export function fmtMoney(n: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    Math.round(n ?? 0),
  );
}

/** "$3.2k" style compact for income */
export function fmtCompact(n: number): { value: string; unit: string } {
  if (Math.abs(n) >= 1000) {
    return { value: (n / 1000).toFixed(1).replace(/\.0$/, ''), unit: 'k' };
  }
  return { value: String(Math.round(n)), unit: '' };
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** a calm relative date label: "fri" within a week, else "may 24" */
export function fmtWhen(dueAt: number, now: number): string {
  const days = Math.round((dueAt - now) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  const d = new Date(dueAt);
  if (days < 7) return WEEKDAYS[d.getDay()];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ─── privacy ─────────────────────────────────────────────────────────────────

/** true when figures should be masked right now */
export function isMasked(privacy: PrivacyState | null | undefined, now: number): boolean {
  if (!privacy?.enabled) return false;
  return (privacy.unlockedUntil ?? 0) <= now;
}

// ─── bills ───────────────────────────────────────────────────────────────────

export interface NextBill {
  id: string;
  name: string;
  amount: number;
  dueAt: number;
  daysUntil: number;
}

/** next-due date for a StoredBill — ported from FinanceModule.nextDueDate */
export function nextDueDate(b: StoredBill, now: number): number {
  const nowDate = new Date(now);
  const freq = b.frequency ?? 'monthly';
  const dueDay = Math.max(1, +b.dueDay || 1);
  const anchorMonth = Math.min(12, Math.max(1, +(b.anchorMonth ?? 1) || 1));
  const y = nowDate.getFullYear();
  const m = nowDate.getMonth();
  const today = nowDate.getDate();
  const todayD = new Date(y, m, today).getTime();
  const dimOf = (yr: number, mo: number) => new Date(yr, mo + 1, 0).getDate();
  const clamp = (d: number, yr: number, mo: number) =>
    Math.min(Math.max(d, 1), dimOf(yr, mo));

  if (freq === 'yearly') {
    const am = anchorMonth - 1;
    const thisY = new Date(y, am, clamp(dueDay, y, am)).getTime();
    if (thisY >= todayD) return thisY;
    return new Date(y + 1, am, clamp(dueDay, y + 1, am)).getTime();
  }
  if (freq === 'quarterly') {
    const anchorRem = (anchorMonth - 1) % 3;
    for (let i = 0; i < 6; i++) {
      const tm = m + i;
      if (tm % 3 === anchorRem) {
        const ty = y + Math.floor(tm / 12);
        const tmn = ((tm % 12) + 12) % 12;
        const cand = new Date(ty, tmn, clamp(dueDay, ty, tmn)).getTime();
        if (cand >= todayD) return cand;
      }
    }
  }
  const thisMonth = new Date(y, m, clamp(dueDay, y, m)).getTime();
  if (thisMonth >= todayD) return thisMonth;
  return new Date(y, m + 1, clamp(dueDay, y, m + 1)).getTime();
}

/** all stored bills, soonest-first, with a computed next-due */
export function upcomingBillRows(bills: StoredBill[], now: number): NextBill[] {
  return (bills ?? [])
    .map((b) => {
      const dueAt = nextDueDate(b, now);
      return {
        id: b.id,
        name: b.name,
        amount: b.amount,
        dueAt,
        daysUntil: Math.round((dueAt - now) / DAY_MS),
      };
    })
    .sort((a, b) => a.dueAt - b.dueAt);
}

// ─── safe-to-spend ───────────────────────────────────────────────────────────

export interface SafeToSpendVM {
  /** the band central value, rounded; null when cold-start / no signal */
  amount: number | null;
  /** true when ollie still doesn't have enough to compute */
  coldStart: boolean;
  /** the band horizon in days */
  horizonDays: number;
  /** 0..1 fill for the horizon bar — fraction of horizon elapsed */
  horizonFill: number;
  /** "11 days left" style copy */
  daysLeftLabel: string;
}

export function safeToSpendVM(slices: FinanceSlices, now: number): SafeToSpendVM {
  const band: SpendBand | null =
    slices.safeToSpend ?? safeToSpend(slices.records ?? [], now, 7, slices.settings ?? {});
  // a null band = ollie has no income/outflow signal at all → cold start
  if (!band) {
    return {
      amount: null,
      coldStart: true,
      horizonDays: 7,
      horizonFill: 0,
      daysLeftLabel: 'a few more weeks of data',
    };
  }
  const coldStart = band.cold_start || typeof band.central !== 'number';
  const horizonDays = band.horizonDays || 7;
  // fraction of the horizon already elapsed since the most recent income
  const incomes = (slices.records ?? [])
    .filter((r) => r.direction === 'in' && r.event_date)
    .map((r) => new Date(r.event_date + 'T00:00:00Z').getTime())
    .sort((a, b) => b - a);
  const lastIncome = incomes[0] ?? now;
  const elapsed = Math.max(0, Math.min(horizonDays, (now - lastIncome) / DAY_MS));
  const left = Math.max(0, horizonDays - elapsed);
  return {
    amount: coldStart ? null : Math.round(band.central),
    coldStart,
    horizonDays,
    horizonFill: horizonDays > 0 ? elapsed / horizonDays : 0,
    daysLeftLabel:
      left >= 1 ? `${Math.round(left)} days left` : 'a fresh window soon',
  };
}

// ─── income ──────────────────────────────────────────────────────────────────

export interface IncomeVM {
  /** typical monthly income */
  monthly: number;
  /** a one-word shape: "irregular", "monthly"… */
  shape: string;
  /** 6-month bars, oldest→newest, each { label, total, fraction 0..1 } */
  band: Array<{ label: string; total: number; fraction: number }>;
  quietMonth: number;
  goodMonth: number;
  /** last income record */
  lastLanded: { amount: number; daysAgo: number } | null;
  /** false when there isn't enough income data */
  haveSignal: boolean;
}

export function incomeVM(records: FinanceRecord[], now: number): IncomeVM {
  const incomes = (records ?? [])
    .filter((r) => r.direction === 'in' && r.amount != null && r.event_date)
    .map((r) => ({
      amount: r.amount as number,
      t: new Date(r.event_date + 'T00:00:00Z').getTime(),
    }))
    .sort((a, b) => a.t - b.t);

  const freq = classifyPayFrequency(
    records.filter((r) => r.direction === 'in'),
    now,
  );

  // bucket the last 6 calendar months
  const buckets: Array<{ label: string; total: number }> = [];
  const ref = new Date(now);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    buckets.push({ label: MONTHS[d.getMonth()], total: 0 });
  }
  for (const inc of incomes) {
    const d = new Date(inc.t);
    const idx =
      5 - (ref.getFullYear() * 12 + ref.getMonth() - (d.getFullYear() * 12 + d.getMonth()));
    if (idx >= 0 && idx < 6) buckets[idx].total += inc.amount;
  }
  const totals = buckets.map((b) => b.total).filter((t) => t > 0);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const sorted = [...totals].sort((a, b) => a - b);
  const monthly = totals.length
    ? Math.round(sorted[Math.floor(sorted.length / 2)])
    : 0;

  const last = incomes[incomes.length - 1] ?? null;

  return {
    monthly,
    shape: freq.freq === 'cold_start' ? 'still learning' : freq.freq,
    band: buckets.map((b) => ({
      label: b.label,
      total: b.total,
      fraction: b.total / max,
    })),
    quietMonth: sorted.length ? Math.round(sorted[0]) : 0,
    goodMonth: sorted.length ? Math.round(sorted[sorted.length - 1]) : 0,
    lastLanded: last
      ? { amount: Math.round(last.amount), daysAgo: Math.round((now - last.t) / DAY_MS) }
      : null,
    haveSignal: totals.length >= 1,
  };
}

// ─── subscriptions (the audit) ───────────────────────────────────────────────

export interface SubAuditCard {
  id: string;
  name: string;
  /** "$15 / mo" */
  priceLabel: string;
  /** the calm sage observation */
  observation: string;
  /** whether it looks dormant (mentioned in the audit) */
  dormant: boolean;
}

/**
 * Build the subscription-audit deck. Dormancy here is a light heuristic:
 * a sub with no matching out-record in 6 weeks under its merchant name is
 * "not in your words" — same spirit as the live AuditSubscriptions, kept
 * deliberately simple for the preview. The full dormancy scorer
 * (`scoreDormancy`) needs decrypted brain-dumps which the preview route
 * does not wire.
 */
export function subscriptionAudit(
  subs: StoredSub[],
  records: FinanceRecord[],
  now: number,
): SubAuditCard[] {
  const sixWeeks = now - 42 * DAY_MS;
  return (subs ?? []).map((s) => {
    const monthly = s.period === 'yearly' ? s.amount / 12 : s.amount;
    const mentioned = (records ?? []).some(
      (r) =>
        (r.merchant ?? '').toLowerCase().includes(s.name.toLowerCase()) &&
        new Date((r.event_date ?? '') + 'T00:00:00Z').getTime() >= sixWeeks,
    );
    const dormant = !mentioned;
    return {
      id: s.id,
      name: s.name,
      priceLabel: `$${fmtMoney(monthly)} / mo`,
      observation: dormant
        ? 'not in your words for 6 weeks. still paid each month.'
        : 'used recently — looks like one you want.',
      dormant,
    };
  });
}

/** count of subs that look dormant — the glance line on the money face */
export function dormantCount(subs: StoredSub[], records: FinanceRecord[], now: number): number {
  return subscriptionAudit(subs, records, now).filter((s) => s.dormant).length;
}

// ─── savings ─────────────────────────────────────────────────────────────────

export interface SavingsVM {
  goalName: string;
  saved: number;
  target: number;
  /** 0..1 */
  fill: number;
  /** "~$55 a month · on track for october" — null when no pace */
  paceLabel: string | null;
  haveGoal: boolean;
}

export function savingsVM(goals: StoredGoal[], records: FinanceRecord[], now: number): SavingsVM {
  const g = (goals ?? [])[0];
  if (!g) {
    return { goalName: '', saved: 0, target: 0, fill: 0, paceLabel: null, haveGoal: false };
  }
  const prog = savingsGoalProgress(
    { target: g.target, saved: g.saved, contributions: g.contributions ?? [] },
    records,
    now,
  );
  const saved = prog?.saved ?? g.saved ?? 0;
  const target = prog?.target ?? g.target ?? 0;
  let paceLabel: string | null = null;
  if (prog?.pace && prog.pace.monthlyContribution > 0) {
    const monthly = Math.round(prog.pace.monthlyContribution);
    if (prog.pace.eta) {
      paceLabel = `~$${fmtMoney(monthly)} a month · on track for ${MONTHS[new Date(prog.pace.eta).getMonth()]}`;
    } else {
      paceLabel = `~$${fmtMoney(monthly)} a month`;
    }
  }
  return {
    goalName: g.name,
    saved,
    target,
    fill: target > 0 ? saved / target : 0,
    paceLabel,
    haveGoal: true,
  };
}

// ─── adhd tax ────────────────────────────────────────────────────────────────

export interface AdhdTaxVM {
  /** total cost this calendar month */
  total: number;
  /** "may, so far" */
  monthLabel: string;
  /** the breakdown rows */
  rows: Array<{ id: string; what: string; cost: number }>;
}

export function adhdTaxVM(
  records: FinanceRecord[],
  stored: StoredTax[],
  now: number,
): AdhdTaxVM {
  const ref = new Date(now);
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1).getTime();

  // records flagged is_adhd_tax this month, via the live trackADHDTaxEvents
  const summary: ADHDTaxSummary = trackADHDTaxEvents(records ?? [], 90, now);
  void summary; // summary is the 90-day rollup; the face shows this-month only

  const fromRecords = (records ?? [])
    .filter(
      (r) =>
        r.is_adhd_tax &&
        r.amount != null &&
        new Date((r.event_date ?? '') + 'T00:00:00Z').getTime() >= monthStart,
    )
    .map((r) => ({
      id: r.id ?? `rec-${r.event_date}-${r.amount}`,
      what: r.notes || r.merchant || 'an adhd-tax spend',
      cost: Math.abs(r.amount as number),
    }));

  const fromStored = (stored ?? [])
    .filter((t) => t.ts >= monthStart)
    .map((t) => ({ id: t.id, what: t.text, cost: t.amount }));

  const rows = [...fromRecords, ...fromStored];
  const total = rows.reduce((s, r) => s + r.cost, 0);

  return {
    total: Math.round(total),
    monthLabel: `${MONTHS[ref.getMonth()]}, so far`,
    rows,
  };
}

// ─── tax set-aside ───────────────────────────────────────────────────────────

export interface TaxSetAsideVM {
  /** the income amount the set-aside is computed from */
  landedIncome: number;
  /** the suggested amount to set aside */
  setAside: number;
  /** the suggested percentage, 0..1 */
  pct: number;
  jurisdiction: string;
  haveIncome: boolean;
}

/**
 * The tax set-aside view-model. `now` is accepted for signature parity
 * with the other VM selectors (and future cutoff filtering) — the current
 * calc keys off the most-recent income record, not wall-clock.
 */
export function taxSetAsideVM(records: FinanceRecord[], now: number): TaxSetAsideVM {
  void now;
  const incomes = (records ?? [])
    .filter((r) => r.direction === 'in' && r.amount != null && r.event_date)
    .map((r) => ({
      amount: r.amount as number,
      t: new Date(r.event_date + 'T00:00:00Z').getTime(),
    }))
    .sort((a, b) => b.t - a.t);
  const last = incomes[0];
  const income = last ? last.amount : 0;
  const res = calculateUSSelfEmployedSetAside(income, { conservative: true });
  return {
    landedIncome: Math.round(income),
    setAside: Math.round(res.total),
    pct: res.suggestedPct,
    jurisdiction: 'united states',
    haveIncome: Boolean(last),
  };
}

// ─── the money face glance lines ─────────────────────────────────────────────

/** does the user have ANY finance data — drives the empty-state face */
export function hasAnyFinanceData(slices: FinanceSlices): boolean {
  return (
    (slices.records ?? []).length > 0 ||
    (slices.bills ?? []).length > 0 ||
    (slices.subscriptions ?? []).length > 0 ||
    (slices.goals ?? []).length > 0 ||
    (slices.adhd_tax ?? []).length > 0
  );
}
