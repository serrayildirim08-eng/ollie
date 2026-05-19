/**
 * money-v2 · IncomeScreen — Level 3 detail (money-income.html)
 *
 * One thing: the variable-income picture, stated calmly. A freelancer's
 * panic comes from "I don't know what I make" — this answers it in one
 * sentence + a quiet 6-month band.
 *
 * Real data: `incomeVM` over `finance.records` (income-direction records),
 * using the live `classifyPayFrequency` pure fn for the shape word.
 */
import { useMemo } from 'react';
import { Screen, IconTrendUp, v2 } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { incomeVM, fmtCompact, fmtMoney } from '../selectors';

export interface IncomeScreenProps {
  now: number;
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
}

export function IncomeScreen({ now, onBack, onFind, onSafe }: IncomeScreenProps) {
  void onBack;
  const slices = useFinanceSlices();
  const income = useMemo(() => incomeVM(slices.records, now), [slices.records, now]);
  const monthly = fmtCompact(income.monthly);

  return (
    <Screen
      label="income"
      glyph={<IconTrendUp stroke={v2.accent} />}
      onFind={onFind}
      onSafe={onSafe}
      centered
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: 320,
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
          you make, on a normal month
        </div>

        {income.haveSignal ? (
          <>
            <div
              style={{
                marginTop: 8,
                fontSize: 62,
                fontWeight: 300,
                color: v2.ink,
                letterSpacing: '-0.035em',
                lineHeight: 1,
                display: 'flex',
                alignItems: 'baseline',
              }}
            >
              <span style={{ color: v2.mute, fontWeight: 300 }}>~$</span>
              {monthly.value}
              {monthly.unit && (
                <span style={{ color: v2.mute, fontWeight: 300, fontSize: 26, marginLeft: 1 }}>
                  {monthly.unit}
                </span>
              )}
            </div>
            <div
              style={{
                marginTop: 13,
                fontSize: 14,
                color: v2.sage,
                fontWeight: 600,
                letterSpacing: '0.01em',
              }}
            >
              {income.shape}
            </div>

            {/* the 6-month band — bars, no axis, no grid */}
            <div
              style={{
                marginTop: 42,
                width: '100%',
                display: 'flex',
                alignItems: 'flex-end',
                gap: 11,
                height: 96,
              }}
            >
              {income.band.map((b, i) => (
                <div
                  key={b.label + i}
                  style={{
                    flex: 1,
                    background: i === income.band.length - 1 ? v2.accent : v2.line,
                    borderRadius: 5,
                    height: `${Math.max(8, b.fraction * 100)}%`,
                  }}
                  aria-hidden
                />
              ))}
            </div>
            <div style={{ marginTop: 10, width: '100%', display: 'flex', gap: 11 }}>
              {income.band.map((b, i) => (
                <span
                  key={b.label + i}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    fontSize: 11,
                    color: v2.mute,
                    fontWeight: 500,
                  }}
                >
                  {b.label}
                </span>
              ))}
            </div>

            <div
              style={{
                marginTop: 30,
                width: '100%',
                borderTop: `1px solid ${v2.line}`,
                paddingTop: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
              }}
            >
              <Fact k="a quiet month" v={`~$${fmtMoney(income.quietMonth)}`} />
              <Fact k="a good month" v={`~$${fmtMoney(income.goodMonth)}`} />
              <Fact
                k="last landed"
                v={
                  income.lastLanded
                    ? `$${fmtMoney(income.lastLanded.amount)} · ${income.lastLanded.daysAgo}d ago`
                    : '—'
                }
              />
            </div>
          </>
        ) : (
          <div
            style={{
              marginTop: 18,
              fontSize: 17,
              color: v2.mute,
              fontWeight: 400,
              textAlign: 'center',
              lineHeight: 1.5,
              maxWidth: 248,
            }}
          >
            ollie hasn&apos;t seen income land yet. it watches this on its own — nothing to do.
          </div>
        )}
      </div>
    </Screen>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        fontSize: 13,
      }}
    >
      <span style={{ color: v2.mute, fontWeight: 500 }}>{k}</span>
      <span style={{ color: v2.ink, fontWeight: 600 }}>{v}</span>
    </div>
  );
}
