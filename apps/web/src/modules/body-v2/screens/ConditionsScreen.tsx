/**
 * body-v2 · ConditionsScreen — conditions & treatment (body-conditions.html)
 *
 * A calm list of tracked chronic conditions (each a plain fact, a quiet
 * "tags matching episodes" trailing note), then treatment plans — each a
 * card with a cycle-dot track (done = sage, current = amber ring, ahead =
 * line ring), a position line, and a calm sage "advance" action. No
 * progress bar, no badge — a map of the course, held with dignity.
 *
 * Real data + logic: `conditionsVM` over `shared.settings.chronic_conditions`
 * + `body.treatment_plans`; the cycle position runs through the pure
 * `treatmentVM` selector. Adds / removes / advances mutate the live store.
 */
import { useMemo, useState } from 'react';
import { Screen, IconPlus, IconCheck, v2 } from '../../money-v2/v2';
import { useBodySlices } from '../useBodySlices';
import { useBodyActions } from '../useBodyActions';
import { conditionsVM } from '../selectors';
import type { TreatmentVM } from '../selectors';

export interface ConditionsScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function ConditionsScreen({ now, onBack, onSafe }: ConditionsScreenProps) {
  const slices = useBodySlices();
  const actions = useBodyActions(now);
  const vm = useMemo(() => conditionsVM(slices, now), [slices, now]);

  const [condDraft, setCondDraft] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planLen, setPlanLen] = useState('21');
  const [planCycles, setPlanCycles] = useState('6');

  function submitCondition() {
    if (!condDraft.trim()) return;
    actions.addCondition(condDraft);
    setCondDraft('');
  }

  function submitPlan() {
    if (!planName.trim()) return;
    actions.addPlan(
      planName,
      parseInt(planLen, 10) || 21,
      parseInt(planCycles, 10) || 6,
    );
    setPlanName('');
    setPlanLen('21');
    setPlanCycles('6');
    setPlanOpen(false);
  }

  return (
    <Screen
      label="conditions & treatment"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* conditions */}
      <SectionLabel top>conditions you track</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {vm.conditions.map((c, i) => (
          <div
            key={`${c}-${i}`}
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'baseline',
              padding: '16px 2px',
              borderTop: `1px solid ${v2.line}`,
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
              {c}
            </span>
            <span style={{ fontSize: 12, color: v2.mute, fontWeight: 500 }}>
              tags matching episodes
            </span>
            <button
              type="button"
              aria-label={`remove ${c}`}
              onClick={() => actions.removeCondition(i)}
              style={{
                marginLeft: 12,
                width: 20,
                height: 20,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: v2.mute,
                fontSize: 16,
                lineHeight: 1,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              &times;
            </button>
          </div>
        ))}

        {/* add a condition — a quiet inline field */}
        <div
          style={{
            boxSizing: 'border-box',
            borderTop: `1px solid ${v2.line}`,
            borderBottom: `1px solid ${v2.line}`,
            padding: '14px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: `1.5px dashed ${v2.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconPlus size={11} weight={2.4} stroke={v2.mute} />
          </span>
          <input
            value={condDraft}
            onChange={(e) => setCondDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCondition();
            }}
            placeholder="add a condition — migraine, ibs&hellip;"
            aria-label="add a condition"
            style={{
              boxSizing: 'border-box',
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
              color: v2.ink,
              fontFamily: v2.sans,
              letterSpacing: '-0.01em',
              padding: 0,
            }}
          />
        </div>
      </div>

      {/* treatment plans */}
      <SectionLabel>treatment plan</SectionLabel>
      {vm.plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          onAdvance={() => actions.advancePlan(plan.id)}
        />
      ))}

      {/* add a plan */}
      {planOpen ? (
        <div
          style={{
            marginTop: 16,
            border: `1px solid ${v2.line}`,
            borderRadius: 18,
            padding: 18,
            background: v2.card,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 11,
          }}
        >
          <input
            autoFocus
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            placeholder="plan name — chemotherapy, allergy shots&hellip;"
            aria-label="treatment plan name"
            style={fieldStyle}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 1 }}>
              <span style={miniLabel}>cycle length (days)</span>
              <input
                inputMode="numeric"
                value={planLen}
                onChange={(e) => setPlanLen(e.target.value.replace(/\D/g, ''))}
                aria-label="cycle length in days"
                style={fieldStyle}
              />
            </label>
            <label style={{ flex: 1 }}>
              <span style={miniLabel}>total cycles</span>
              <input
                inputMode="numeric"
                value={planCycles}
                onChange={(e) =>
                  setPlanCycles(e.target.value.replace(/\D/g, ''))
                }
                aria-label="total cycles"
                style={fieldStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={submitPlan}
              style={{
                boxSizing: 'border-box',
                flex: 1,
                height: 44,
                borderRadius: 22,
                background: v2.card,
                border: `1.5px solid ${v2.sage}`,
                color: v2.sage,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              add the plan
            </button>
            <button
              type="button"
              onClick={() => setPlanOpen(false)}
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
          onClick={() => setPlanOpen(true)}
          style={{
            boxSizing: 'border-box',
            marginTop: 16,
            border: `1.5px dashed ${v2.line}`,
            borderRadius: 18,
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            background: 'transparent',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <IconPlus size={13} weight={2.2} stroke={v2.mute} />
          <span style={{ fontSize: 14, color: v2.mute, fontWeight: 500, letterSpacing: '-0.01em' }}>
            add a treatment plan
          </span>
        </button>
      )}
    </Screen>
  );
}

// ─── a treatment plan card ───────────────────────────────────────────────────

function PlanCard({
  plan,
  onAdvance,
}: {
  plan: TreatmentVM;
  onAdvance: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 14,
        background: v2.card,
        border: `1px solid ${v2.line}`,
        borderRadius: 20,
        padding: '20px 19px',
        boxShadow: '0 6px 16px rgba(42,38,34,.05)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontSize: 17,
          color: v2.ink,
          fontWeight: 600,
          letterSpacing: '-0.015em',
        }}
      >
        {plan.label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.01em',
        }}
      >
        {plan.positionLine}
      </div>

      {/* the cycle track */}
      <div
        style={{
          marginTop: 17,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {plan.track.map((node, i) => (
          <div
            key={node.index}
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: i === plan.track.length - 1 ? '0 0 auto' : 1,
            }}
          >
            <CycleNode state={node.state} />
            {i < plan.track.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background:
                    node.state === 'done' ? v2.sage : v2.line,
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 1px',
        }}
      >
        {plan.track.map((node) => (
          <span
            key={node.index}
            style={{
              fontSize: 10,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            {node.index}
          </span>
        ))}
      </div>

      {/* advance — a calm, non-celebratory action */}
      {!plan.finished && plan.currentCycle > 0 && (
        <button
          type="button"
          onClick={onAdvance}
          style={{
            boxSizing: 'border-box',
            marginTop: 17,
            width: '100%',
            height: 46,
            borderRadius: 23,
            background: v2.paper,
            border: `1.5px solid ${v2.sage}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.2}
            stroke={v2.sage}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600, color: v2.sage, letterSpacing: '-0.01em' }}>
            cycle {plan.currentCycle} is done
          </span>
        </button>
      )}

      <div
        style={{
          marginTop: 14,
          fontSize: 12,
          color: v2.mute,
          fontWeight: 400,
          lineHeight: 1.55,
          textAlign: 'center',
          padding: '0 8px',
        }}
      >
        {plan.finished
          ? 'every cycle is on record. ollie kept the dates and the timing — it’s all here for whoever needs it.'
          : 'ollie just holds the dates and the timing. nothing here is a finish line — it’s a map, so you always know where you are.'}
      </div>
    </div>
  );
}

function CycleNode({ state }: { state: 'done' | 'now' | 'ahead' }) {
  if (state === 'done') {
    return (
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: v2.sage,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <IconCheck size={9} weight={3} stroke="#fff" />
      </span>
    );
  }
  if (state === 'now') {
    return (
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `2px solid ${v2.accent}`,
          background: '#FCF6EA',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{ width: 7, height: 7, borderRadius: '50%', background: v2.accent }}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: `1.6px solid ${v2.line}`,
        background: v2.card,
        flexShrink: 0,
      }}
    />
  );
}

function SectionLabel({
  children,
  top = false,
}: {
  children: React.ReactNode;
  top?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: top ? 44 : 42,
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

const fieldStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '11px 13px',
  borderRadius: 12,
  border: `1px solid ${v2.line}`,
  background: v2.paper,
  fontSize: 15,
  color: v2.ink,
  fontFamily: v2.sans,
  outline: 'none',
};

const miniLabel: React.CSSProperties = {
  display: 'block',
  marginBottom: 5,
  fontSize: 10,
  color: v2.mute,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
