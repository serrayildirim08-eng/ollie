/**
 * body-v2 · SymptomsScreen — the episode list (the `symptoms` drill)
 *
 * The body-detail.html `symptoms` row drills here. It is a calm list, in
 * the v2 grammar: an open episode (if any) as a quiet drill into the
 * EpisodeScreen, then "log a new one" (the amber act, → SymptomLogScreen),
 * then any closed episodes as a hairline-ruled record below.
 *
 * No dedicated symptom-list mockup exists — this surface composes the
 * established v2 list grammar (body-conditions.html's `.cond` rows +
 * body-detail.html's `.who` chrome). Real data: `symptomsVM` over the
 * live `body.episodes` slice.
 */
import { useMemo } from 'react';
import { Screen, AmberButton, IconPlus, v2 } from '../../money-v2/v2';
import { useBodySlices } from '../useBodySlices';
import { symptomsVM, elapsedDaysLabel } from '../selectors';
import type { BodyRoute } from '../BodyApp';

export interface SymptomsScreenProps {
  now: number;
  onBack: () => void;
  navigate: (to: BodyRoute) => void;
  onSafe: () => void;
}

export function SymptomsScreen({
  now,
  onBack,
  navigate,
  onSafe,
}: SymptomsScreenProps) {
  const slices = useBodySlices();
  const vm = useMemo(() => symptomsVM(slices), [slices]);

  const hasNothing = !vm.open && vm.closed.length === 0;

  return (
    <Screen
      label="symptoms"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1.3,
        }}
      >
        <b style={{ fontWeight: 500 }}>what the body&rsquo;s doing</b>
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 400,
          lineHeight: 1.5,
        }}
      >
        {hasNothing
          ? 'nothing logged yet — start one when something turns up. ollie holds the day-by-day record so you don’t have to.'
          : 'ollie keeps the day-by-day record so it’s there when a doctor asks.'}
      </div>

      {/* the open episode — a quiet drill into its detail */}
      {vm.open && (
        <>
          <SectionLabel>open right now</SectionLabel>
          <button
            type="button"
            onClick={() => navigate('episode')}
            style={rowButtonStyle(true)}
          >
            <span style={{ flex: 1 }}>
              <span
                style={{
                  fontSize: 16,
                  color: v2.ink,
                  fontWeight: 600,
                  letterSpacing: '-0.012em',
                }}
              >
                {vm.open.label || 'an episode'}
              </span>
              <span
                style={{
                  display: 'block',
                  marginTop: 3,
                  fontSize: 12,
                  color: v2.mute,
                  fontWeight: 500,
                }}
              >
                {elapsedDaysLabel(vm.open, now)}
                {vm.open.kind ? ` · ${vm.open.kind}` : ''}
              </span>
            </span>
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2}
              stroke={v2.mute}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </>
      )}

      {/* log a new one — the amber act */}
      <AmberButton
        icon={<IconPlus size={18} />}
        onClick={() => navigate('symptom-log')}
        block
        style={{ marginTop: vm.open ? 24 : 28 }}
      >
        log a new one
      </AmberButton>

      {/* closed episodes — a calm hairline-ruled record */}
      {vm.closed.length > 0 && (
        <>
          <SectionLabel>on record</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {vm.closed.map((ep, i) => (
              <div
                key={ep.id}
                style={{
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'baseline',
                  padding: '16px 2px',
                  borderTop: `1px solid ${v2.line}`,
                  borderBottom:
                    i === vm.closed.length - 1
                      ? `1px solid ${v2.line}`
                      : 'none',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: 15,
                    color: v2.ink,
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {ep.label || 'episode'}
                </span>
                <span
                  style={{ fontSize: 12, color: v2.mute, fontWeight: 500 }}
                >
                  {elapsedDaysLabel(ep, now, true)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 36,
        marginBottom: 2,
        fontSize: 11,
        color: v2.mute,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function rowButtonStyle(first: boolean): React.CSSProperties {
  return {
    boxSizing: 'border-box',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 2px',
    borderTop: first ? `1px solid ${v2.line}` : 'none',
    borderBottom: `1px solid ${v2.line}`,
    borderLeft: 'none',
    borderRight: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    WebkitTapHighlightColor: 'transparent',
  };
}
