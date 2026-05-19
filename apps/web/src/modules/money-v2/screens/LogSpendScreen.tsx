/**
 * money-v2 · LogSpendScreen — capture sheet (money-log-spend.html)
 *
 * One thing: the amount, fast. A number pad, one calm category line
 * above the keys. No date picker, no notes field — the v2 spec is
 * deliberately one-tap.
 *
 * Real data: "save" appends a real out-direction `FinanceRecord` through
 * useMoneyActions — so the live safeToSpend / adhd-tax detection picks it
 * up immediately. A large spend (>= IMPULSE_THRESHOLD) routes to the
 * impulse-pause sheet instead of saving straight away.
 */
import { useState } from 'react';
import { IconCheck, IconBackspace, IconChevronDown, IconCalendar, v2 } from '../v2';
import { useMoneyActions } from '../useMoneyActions';
import type { MoneyRoute } from '../MoneyApp';

export interface LogSpendScreenProps {
  now: number;
  onBack: () => void;
  navigate: (to: MoneyRoute) => void;
}

/** spends at or above this offer the impulse-pause (an offer, not a block) */
export const IMPULSE_THRESHOLD = 80;

const CATEGORIES = ['food', 'shopping', 'transport', 'fun', 'other'];

export function LogSpendScreen({ now, onBack, navigate }: LogSpendScreenProps) {
  const actions = useMoneyActions(now);
  const [raw, setRaw] = useState('');
  const [catIdx, setCatIdx] = useState(0);

  const amount = Number(raw || '0');
  const category = CATEGORIES[catIdx];

  function tapKey(k: string) {
    if (k === '.') {
      if (!raw.includes('.')) setRaw((r) => (r === '' ? '0.' : r + '.'));
      return;
    }
    // limit to 2 decimal places
    if (raw.includes('.') && raw.split('.')[1].length >= 2) return;
    if (raw.replace('.', '').length >= 8) return;
    setRaw((r) => (r === '0' ? k : r + k));
  }

  function backspace() {
    setRaw((r) => r.slice(0, -1));
  }

  function save() {
    if (!(amount > 0)) return;
    if (amount >= IMPULSE_THRESHOLD) {
      // an offer, not a block — hand off to the pause sheet
      navigate('impulse-pause');
      return;
    }
    actions.logSpend({ amount, category });
    onBack();
  }

  const display = raw === '' ? '0' : raw;

  const keyStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    height: 62,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 400,
    color: v2.ink,
    borderRadius: 16,
    letterSpacing: '-0.02em',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: v2.sans,
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div
      style={{
        boxSizing: 'border-box',
        minHeight: '100dvh',
        width: '100%',
        background: v2.paper,
        fontFamily: v2.sans,
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* swipe handle dismisses */}
      <button
        type="button"
        aria-label="dismiss"
        onClick={onBack}
        style={{
          height: 28,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingTop: 12,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
      </button>

      {/* the amount */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 44px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
          spent
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 80,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'baseline',
          }}
        >
          <span style={{ color: v2.mute, fontWeight: 300, fontSize: 48, marginRight: 2 }}>$</span>
          {display}
          <span
            aria-hidden
            style={{
              width: 3,
              height: 64,
              background: v2.accent,
              marginLeft: 4,
              animation: 'moneyv2-blink 1.1s step-end infinite',
            }}
          />
        </div>

        {/* category chip — tap to cycle */}
        <button
          type="button"
          onClick={() => setCatIdx((i) => (i + 1) % CATEGORIES.length)}
          aria-label={`category: ${category}, tap to change`}
          style={{
            marginTop: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: `1px solid ${v2.line}`,
            background: v2.card,
            borderRadius: 18,
            padding: '9px 16px',
            boxShadow: '0 8px 20px rgba(42,38,34,.05)',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <IconCalendar stroke={v2.accent} />
          <span style={{ fontSize: 14, fontWeight: 600, color: v2.ink }}>{category}</span>
          <IconChevronDown size={12} stroke={v2.mute} />
        </button>
      </div>

      {/* the pad */}
      <div
        style={{
          padding: '0 18px 18px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)',
          gap: 6,
          boxSizing: 'border-box',
        }}
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" style={keyStyle} onClick={() => tapKey(k)}>
            {k}
          </button>
        ))}
        <button type="button" style={keyStyle} onClick={() => tapKey('.')}>
          .
        </button>
        <button type="button" style={keyStyle} onClick={() => tapKey('0')}>
          0
        </button>
        <button type="button" style={keyStyle} aria-label="backspace" onClick={backspace}>
          <IconBackspace stroke={v2.mute} />
        </button>
        <button
          type="button"
          aria-label="save spend"
          onClick={save}
          disabled={!(amount > 0)}
          style={{
            ...keyStyle,
            gridColumn: '1 / -1',
            height: 56,
            borderRadius: 18,
            background: v2.accent,
            boxShadow: '0 10px 24px rgba(201,146,62,.3)',
            opacity: amount > 0 ? 1 : 0.5,
          }}
        >
          <IconCheck stroke="#fff" />
        </button>
      </div>

      <style>{`@keyframes moneyv2-blink{50%{opacity:0}}`}</style>
    </div>
  );
}
