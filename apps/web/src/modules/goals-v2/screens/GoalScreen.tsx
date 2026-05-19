/**
 * goals-v2 · GoalScreen — a single goal at rest (goals-goal.html)
 *
 * A single goal: the name as the page hero, a soft progress bar computed
 * from milestones, the milestone list (tap a ring to mark done — progress
 * auto-recomputes), the AI step-breakdown offer, the block the user saw
 * coming (their own words, a quote block), the Ulysses contract (a note to
 * their future self), and a calm footer of routes.
 *
 * TONE — goals + ADHD is a shame minefield, so this page is forward and
 * kind: progress is shown, never the time since you last touched it; an
 * unfinished milestone is just open, never a reproach. "let it go" is
 * given the SAME calm weight as "review" — dropping a goal is a valid,
 * unshamed move, sage-coloured, never hidden in a danger zone.
 *
 * Real data: every line comes from `goalDetailVM` over the live `goals.*`
 * slices; the milestone tick + the park / drop footer rows write real
 * mutations through `useGoalsActions`.
 */
import { useMemo, useState } from 'react';
import {
  Screen,
  IconCheck,
  IconSparkle,
  IconContract,
  IconChevronRight,
  v2,
} from '../../money-v2/v2';
import { useGoalsSlices } from '../useGoalsSlices';
import { useGoalsActions } from '../useGoalsActions';
import { goalDetailVM, type GoalMilestoneVM } from '../selectors';

export interface GoalScreenProps {
  now: number;
  goalId: string | null;
  onBack: () => void;
  onSafe: () => void;
  onReview: (id: string) => void;
}

export function GoalScreen({ now, goalId, onBack, onSafe, onReview }: GoalScreenProps) {
  const slices = useGoalsSlices();
  const actions = useGoalsActions(now);
  const vm = useMemo(() => goalDetailVM(slices, goalId, now), [slices, goalId, now]);
  // a dry, lowercase confirmation after park / drop, like the add screen
  const [done, setDone] = useState<'parked' | 'released' | null>(null);

  if (!vm.exists) {
    return (
      <Screen label="a goal" onBack={onBack} onSafe={onSafe} centered>
        <div
          style={{
            fontSize: 16,
            color: v2.mute,
            fontWeight: 500,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          this goal isn&rsquo;t here anymore.
          <br />
          that&rsquo;s alright &mdash; swipe down to go back.
        </div>
      </Screen>
    );
  }

  const park = () => {
    actions.setStatus(vm.id, 'paused');
    setDone('parked');
    window.setTimeout(() => onBack(), 1000);
  };
  const release = () => {
    actions.setStatus(vm.id, 'dropped');
    setDone('released');
    window.setTimeout(() => onBack(), 1000);
  };

  return (
    <Screen label="a goal" onBack={onBack} onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the goal header — the name as the hero */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: 29,
            fontWeight: 400,
            color: v2.ink,
            letterSpacing: '-0.022em',
            textAlign: 'center',
          }}
        >
          {vm.name}
        </div>
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {vm.meta}
        </div>
      </div>

      {/* the progress bar — computed from the milestones */}
      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div
          style={{
            boxSizing: 'border-box',
            height: 7,
            borderRadius: 4,
            background: v2.line,
            position: 'relative',
            overflow: 'hidden',
          }}
          role="progressbar"
          aria-valuenow={vm.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${vm.name} progress`}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${vm.pct}%`,
              borderRadius: 4,
              background: v2.ink,
              opacity: 0.82,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <span
            style={{
              fontSize: 14,
              color: v2.ink,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            {vm.pct}%
          </span>
          <span style={{ fontSize: 12.5, color: v2.mute, fontWeight: 500 }}>
            {vm.progressCaption}
          </span>
        </div>
      </div>

      {/* MILESTONES — tap a ring to mark done, progress recomputes */}
      <Section title="milestones">
        {vm.milestones.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {vm.milestones.map((m) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                onToggle={() => actions.toggleMilestone(vm.id, m.id)}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              fontSize: 13.5,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            no milestones yet &mdash; a goal can run without them. add one in
            the live module when a small next step is clear.
          </div>
        )}

        {/* the AI step-breakdown — one calm sage offer */}
        <div
          style={{
            boxSizing: 'border-box',
            marginTop: 16,
            border: `1px solid ${v2.line}`,
            borderRadius: 16,
            background: v2.card,
            padding: '15px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 6px 16px rgba(42,38,34,.04)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: '#EEF2EF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconSparkle size={16} stroke={v2.sage} />
          </span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                color: v2.ink,
                fontWeight: 600,
                letterSpacing: '-0.01em',
              }}
            >
              {vm.steps.length > 0
                ? 'ollie broke this into steps'
                : 'ask ollie to break this into steps'}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: v2.mute, fontWeight: 400 }}>
              {vm.steps.length > 0
                ? `${vm.steps.length} small move${vm.steps.length === 1 ? '' : 's'} — no pressure to do them`
                : 'a calm 3–7 small moves — no pressure to do them'}
            </div>
          </div>
          <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
            <IconChevronRight stroke={v2.mute} />
          </span>
        </div>

        {/* the steps themselves, when the user already generated them */}
        {vm.steps.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {vm.steps.map((s, i) => (
              <div
                key={`${i}-${s}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: v2.sage,
                    flexShrink: 0,
                    marginTop: 7,
                  }}
                />
                <span
                  style={{
                    fontSize: 13.5,
                    color: v2.ink,
                    fontWeight: 500,
                    lineHeight: 1.45,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {s}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* THE BLOCK YOU SAW COMING — the user's own obstacle / premortem */}
      {vm.obstacle && (
        <Section title="the block you saw coming">
          <div
            style={{
              boxSizing: 'border-box',
              background: '#F3EEE3',
              borderRadius: 14,
              padding: '15px 16px',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              in your words, when you set this
            </div>
            <div
              style={{
                fontSize: 14.5,
                color: v2.ink,
                fontWeight: 500,
                lineHeight: 1.5,
                letterSpacing: '-0.01em',
                fontStyle: 'italic',
              }}
            >
              &ldquo;{vm.obstacle}&rdquo;
            </div>
          </div>
        </Section>
      )}

      {/* THE CONTRACT — a Ulysses contract the user set */}
      {vm.contract && (
        <Section title="a note to your future self">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                background: '#F3E4D3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <IconContract size={12} stroke={v2.umber} />
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: 500,
                  lineHeight: 1.5,
                  letterSpacing: '-0.01em',
                }}
              >
                &ldquo;{vm.contract}&rdquo;
              </div>
              {vm.contractWhen && (
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 12,
                    color: v2.mute,
                    fontWeight: 500,
                  }}
                >
                  a contract you wrote &middot; {vm.contractWhen}
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* the soft footer — calm routes. dropping a goal is unshamed. */}
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column' }}>
        <FootRow
          first
          label="a soft check-in"
          sub="sit with it for a minute"
          onOpen={() => onReview(vm.id)}
        />
        <FootRow
          label="park it for a while"
          sub={vm.rested ? 'already at rest' : 'come back when it fits'}
          dim={vm.rested}
          onOpen={park}
        />
        <FootRow
          last
          drop
          label="let this goal go"
          sub="no explaining, no verdict"
          onOpen={release}
        />
      </div>

      {done && (
        <div
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 13,
            color: v2.sage,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          {done === 'parked'
            ? 'parked. it will be here when it fits.'
            : 'let go. no verdict — that took clarity.'}
        </div>
      )}
    </Screen>
  );
}

// ─── a milestone row ─────────────────────────────────────────────────────────

interface MilestoneRowProps {
  milestone: GoalMilestoneVM;
  onToggle: () => void;
}

function MilestoneRow({ milestone, onToggle }: MilestoneRowProps) {
  const { label, done, isNext } = milestone;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      aria-label={done ? `mark "${label}" open` : `mark "${label}" done`}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        border: 'none',
        padding: 0,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: done ? v2.sage : 'transparent',
          border: done
            ? 'none'
            : `1.7px solid ${isNext ? v2.umber : v2.mute}`,
        }}
      >
        {done && <IconCheck size={10} weight={3.4} stroke="#fff" />}
      </span>
      <span style={{ flex: 1 }}>
        <span
          style={{
            display: 'block',
            fontSize: 14.5,
            color: done ? '#7A726A' : v2.ink,
            fontWeight: isNext ? 600 : 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.4,
          }}
        >
          {label}
        </span>
        {isNext && (
          <span
            style={{
              display: 'block',
              marginTop: 3,
              fontSize: 12,
              color: v2.umber,
              fontWeight: 600,
            }}
          >
            the next one &mdash; whenever it&rsquo;s ready
          </span>
        )}
      </span>
    </button>
  );
}

// ─── a titled section on a hairline rule ─────────────────────────────────────

function Section({ title, children }: { title: string; children: import('react').ReactNode }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        marginTop: 28,
        borderTop: `1px solid ${v2.line}`,
        padding: '20px 2px 0',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── a soft footer route row ─────────────────────────────────────────────────

interface FootRowProps {
  label: string;
  sub: string;
  onOpen: () => void;
  first?: boolean;
  last?: boolean;
  /** the let-it-go row — sage, calm, permission-giving */
  drop?: boolean;
  /** dim the row (an already-rested goal) */
  dim?: boolean;
}

function FootRow({ label, sub, onOpen, first, last, drop, dim }: FootRowProps) {
  return (
    <button
      type="button"
      onClick={dim ? undefined : onOpen}
      disabled={dim}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        marginTop: first ? 0 : 0,
        padding: '15px 2px',
        display: 'flex',
        alignItems: 'center',
        cursor: dim ? 'default' : 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 14,
          color: dim ? v2.mute : drop ? v2.sage : v2.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, marginLeft: 9 }}>
        {sub}
      </span>
      <span aria-hidden style={{ display: 'inline-flex', marginLeft: 8, flexShrink: 0 }}>
        <IconChevronRight stroke={drop ? v2.sage : v2.mute} />
      </span>
    </button>
  );
}
