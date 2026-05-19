/**
 * money-v2 · TaxSetAsideScreen — Level 3 detail (money-tax-setaside.html)
 *
 * One thing: the slice of this income that belongs to tax. Self-employed
 * only. One number, stated calmly so it's set aside before it's spent.
 *
 * Real data: `taxSetAsideVM` over `finance.records` (the last income that
 * landed), via the live `calculateUSSelfEmployedSetAside` pure fn. "set
 * aside" appends a real contribution to a "tax" savings goal through
 * useMoneyActions. "export" hands off to the live ADHD-tax report path
 * (stubbed to a toast here — the real PDF render lives in the live
 * ExportPanel; see report).
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, GhostButton, IconBriefcase, IconGlobe, IconCheck, IconDownload, IconChevronDown, v2 } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { useMoneyActions } from '../useMoneyActions';
import { taxSetAsideVM, fmtMoney } from '../selectors';

export interface TaxSetAsideScreenProps {
  now: number;
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
}

export function TaxSetAsideScreen({ now, onBack, onFind, onSafe }: TaxSetAsideScreenProps) {
  void onBack;
  const slices = useFinanceSlices();
  const actions = useMoneyActions(now);
  const [note, setNote] = useState<string | null>(null);

  const vm = useMemo(() => taxSetAsideVM(slices.records, now), [slices.records, now]);

  return (
    <Screen
      label="tax set-aside"
      glyph={<IconBriefcase stroke={v2.accent} />}
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
        {vm.haveIncome ? (
          <>
            <div
              style={{
                fontSize: 13,
                color: v2.mute,
                fontWeight: 500,
                letterSpacing: '0.02em',
                textAlign: 'center',
              }}
            >
              set aside from the ${fmtMoney(vm.landedIncome)} that landed
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
              {fmtMoney(vm.setAside)}
            </div>
            <div style={{ marginTop: 13, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
              ~{Math.round(vm.pct * 100)}% · so it&apos;s there when tax is due
            </div>

            {/* jurisdiction chip */}
            <div
              style={{
                marginTop: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${v2.line}`,
                background: v2.card,
                borderRadius: 18,
                padding: '9px 16px',
                boxShadow: '0 8px 20px rgba(42,38,34,.05)',
              }}
            >
              <IconGlobe stroke={v2.accent} />
              <b style={{ fontSize: 14, fontWeight: 600, color: v2.ink }}>{vm.jurisdiction}</b>
              <span style={{ fontSize: 13, color: v2.mute, fontWeight: 500 }}>
                · self-employed
              </span>
              <IconChevronDown size={12} stroke={v2.mute} />
            </div>

            <div
              style={{
                marginTop: 42,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <AmberButton
                block
                icon={<IconCheck size={17} weight={2.2} />}
                onClick={() => {
                  actions.addToSavings(vm.setAside, 'tax set-aside');
                  setNote(`$${fmtMoney(vm.setAside)} set aside for tax.`);
                }}
              >
                set ${fmtMoney(vm.setAside)} aside
              </AmberButton>
              <GhostButton
                icon={<IconDownload />}
                onClick={() => setNote('export runs in the live finance module — pdf report.')}
                style={{ fontSize: 15 }}
              >
                export the adhd tax report · pdf
              </GhostButton>
            </div>

            {note && (
              <div
                style={{
                  marginTop: 20,
                  fontSize: 13,
                  color: v2.sage,
                  fontWeight: 500,
                  textAlign: 'center',
                }}
              >
                {note}
              </div>
            )}

            <div
              style={{
                marginTop: 20,
                fontSize: 12,
                color: v2.mute,
                fontWeight: 500,
                textAlign: 'center',
                maxWidth: 260,
                lineHeight: 1.5,
              }}
            >
              an estimate, not tax advice.
            </div>
          </>
        ) : (
          <div
            style={{
              fontSize: 16,
              color: v2.mute,
              fontWeight: 400,
              textAlign: 'center',
              lineHeight: 1.5,
              maxWidth: 248,
            }}
          >
            no income has landed yet — once it does, ollie works out the tax slice.
          </div>
        )}
      </div>
    </Screen>
  );
}
