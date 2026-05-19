/**
 * money-v2 · MoneyFace — the money module page (Level 2)
 *
 * Mirrors money.html / money-private.html / money-empty.html — one face,
 * three data states:
 *   - has data    → hero safe-to-spend number + 5 expandable area rows
 *   - first run   → calm glance-line hero + invitation rows (money-empty)
 *   - masked      → same layout, figures replaced by monospace blocks
 *
 * Real data: every line comes from `selectors.ts` over the live
 * `finance.*` slices. One area card open at a time (DIRECTION.md rule).
 */
import { useMemo, useState } from 'react';
import {
  Screen,
  HeroNumber,
  AmberButton,
  AreaCard,
  IconPlus,
  IconEye,
  IconEyeClosed,
  IconFaceId,
  v2,
} from '../v2';
import type { AreaDetailLine } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { useMoneyActions } from '../useMoneyActions';
import {
  safeToSpendVM,
  incomeVM,
  savingsVM,
  adhdTaxVM,
  upcomingBillRows,
  dormantCount,
  isMasked,
  hasAnyFinanceData,
  fmtMoney,
  fmtWhen,
} from '../selectors';
import type { MoneyRoute } from '../MoneyApp';

export interface MoneyFaceProps {
  now: number;
  navigate: (to: MoneyRoute) => void;
  onFind: () => void;
  onSafe: () => void;
}

type AreaKey = 'bills' | 'income' | 'subscriptions' | 'savings' | 'adhd tax';

export function MoneyFace({ now, navigate, onFind, onSafe }: MoneyFaceProps) {
  const slices = useFinanceSlices();
  const actions = useMoneyActions(now);
  const [openCard, setOpenCard] = useState<AreaKey | null>(null);

  const masked = isMasked(slices.privacy, now);
  const hasData = hasAnyFinanceData(slices);

  const sts = useMemo(() => safeToSpendVM(slices, now), [slices, now]);
  const bills = useMemo(() => upcomingBillRows(slices.bills, now), [slices.bills, now]);
  const income = useMemo(() => incomeVM(slices.records, now), [slices.records, now]);
  const savings = useMemo(
    () => savingsVM(slices.goals, slices.records, now),
    [slices.goals, slices.records, now],
  );
  const tax = useMemo(
    () => adhdTaxVM(slices.records, slices.adhd_tax, now),
    [slices.records, slices.adhd_tax, now],
  );
  const dormant = useMemo(
    () => dormantCount(slices.subscriptions, slices.records, now),
    [slices.subscriptions, slices.records, now],
  );

  const nextBill = bills[0] ?? null;

  function toggle(k: AreaKey) {
    setOpenCard((cur) => (cur === k ? null : k));
  }

  // ── glance lines (collapsed area cards) ──────────────────────────────────

  const billsLine = hasData ? (
    nextBill ? (
      <>
        {nextBill.name} <b>${fmtMoney(nextBill.amount)}</b> · {fmtWhen(nextBill.dueAt, now)}
      </>
    ) : (
      'nothing due soon'
    )
  ) : (
    'add the ones you know'
  );

  const incomeLine = hasData ? (
    income.haveSignal ? (
      <>
        ~<b>${fmtMoney(income.monthly)}</b>/mo · {income.shape}
      </>
    ) : (
      'ollie watches this on its own'
    )
  ) : (
    'ollie watches this on its own'
  );

  const subsLine = hasData ? (
    dormant > 0 ? (
      <>
        <b>{dormant}</b> look dormant
      </>
    ) : (
      `${slices.subscriptions.length} tracked`
    )
  ) : (
    'none picked up yet'
  );

  const savingsLine = hasData ? (
    savings.haveGoal ? (
      <>
        {savings.goalName} <b>${fmtMoney(savings.saved)}</b> / ${fmtMoney(savings.target)}
      </>
    ) : (
      'name something to save toward'
    )
  ) : (
    'name something to save toward'
  );

  const taxLine = hasData ? (
    tax.total > 0 ? (
      <>
        <b>${fmtMoney(tax.total)}</b> this month
      </>
    ) : (
      "nothing here — that's fine"
    )
  ) : (
    "nothing here — that's fine"
  );

  // ── expand details ───────────────────────────────────────────────────────

  const incomeDetail: AreaDetailLine[] = income.haveSignal
    ? [
        {
          k: 'last 3 months',
          v: income.band
            .slice(-3)
            .map((b) => `$${fmtMoney(b.total)}`)
            .join(' · '),
        },
        { k: 'shape', v: income.shape },
        {
          k: 'last landed',
          v: income.lastLanded
            ? `$${fmtMoney(income.lastLanded.amount)} · ${income.lastLanded.daysAgo}d ago`
            : '—',
        },
      ]
    : [];

  const billsDetail: AreaDetailLine[] = bills.slice(0, 3).map((b) => ({
    k: b.name,
    v: `$${fmtMoney(b.amount)} · ${fmtWhen(b.dueAt, now)}`,
  }));

  const savingsDetail: AreaDetailLine[] = savings.haveGoal
    ? [
        { k: 'target', v: `$${fmtMoney(savings.target)}` },
        { k: 'pace', v: savings.paceLabel ?? 'set your pace' },
      ]
    : [];

  const taxDetail: AreaDetailLine[] = tax.rows.slice(0, 3).map((r) => ({
    k: r.what,
    v: `$${fmtMoney(r.cost)}`,
  }));

  const subsDetail: AreaDetailLine[] = [
    { k: 'tracked', v: String(slices.subscriptions.length) },
    { k: 'look dormant', v: String(dormant) },
  ];

  // ── the eye (privacy toggle) ─────────────────────────────────────────────

  const eye = (
    <button
      type="button"
      aria-label={masked ? 'show figures' : 'hide figures'}
      onClick={() => actions.setPrivacyEnabled(!masked)}
      style={{
        marginLeft: 3,
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: masked ? v2.tile : 'transparent',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {masked ? <IconEyeClosed stroke={v2.accent} /> : <IconEye stroke={v2.mute} />}
    </button>
  );

  return (
    <Screen
      label="money"
      whoTrailing={eye}
      onFind={onFind}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* HERO */}
      <div style={{ marginTop: 38, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {hasData ? (
          sts.coldStart ? (
            <ColdHero />
          ) : (
            <HeroNumber
              lead="safe to spend"
              value={fmtMoney(sts.amount ?? 0)}
              size={78}
              horizon={sts.horizonFill}
              caption={sts.daysLeftLabel}
              masked={masked}
            />
          )
        ) : (
          <EmptyHero />
        )}

        <AmberButton
          icon={<IconPlus />}
          onClick={() => navigate('log-spend')}
          style={{ marginTop: 30, height: 50, borderRadius: 25 }}
        >
          {hasData ? 'spend' : 'log your first spend'}
        </AmberButton>
      </div>

      {/* AREA ROWS */}
      <div style={{ marginTop: 54, display: 'flex', flexDirection: 'column' }}>
        <AreaCard
          first
          areaKey="bills"
          value={billsLine}
          masked={masked && hasData}
          open={openCard === 'bills'}
          onToggle={() => toggle('bills')}
          detail={billsDetail}
          onOpen={() => navigate('bills')}
        />
        <AreaCard
          areaKey="income"
          value={incomeLine}
          masked={masked && hasData}
          open={openCard === 'income'}
          onToggle={() => toggle('income')}
          detail={incomeDetail}
          onOpen={() => navigate('income')}
        />
        <AreaCard
          areaKey="subscriptions"
          value={subsLine}
          masked={masked && hasData}
          open={openCard === 'subscriptions'}
          onToggle={() => toggle('subscriptions')}
          detail={subsDetail}
          onOpen={() => navigate('subscriptions')}
        />
        <AreaCard
          areaKey="savings"
          value={savingsLine}
          masked={masked && hasData}
          open={openCard === 'savings'}
          onToggle={() => toggle('savings')}
          detail={savingsDetail}
          onOpen={() => navigate('savings')}
        />
        <AreaCard
          areaKey="adhd tax"
          value={taxLine}
          masked={masked && hasData}
          open={openCard === 'adhd tax'}
          onToggle={() => toggle('adhd tax')}
          detail={taxDetail}
          onOpen={() => navigate('adhdtax')}
        />
      </div>

      {/* masked → a quiet face-id prompt at the bottom */}
      {masked && hasData && (
        <button
          type="button"
          onClick={() => actions.unlockPrivacy()}
          style={{
            marginTop: 30,
            background: 'transparent',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            alignSelf: 'center',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span
            style={{
              width: 50,
              height: 50,
              borderRadius: 14,
              border: `1.5px solid ${v2.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconFaceId stroke={v2.mute} />
          </span>
          <span style={{ fontSize: 13, color: v2.mute, fontWeight: 500 }}>
            face id to show your figures
          </span>
        </button>
      )}
    </Screen>
  );
}

function EmptyHero() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
        safe to spend
      </div>
      <div
        style={{
          marginTop: 18,
          fontSize: 25,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.018em',
          textAlign: 'center',
          lineHeight: 1.4,
          maxWidth: 240,
        }}
      >
        a few spends and ollie can work this out
      </div>
      <div style={{ marginTop: 14, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
        nothing logged yet
      </div>
    </div>
  );
}

function ColdHero() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
        safe to spend
      </div>
      <div
        style={{
          marginTop: 18,
          fontSize: 25,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.018em',
          textAlign: 'center',
          lineHeight: 1.4,
          maxWidth: 248,
        }}
      >
        still learning your income pattern
      </div>
      <div style={{ marginTop: 14, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
        a few more weeks of data
      </div>
    </div>
  );
}
