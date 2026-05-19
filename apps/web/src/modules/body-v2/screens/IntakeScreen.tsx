/**
 * body-v2 · IntakeScreen — water + supplements (body-intake.html)
 *
 * The day's water as a large filling glass: add / remove sit either side.
 * Under it, the supplement list — each row a tap-to-check line: a sage
 * check circle, the name, the reminder time as a quiet trailing mark. A
 * ghost row adds a supplement. NO calories, NO grade.
 *
 * Real data: `intakeVM` over the live `body.water_log` / `body.supplements`
 * / `body.supp_checks` slices; every tap mutates the live store through
 * `useBodyActions`.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconPlus, IconCheck, v2 } from '../../money-v2/v2';
import { useBodySlices } from '../useBodySlices';
import { useBodyActions } from '../useBodyActions';
import { intakeVM } from '../selectors';
import { Glass } from '../components/Glass';

export interface IntakeScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function IntakeScreen({ now, onBack, onSafe }: IntakeScreenProps) {
  const slices = useBodySlices();
  const actions = useBodyActions(now);
  const vm = useMemo(() => intakeVM(slices, now), [slices, now]);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');

  function submitSupp() {
    if (!name.trim()) return;
    actions.addSupplement(name, dose);
    setName('');
    setDose('');
    setAdding(false);
  }

  return (
    <Screen label="intake" onBack={onBack} onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* THE HERO — the day's water */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Glass fill={vm.waterFill} size="big" />

        <div
          style={{
            marginTop: 20,
            fontSize: 46,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {vm.waterCount}
          <span style={{ fontSize: 20, color: v2.mute, fontWeight: 300, letterSpacing: '-0.01em' }}>
            {' '}
            of {vm.waterTarget}
          </span>
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          glasses today
        </div>

        {/* add / remove */}
        <div
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
          }}
        >
          <button
            type="button"
            aria-label="remove a glass"
            disabled={vm.waterCount === 0}
            onClick={() => actions.removeGlass()}
            style={{
              boxSizing: 'border-box',
              width: 48,
              height: 48,
              borderRadius: 24,
              border: `1px solid ${v2.line}`,
              background: v2.card,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: vm.waterCount === 0 ? 'default' : 'pointer',
              opacity: vm.waterCount === 0 ? 0.45 : 1,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.4}
              stroke={v2.mute}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M5 12h14" />
            </svg>
          </button>
          <AmberButton
            icon={<IconPlus size={18} />}
            onClick={() => actions.addGlass()}
            style={{ height: 50, borderRadius: 25 }}
          >
            a glass
          </AmberButton>
        </div>
      </div>

      {/* supplements */}
      <SectionLabel>supplements</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {vm.supplements.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.taken}
            onClick={() => actions.toggleSupplement(s.id)}
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 13,
              padding: '16px 2px',
              borderTop: `1px solid ${v2.line}`,
              borderBottom:
                i === vm.supplements.length - 1
                  ? `1px solid ${v2.line}`
                  : 'none',
              background: 'transparent',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <CheckCircle on={s.taken} />
            <span
              style={{
                flex: 1,
                fontSize: 15,
                color: s.taken ? v2.mute : v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              {s.name}
            </span>
            {s.when && (
              <span
                style={{
                  fontSize: 12,
                  color: v2.mute,
                  fontWeight: 500,
                  letterSpacing: '0.01em',
                }}
              >
                {s.when}
              </span>
            )}
          </button>
        ))}

        {/* add a supplement — a quiet ghost row, then an inline form */}
        {adding ? (
          <div
            style={{
              boxSizing: 'border-box',
              borderTop: `1px solid ${v2.line}`,
              borderBottom: `1px solid ${v2.line}`,
              padding: '16px 2px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSupp();
              }}
              placeholder="supplement name"
              aria-label="supplement name"
              style={fieldStyle}
            />
            <input
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSupp();
              }}
              placeholder="dose — optional"
              aria-label="supplement dose"
              style={fieldStyle}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <AmberButton
                onClick={submitSupp}
                block
                style={{ flex: 1, height: 44, borderRadius: 22, fontSize: 14 }}
              >
                add it
              </AmberButton>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setName('');
                  setDose('');
                }}
                style={{
                  boxSizing: 'border-box',
                  height: 44,
                  padding: '0 18px',
                  borderRadius: 22,
                  border: `1px solid ${v2.line}`,
                  background: v2.paper,
                  color: v2.mute,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              boxSizing: 'border-box',
              borderTop: `1px solid ${v2.line}`,
              padding: '16px 2px',
              display: 'flex',
              alignItems: 'center',
              gap: 13,
              background: 'transparent',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: `1.6px dashed ${v2.line}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <IconPlus size={12} weight={2.4} stroke={v2.mute} />
            </span>
            <span
              style={{
                fontSize: 14,
                color: v2.mute,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              add a supplement
            </span>
          </button>
        )}
      </div>
    </Screen>
  );
}

const fieldStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '11px 13px',
  borderRadius: 12,
  border: `1px solid ${v2.line}`,
  background: v2.card,
  fontSize: 15,
  color: v2.ink,
  fontFamily: v2.sans,
  outline: 'none',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 46,
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

/** the supplement check circle — empty ink ring, or sage-filled tick */
function CheckCircle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        border: `1.6px solid ${on ? v2.sage : v2.line}`,
        background: on ? v2.sage : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {on && <IconCheck size={13} weight={3} stroke="#fff" />}
    </span>
  );
}
