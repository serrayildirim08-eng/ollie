/**
 * @ollie/logic · finance · tax set-aside calculator
 *
 * Money-module gap closure. Pure functions. No tax-advice voice — the
 * calculator returns conservative numbers. UI is responsible for the
 * legal disclaimer ("rough estimate · consult a CPA · not advice").
 *
 * SCOPE — conservative on purpose.
 *   - US: federal flat 22% (single, no deductions) — typical 1099-NEC
 *     contractor falls into the 22% bracket above ~$45k after standard
 *     deduction. Conservative for sub-$45k earners; ~accurate for
 *     middle bands; too low for high earners. We do not attempt
 *     bracket math here — that's a job for the CPA tool, not a
 *     reminder card.
 *   - US state: lookup table for the 10 most common states; fallback
 *     5% for unknown states.
 *   - UK / EU: blended conservative rates.
 *
 * Function shape designed for UI:
 *   { federal, state, selfEmploymentTax, total, suggestedPct }
 *
 * suggestedPct is what the UI shows ("set aside 30% of every invoice").
 * Always rounded up to the next 5%.
 */

// Note: this module is pure logic — it does NOT import @ollie/events
// to keep @ollie/logic free of cross-package runtime deps. The event
// constant FINANCE_TAX_SETASIDE_DUE_EVENT is the contract; the
// registration lives in packages/events/src/registry.ts and the
// orchestrator subscribes there.

// ─── US ───────────────────────────────────────────────────────────────────

export type USState =
  | 'CA' | 'NY' | 'TX' | 'FL' | 'WA' | 'OR' | 'IL' | 'PA' | 'OH' | 'GA'
  | 'NJ' | 'MA' | 'NC' | 'VA' | 'CO' | 'AZ' | 'MI' | 'MD' | 'NV' | 'WY'
  | 'OTHER';

/**
 * Top-10-coverage state-income-tax rates (top marginal, rounded down to
 * the next half-percent for conservatism). Source: state revenue dept
 * sites as of FY2025 — not authoritative tax advice.
 */
const US_STATE_RATES: Record<USState, number> = {
  CA: 0.093,   // 9.3% — covers $66k–$338k bracket
  NY: 0.0685,  // 6.85% — covers $80k–$215k bracket
  TX: 0,       // no income tax
  FL: 0,       // no income tax
  WA: 0,       // no broad income tax
  OR: 0.099,   // 9.9% — top marginal kicks in early
  IL: 0.0495,  // 4.95% flat
  PA: 0.0307,  // 3.07% flat
  OH: 0.0399,  // 3.99%
  GA: 0.0539,  // 5.39%
  // Round 2 — defensible blended rates for less-frequent states
  NJ: 0.0637,
  MA: 0.05,
  NC: 0.0425,
  VA: 0.0575,
  CO: 0.044,
  AZ: 0.025,
  MI: 0.0425,
  MD: 0.0575,
  NV: 0,
  WY: 0,
  OTHER: 0.05, // conservative national-average fallback
};

const US_FEDERAL_RATE_CONSERVATIVE = 0.22; // 22% bracket — see SCOPE note
const US_SE_TAX_RATE = 0.153;              // 15.3% (12.4% SS + 2.9% Medicare)
const US_SE_NET_EARNINGS_FACTOR = 0.9235;  // SE tax applies to 92.35% of net

export interface USSetAsideOpts {
  state?: USState;
  /** When true (default), round suggestedPct up by 5pp for a safety
   *  buffer — the calculator is conservative on purpose. */
  conservative?: boolean;
}

export interface USSetAsideResult {
  federal: number;
  state: number;
  selfEmploymentTax: number;
  total: number;
  /** Rounded percentage to set aside from each invoice. */
  suggestedPct: number;
  /** Echo of which state was used (for the UI label). */
  stateCode: USState;
}

/**
 * calculateUSSelfEmployedSetAside — conservative 1099 / Schedule C
 * tax estimate. NOT tax advice. UI must surface a disclaimer.
 */
export function calculateUSSelfEmployedSetAside(
  income: number,
  opts?: USSetAsideOpts,
): USSetAsideResult {
  const o = opts ?? {};
  const stateCode: USState = o.state ?? 'OTHER';
  const conservative = o.conservative !== false; // default true

  const safeIncome = Math.max(0, income || 0);

  const federal = safeIncome * US_FEDERAL_RATE_CONSERVATIVE;
  const stateRate = US_STATE_RATES[stateCode] ?? US_STATE_RATES.OTHER;
  const state = safeIncome * stateRate;

  // SE tax applies to 92.35% of net self-employment earnings.
  // Half is deductible from federal income tax — we DON'T model that
  // here because deductions inflate the "I have money" feeling and the
  // calculator's job is to err high.
  const selfEmploymentTax = safeIncome * US_SE_NET_EARNINGS_FACTOR * US_SE_TAX_RATE;

  const total = federal + state + selfEmploymentTax;
  const rawPct = safeIncome > 0 ? total / safeIncome : 0;

  // Round up to nearest 5% when conservative; nearest 1% otherwise.
  const step = conservative ? 0.05 : 0.01;
  const suggestedPct = Math.min(1, Math.ceil(rawPct / step) * step);

  return {
    federal: round2(federal),
    state: round2(state),
    selfEmploymentTax: round2(selfEmploymentTax),
    total: round2(total),
    suggestedPct: Number(suggestedPct.toFixed(2)),
    stateCode,
  };
}

// ─── UK ───────────────────────────────────────────────────────────────────

// UK self-employed FY2024/25 figures. Rounded for a conservative shape.
const UK_PERSONAL_ALLOWANCE = 12_570;
const UK_BASIC_RATE_THRESHOLD = 50_270;
const UK_HIGHER_RATE_THRESHOLD = 125_140;
const UK_BASIC_RATE = 0.20;
const UK_HIGHER_RATE = 0.40;
const UK_ADDITIONAL_RATE = 0.45;

// National Insurance Class 2 + Class 4 (combined Class 4 rate 6% on
// profits 12,570–50,270, then 2% above — we use Class 4 only; Class 2
// was effectively abolished from April 2024 for most. We keep a flat
// £180/yr placeholder for callers who need it — included in total.)
const UK_NI_CLASS_2_FLAT = 180;
const UK_NI_CLASS_4_LOWER = 0.06;
const UK_NI_CLASS_4_UPPER = 0.02;

export interface UKSetAsideResult {
  incomeTax: number;
  ni: number;
  total: number;
  suggestedPct: number;
}

/**
 * calculateUKSelfEmployedSetAside — UK Self Assessment estimate.
 * Combines income tax (with personal allowance) and Class 2/4 NI.
 */
export function calculateUKSelfEmployedSetAside(income: number): UKSetAsideResult {
  const safeIncome = Math.max(0, income || 0);

  // Income tax with personal allowance taper above £100k (simplified
  // — full taper is £1 off allowance per £2 above £100k).
  let allowance = UK_PERSONAL_ALLOWANCE;
  if (safeIncome > 100_000) {
    allowance = Math.max(0, allowance - (safeIncome - 100_000) / 2);
  }

  const taxable = Math.max(0, safeIncome - allowance);
  let incomeTax: number;
  if (taxable <= UK_BASIC_RATE_THRESHOLD - UK_PERSONAL_ALLOWANCE) {
    incomeTax = taxable * UK_BASIC_RATE;
  } else if (taxable <= UK_HIGHER_RATE_THRESHOLD - UK_PERSONAL_ALLOWANCE) {
    const basicBand = UK_BASIC_RATE_THRESHOLD - UK_PERSONAL_ALLOWANCE;
    incomeTax = basicBand * UK_BASIC_RATE + (taxable - basicBand) * UK_HIGHER_RATE;
  } else {
    const basicBand = UK_BASIC_RATE_THRESHOLD - UK_PERSONAL_ALLOWANCE;
    const higherBand = UK_HIGHER_RATE_THRESHOLD - UK_PERSONAL_ALLOWANCE - basicBand;
    incomeTax =
      basicBand * UK_BASIC_RATE +
      higherBand * UK_HIGHER_RATE +
      (taxable - basicBand - higherBand) * UK_ADDITIONAL_RATE;
  }

  // NI Class 4: lower-band on profits 12,570–50,270, upper-band above.
  let ni = UK_NI_CLASS_2_FLAT; // placeholder flat
  if (safeIncome > UK_PERSONAL_ALLOWANCE) {
    const profitOverAllowance = safeIncome - UK_PERSONAL_ALLOWANCE;
    if (safeIncome <= UK_BASIC_RATE_THRESHOLD) {
      ni += profitOverAllowance * UK_NI_CLASS_4_LOWER;
    } else {
      const lowerBand = UK_BASIC_RATE_THRESHOLD - UK_PERSONAL_ALLOWANCE;
      ni +=
        lowerBand * UK_NI_CLASS_4_LOWER +
        (safeIncome - UK_BASIC_RATE_THRESHOLD) * UK_NI_CLASS_4_UPPER;
    }
  }

  const total = incomeTax + ni;
  const rawPct = safeIncome > 0 ? total / safeIncome : 0;
  const suggestedPct = Math.min(1, Math.ceil(rawPct / 0.05) * 0.05);

  return {
    incomeTax: round2(incomeTax),
    ni: round2(ni),
    total: round2(total),
    suggestedPct: Number(suggestedPct.toFixed(2)),
  };
}

// ─── EU ───────────────────────────────────────────────────────────────────

export type EUCountry = 'DE' | 'FR' | 'NL' | 'ES' | 'IT';

/**
 * Conservative blended freelancer rates per country. These are
 * intentionally rough — actual rates depend on social-security
 * regime (DE: KSK vs gesetzlich; FR: micro-entreprise vs réel; NL:
 * ZZP vs BV; ES: autónomo brackets; IT: regime forfettario). The
 * calculator's role is to suggest a set-aside %, not to file taxes.
 */
const EU_BLENDED_RATES: Record<EUCountry, number> = {
  DE: 0.42, // income tax + KV + RV + PV; conservative for solo freelancers
  FR: 0.45, // impôt + cotisations sociales (URSSAF) — high social burden
  NL: 0.37, // box 1 + ZVW
  ES: 0.40, // IRPF + cuota de autónomo
  IT: 0.38, // IRPEF + INPS
};

export interface EUSetAsideResult {
  country: EUCountry;
  total: number;
  suggestedPct: number;
  blendedRate: number;
}

export function calculateEUFreelancerSetAside(
  income: number,
  country: EUCountry,
): EUSetAsideResult {
  const safeIncome = Math.max(0, income || 0);
  const rate = EU_BLENDED_RATES[country];
  if (rate == null) {
    throw new Error(`calculateEUFreelancerSetAside: unknown country ${String(country)}`);
  }
  const total = safeIncome * rate;
  const suggestedPct = Math.min(1, Math.ceil(rate / 0.05) * 0.05);
  return {
    country,
    total: round2(total),
    suggestedPct: Number(suggestedPct.toFixed(2)),
    blendedRate: rate,
  };
}

// ─── Reminder ─────────────────────────────────────────────────────────────

export type TaxCalculator =
  | { kind: 'us'; opts?: USSetAsideOpts }
  | { kind: 'uk' }
  | { kind: 'eu'; country: EUCountry };

export interface MonthlySetAsideReminder {
  amount: number;
  message: string;
}

/**
 * monthlySetAsideReminder — turns this-month income into a "set aside
 * $X" amount + lower-case factual copy. UI may emit
 * 'finance:tax_setaside_due' carrying this payload.
 *
 * Copy contract:
 *   - lowercase, factual, no exclamation, no cheerleading
 *   - never includes the word "should"; uses "for tax" or "tax buffer"
 */
export function monthlySetAsideReminder(
  thisMonthIncome: number,
  calculator: TaxCalculator,
): MonthlySetAsideReminder {
  const income = Math.max(0, thisMonthIncome || 0);
  let pct = 0;

  if (calculator.kind === 'us') {
    const r = calculateUSSelfEmployedSetAside(income, calculator.opts);
    pct = r.suggestedPct;
  } else if (calculator.kind === 'uk') {
    const r = calculateUKSelfEmployedSetAside(income);
    pct = r.suggestedPct;
  } else if (calculator.kind === 'eu') {
    const r = calculateEUFreelancerSetAside(income, calculator.country);
    pct = r.suggestedPct;
  }

  // Use suggestedPct on income rather than `total` so the user-facing
  // number matches what the UI told them ("set aside 30%").
  const amount = Number((income * pct).toFixed(2));
  const pctLabel = Math.round(pct * 100);
  const message = `tax buffer for this month: ${amount.toFixed(2)} (${pctLabel}% of income).`;

  return { amount, message };
}

/**
 * Event name for the orchestrator wire. Registration lives in
 * packages/events/src/registry.ts; callers import this constant rather
 * than stringly-typing the event name.
 */
export const FINANCE_TAX_SETASIDE_DUE_EVENT = 'finance:tax_setaside_due' as const;

export interface FinanceTaxSetAsideDuePayload {
  amount: number;
  month_start: number;
  suggested_pct: number;
  message: string;
  ts: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Number(n.toFixed(2));
}
