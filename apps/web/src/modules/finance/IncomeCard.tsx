/**
 * IncomeCard · variable-income surface
 *
 * Surfaces classifyPayFrequencyDetailed + monthlyVolatility from
 * @ollie/logic/finance/income-detection. Pure consumer of the logic —
 * no computation in the view. Renders nothing when inbound records are
 * sparse (< 2 calendar months of data). Delta is signed and colour-
 * coded but restrained (muted sage / dusty terracotta), never red/green.
 *
 * Card title: "income" when no useful frequency signal, "income · variable"
 * when delta exceeds ±20% so the variability has somewhere to live.
 *
 * Lives in its own file (not inline in FinanceModule) so the vitest
 * suite can import it without dragging the whole module's store-singleton
 * import graph through the test environment.
 *
 * i18n: strings.en/es.json finance.income.*
 */

import React, { useMemo } from 'react';
import {
  classifyPayFrequencyDetailed,
  monthlyVolatility,
} from '@ollie/logic/finance';
import type {
  FinanceRecord,
  ClassifyPayFrequencyResult,
  MonthlyVolatilityResult,
} from '@ollie/logic/finance';
import { useStoreSlice } from '../../store';
import { getString, type Locale } from '../../i18n';

// ─── palette tokens (matches FinanceModule.tsx top — keep in sync) ──────────

const T = {
  text:   'rgba(255,255,255,0.88)',
  muted:  'rgba(255,255,255,0.48)',
  faint:  'rgba(255,255,255,0.28)',
  border: 'rgba(255,255,255,0.08)',
  paper:  'rgba(255,255,255,0.03)',
} as const;

const labelStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 9,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: T.muted,
};

// Muted hues, restrained — sit next to the gold accent without screaming.
const INCOME_DELTA_POS = 'rgba(170, 195, 165, 0.78)'; // muted sage
const INCOME_DELTA_NEG = 'rgba(220, 160, 100, 0.78)'; // dusty terracotta — reuses the "soon" hue already used in FinanceModule

function incomeMonthsOfData(records: FinanceRecord[]): number {
  const months = new Set<string>();
  for (const r of records) {
    if (r?.direction === 'in' && r.event_date) {
      months.add(r.event_date.slice(0, 7));
    }
  }
  return months.size;
}

function formatDeltaPct(deltaPct: number): { text: string; positive: boolean; magnitude: number } {
  const pct = Math.round(deltaPct * 100);
  const magnitude = Math.abs(pct);
  // Treat the zero-three-month-avg case (deltaPct === 0) as "no signal" upstream.
  const positive = pct >= 0;
  const sign = positive ? '+' : '-';
  return { text: `${sign}${magnitude}%`, positive, magnitude };
}

export interface IncomeCardProps {
  records: FinanceRecord[];
  now: number;
  masked: boolean;
  $fmt: (n: number | null | undefined) => string;
}

export function IncomeCard({ records, now, masked, $fmt }: IncomeCardProps) {
  const [sharedSettings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const localeRaw = sharedSettings?.locale ?? 'en';
  const locale: Locale = localeRaw === 'es' ? 'es' : 'en';

  const freq: ClassifyPayFrequencyResult = useMemo(
    () => classifyPayFrequencyDetailed(records ?? []),
    [records],
  );
  const vol: MonthlyVolatilityResult = useMemo(
    () => monthlyVolatility(records ?? [], now),
    [records, now],
  );
  const monthsOfData = useMemo(() => incomeMonthsOfData(records ?? []), [records]);

  // Sparse-data guard: silent absence, no empty state copy.
  const inboundCount = useMemo(
    () => (records ?? []).filter((r) => r?.direction === 'in').length,
    [records],
  );
  if (inboundCount === 0 || monthsOfData < 2) return null;

  const delta = formatDeltaPct(vol.deltaPct);
  // A delta only renders when there's at least some trailing average to
  // contrast against — otherwise the percentage is mathematically null.
  const haveDelta = vol.threeMonthAvg > 0;
  const isVariable = haveDelta && delta.magnitude > 20;
  const title = isVariable
    ? getString(locale, 'finance.income.title_variable')
    : getString(locale, 'finance.income.title');

  // Frequency badge — drop the badge entirely when 'random' has no signal
  // (n_events < 3); the subtitle carries the irregular framing instead.
  const showFreqBadge = freq.evidence.n_events >= 3;
  const showConfidencePip =
    showFreqBadge && freq.frequency !== 'random' && freq.confidence !== 'high';

  // Subtitle: one editorial line, optional.
  let subtitle: string | null = null;
  if (freq.frequency === 'random' && freq.evidence.n_events >= 3) {
    subtitle = getString(locale, 'finance.income.subtitle_irregular');
  } else if (isVariable && freq.frequency !== 'random') {
    subtitle = getString(locale, 'finance.income.subtitle_variable', { 0: freq.frequency });
  }

  const deltaColor = delta.positive ? INCOME_DELTA_POS : INCOME_DELTA_NEG;

  return (
    <section style={{ marginBottom: 48 }} aria-labelledby="income-card-title">
      <div
        id="income-card-title"
        style={{
          paddingBottom: 10,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          ...labelStyle,
        }}
      >
        <span>{title}</span>
        {showFreqBadge && (
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.faint,
              border: `1px solid ${T.border}`,
              borderRadius: 3,
              padding: '2px 6px',
            }}
            aria-label={`pay frequency ${freq.frequency}`}
          >
            {freq.frequency}
          </span>
        )}
        {showConfidencePip && (
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9,
              letterSpacing: '0.14em',
              color: T.faint,
              opacity: 0.7,
            }}
            aria-label={`confidence ${freq.confidence}`}
          >
            · {freq.confidence}
          </span>
        )}
      </div>

      <div
        style={{
          padding: '20px 20px 18px',
          background: T.paper,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: T.muted,
            }}
          >
            {getString(locale, 'finance.income.this_month')}
          </span>
          <span
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 32,
              lineHeight: 1,
              color: T.text,
            }}
            aria-label={masked ? 'this month masked' : `this month ${vol.thisMonth} dollars`}
          >
            ${$fmt(vol.thisMonth)}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: T.muted,
            }}
          >
            {getString(locale, 'finance.income.average_3mo')}
          </span>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 14,
              color: T.text,
              letterSpacing: '0.04em',
            }}
            aria-label={masked ? 'average masked' : `three month average ${vol.threeMonthAvg} dollars`}
          >
            ${$fmt(vol.threeMonthAvg)}
          </span>
        </div>

        {haveDelta && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: T.muted,
              }}
            >
              {getString(locale, 'finance.income.delta')}
            </span>
            <span
              data-testid="income-delta"
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                color: deltaColor,
                letterSpacing: '0.08em',
              }}
              aria-label={`delta ${delta.text} versus three month average`}
            >
              {delta.text}
            </span>
          </div>
        )}

        {subtitle && (
          <div
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 12,
              fontStyle: 'italic',
              color: T.faint,
              lineHeight: 1.5,
              paddingTop: 4,
              maxWidth: 420,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </section>
  );
}
