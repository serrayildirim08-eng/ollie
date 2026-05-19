/**
 * money-v2 · BillsScreen — Level 3 detail (money-bills.html)
 *
 * One thing: the upcoming bills, a quiet dated ledger list. Real data:
 * the live `finance.bills` slice, sorted by computed next-due. The
 * soonest bill carries a faint amber when-tint (never red).
 *
 * Two add targets — a bill, a subscription — write to the same store
 * keys the live FinanceModule uses (via useMoneyActions).
 */
import { useMemo, useState } from 'react';
import { Screen, ListRow, IconReceipt, IconPlus, v2 } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { useMoneyActions } from '../useMoneyActions';
import { upcomingBillRows, fmtMoney, fmtWhen } from '../selectors';
import type { MoneyRoute } from '../MoneyApp';
import { AddSheet } from './AddSheet';

export interface BillsScreenProps {
  now: number;
  onBack: () => void;
  navigate: (to: MoneyRoute) => void;
  onFind: () => void;
  onSafe: () => void;
}

export function BillsScreen({ now, onBack, onFind, onSafe }: BillsScreenProps) {
  void onBack;
  const slices = useFinanceSlices();
  const actions = useMoneyActions(now);
  const [sheet, setSheet] = useState<'bill' | 'sub' | null>(null);

  const bills = useMemo(() => upcomingBillRows(slices.bills, now), [slices.bills, now]);

  return (
    <Screen
      label="bills"
      glyph={<IconReceipt stroke={v2.accent} />}
      onFind={onFind}
      onSafe={onSafe}
      centered
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%',
          maxWidth: 320,
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
            marginBottom: 28,
            textAlign: 'center',
          }}
        >
          what&apos;s coming up
        </div>

        {bills.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              fontSize: 15,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            no bills yet — add the ones you already know about.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {bills.map((b, i) => (
              <ListRow
                key={b.id}
                large
                first={i === 0}
                name={b.name}
                amount={`$${fmtMoney(b.amount)}`}
                when={fmtWhen(b.dueAt, now)}
                soon={i === 0 && b.daysUntil <= 3}
              />
            ))}
          </div>
        )}

        <div style={{ marginTop: 34, display: 'flex', gap: 12, justifyContent: 'center' }}>
          <AddTarget label="a bill" onClick={() => setSheet('bill')} />
          <AddTarget label="a subscription" onClick={() => setSheet('sub')} />
        </div>
      </div>

      {sheet === 'bill' && (
        <AddSheet
          title="add a bill"
          nameLabel="bill name"
          onCancel={() => setSheet(null)}
          onSave={({ name, amount }) => {
            actions.addBill({ name, amount, frequency: 'monthly', dueDay: 1 });
            setSheet(null);
          }}
        />
      )}
      {sheet === 'sub' && (
        <AddSheet
          title="add a subscription"
          nameLabel="subscription name"
          onCancel={() => setSheet(null)}
          onSave={({ name, amount }) => {
            actions.addSubscription({ name, amount, period: 'monthly' });
            setSheet(null);
          }}
        />
      )}
    </Screen>
  );
}

function AddTarget({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        boxSizing: 'border-box',
        height: 46,
        borderRadius: 23,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        padding: '0 20px',
        border: `1px solid ${v2.line}`,
        background: v2.card,
        boxShadow: '0 8px 22px rgba(42,38,34,.05)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <IconPlus size={15} stroke={v2.accent} />
      <span style={{ fontSize: 14, fontWeight: 600, color: v2.ink, letterSpacing: '-0.01em' }}>
        {label}
      </span>
    </button>
  );
}
