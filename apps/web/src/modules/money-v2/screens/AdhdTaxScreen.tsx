/**
 * money-v2 · AdhdTaxScreen — Level 3 detail (money-adhdtax.html)
 *
 * One thing: what ADHD cost this month. FLAT, informational. The big
 * number is INK — not red, not accent. No progress bar, no trend arrow,
 * no judgment. It exists so a brain can see the cost without being
 * scolded.
 *
 * Real data: `adhdTaxVM` over `finance.records` (is_adhd_tax flagged this
 * month) + the `finance.adhd_tax` stored slice, via the live
 * `trackADHDTaxEvents` pure fn.
 *
 * The "export the adhd tax report · pdf" target routes to tax-setaside,
 * which carries the real export action.
 */
import { useMemo } from 'react';
import { Screen, ListRow, GhostButton, IconAlert, IconDownload, v2 } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { adhdTaxVM, fmtMoney } from '../selectors';
import type { MoneyRoute } from '../MoneyApp';

export interface AdhdTaxScreenProps {
  now: number;
  onBack: () => void;
  navigate: (to: MoneyRoute) => void;
  onFind: () => void;
  onSafe: () => void;
}

export function AdhdTaxScreen({ now, onBack, navigate, onFind, onSafe }: AdhdTaxScreenProps) {
  void onBack;
  const slices = useFinanceSlices();
  const tax = useMemo(
    () => adhdTaxVM(slices.records, slices.adhd_tax, now),
    [slices.records, slices.adhd_tax, now],
  );

  return (
    <Screen
      label="adhd tax"
      glyph={<IconAlert stroke={v2.accent} />}
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
          what it cost this month
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 72,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'baseline',
          }}
        >
          <span style={{ color: v2.mute, fontWeight: 300, fontSize: 43 }}>$</span>
          {fmtMoney(tax.total)}
        </div>
        <div style={{ marginTop: 11, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
          {tax.monthLabel}
        </div>

        {tax.rows.length > 0 ? (
          <div style={{ marginTop: 38, width: '100%' }}>
            {tax.rows.map((r, i) => (
              <ListRow
                key={r.id}
                muted
                first={i === 0}
                name={r.what}
                amount={`$${fmtMoney(r.cost)}`}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              marginTop: 30,
              fontSize: 14,
              color: v2.mute,
              fontWeight: 500,
              textAlign: 'center',
              lineHeight: 1.5,
              maxWidth: 260,
            }}
          >
            nothing logged here this month — that&apos;s fine, not a target.
          </div>
        )}

        <div
          style={{
            marginTop: 26,
            fontSize: 13,
            lineHeight: 1.55,
            color: v2.mute,
            textAlign: 'center',
            maxWidth: 260,
            fontWeight: 500,
          }}
        >
          this isn&apos;t a verdict. it&apos;s just what&apos;s here, so it&apos;s not a surprise.
        </div>

        <GhostButton
          icon={<IconDownload />}
          onClick={() => navigate('tax-setaside')}
          style={{ marginTop: 26, height: 48, fontSize: 14 }}
        >
          export the adhd tax report · pdf
        </GhostButton>
      </div>
    </Screen>
  );
}
