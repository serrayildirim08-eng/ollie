/**
 * money-v2 · SubscriptionsScreen — Level 3 detail (money-subscriptions.html)
 *
 * One thing: the audit. ONE subscription at a time, never a list, never a
 * wall of guilt. A calm observation, then two equal choices. Quiet dots
 * count what's left.
 *
 * Real data: `subscriptionAudit` over `finance.subscriptions` +
 * `finance.records`. "cancel" marks the sub to-cancel through the same
 * store key the live module uses, then advances the deck.
 */
import { useMemo, useState } from 'react';
import { Screen, GhostButton, AmberButton, IconRefresh, IconArrowUpRight, v2 } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { useMoneyActions } from '../useMoneyActions';
import { subscriptionAudit } from '../selectors';

export interface SubscriptionsScreenProps {
  now: number;
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
}

export function SubscriptionsScreen({ now, onBack, onFind, onSafe }: SubscriptionsScreenProps) {
  void onBack;
  const slices = useFinanceSlices();
  const actions = useMoneyActions(now);
  const [idx, setIdx] = useState(0);

  // the audit deck — dormant first, so the quiet ones surface
  const deck = useMemo(() => {
    const all = subscriptionAudit(slices.subscriptions, slices.records, now);
    return [...all].sort((a, b) => Number(b.dormant) - Number(a.dormant));
  }, [slices.subscriptions, slices.records, now]);

  const card = deck[idx] ?? null;
  const done = idx >= deck.length;

  function next() {
    setIdx((i) => i + 1);
  }

  return (
    <Screen
      label="subscriptions"
      glyph={<IconRefresh stroke={v2.accent} />}
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
        {deck.length === 0 ? (
          <div
            style={{
              fontSize: 15,
              color: v2.mute,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            no subscriptions tracked yet — add one from bills.
          </div>
        ) : done || !card ? (
          <div
            style={{
              fontSize: 16,
              color: v2.sage,
              fontWeight: 500,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            that&apos;s the lot. nothing else to look at.
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 13,
                color: v2.mute,
                fontWeight: 500,
                letterSpacing: '0.02em',
                marginBottom: 30,
              }}
            >
              a quiet look · {idx + 1} of {deck.length}
            </div>

            <div
              style={{
                boxSizing: 'border-box',
                width: '100%',
                background: v2.card,
                border: `1px solid ${v2.line}`,
                borderRadius: 26,
                boxShadow: v2.cardShadow,
                padding: '32px 28px 30px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 30, fontWeight: 400, color: v2.ink, letterSpacing: '-0.02em' }}>
                {card.name}
              </div>
              <div style={{ marginTop: 6, fontSize: 14, color: v2.mute, fontWeight: 500 }}>
                {card.priceLabel}
              </div>
              <div
                style={{
                  marginTop: 22,
                  fontSize: 15,
                  lineHeight: 1.5,
                  color: v2.sage,
                  fontWeight: 500,
                  letterSpacing: '-0.005em',
                  maxWidth: 240,
                }}
              >
                {card.observation}
              </div>

              <div
                style={{
                  marginTop: 30,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  width: '100%',
                }}
              >
                <GhostButton onClick={next}>keep it</GhostButton>
                <AmberButton
                  block
                  icon={<IconArrowUpRight />}
                  onClick={() => {
                    actions.markSubCancel(card.id);
                    next();
                  }}
                >
                  cancel — open {card.name.toLowerCase()}
                </AmberButton>
              </div>
            </div>

            <div style={{ marginTop: 30, display: 'flex', gap: 9 }}>
              {deck.map((d, i) => (
                <span
                  key={d.id}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: i === idx ? v2.ink : v2.line,
                    display: 'block',
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}
