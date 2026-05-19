/**
 * goals-v2 · GoalsFace — the goals submodule face (Level 2)
 *
 * One face, two states — picked by `faceVM().hasAnyGoal`:
 *
 *   goals.html      — a focus goal exists → the LEAF-FOCUS hero: one goal
 *                     in a soft 270° open progress arc, its next milestone,
 *                     swipe dots for this-of-N, an amber "open this goal",
 *                     and calm drill rows below.
 *   goals-cold.html — no goals yet → an EMPTY arc with a seed glyph, a kind
 *                     "no goals yet — a clean slate, not a gap" line, a
 *                     sage invitation, an amber "add your first", and a
 *                     quiet worked-example list. Never a guilt-zero.
 *
 * TONE — goals + ADHD is a shame minefield, so the face is forward and
 * kind: progress, never a streak; the next step, never a backlog. The
 * cold state is framed as a clean slate, never a deficit.
 *
 * Real data: every line comes from `selectors.ts` over the live `goals.*`
 * slices via `useGoalsSlices`. The drill rows route to the leaf screens.
 */
import { useMemo, useState } from 'react';
import {
  Screen,
  NavRow,
  AmberButton,
  GoalArc,
  IconPlus,
  IconChevronRight,
  IconSeed,
  IconCap,
  IconHeart,
  IconBrush,
  v2,
} from '../../money-v2/v2';
import { useGoalsSlices } from '../useGoalsSlices';
import { faceVM, type FocusGoalVM } from '../selectors';
import type { GoalsRoute } from '../GoalsApp';

export interface GoalsFaceProps {
  now: number;
  navigate: (to: GoalsRoute) => void;
  onOpenGoal: (id: string) => void;
  onReview: (id: string) => void;
  onSafe: () => void;
}

export function GoalsFace({
  now,
  navigate,
  onOpenGoal,
  onReview,
  onSafe,
}: GoalsFaceProps) {
  const slices = useGoalsSlices();
  const face = useMemo(() => faceVM(slices, now), [slices, now]);
  // which goal in the deck is in focus — the swipe index
  const [focus, setFocus] = useState(0);

  const cold = !face.hasAnyGoal || face.deck.length === 0;
  const idx = Math.min(focus, Math.max(0, face.deck.length - 1));
  const goal = cold ? null : face.deck[idx];

  return (
    <Screen label="goals" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {goal ? (
          <FocusHero
            goal={goal}
            index={idx}
            total={face.deck.length}
            onFocus={setFocus}
            onOpen={() => onOpenGoal(goal.id)}
          />
        ) : (
          <ColdHero onAdd={() => navigate('add')} />
        )}
      </div>

      {/* a worked example — only on the cold face, so it's never barren */}
      {cold && <ColdExample />}

      {/* DRILL ROWS — present once a goal exists */}
      {goal && (
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column' }}>
          <NavRow
            first
            rowKey="your goals"
            value={
              face.deck.length === 1
                ? 'this is your only goal right now'
                : `${face.deck.length - 1} more — swipe to see them`
            }
            dim={face.deck.length === 1}
            onOpen={() => onOpenGoal(goal.id)}
          />
          <NavRow
            rowKey="a check-in"
            value={face.reviewLine ?? `sit with ${goal.name} for a minute`}
            last={!face.patternLine}
            onOpen={() => onReview(goal.id)}
          />
          {/* the observed-pattern row — only present when a pattern is live */}
          {face.patternLine && (
            <NavRow
              flag
              last
              rowKey="see the rest"
              value={face.patternLine}
              onOpen={() => navigate('patterns')}
            />
          )}
        </div>
      )}

      {/* a calm add cue — never pressured, never a "you should have more" */}
      {goal && (
        <button
          type="button"
          onClick={() => navigate('add')}
          style={{
            marginTop: 24,
            alignSelf: 'center',
            background: 'transparent',
            border: 'none',
            fontSize: 13,
            color: v2.accent,
            fontWeight: 600,
            letterSpacing: '0.01em',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          + add a goal
        </button>
      )}

      {/* a quiet way to preview the notification voice */}
      <button
        type="button"
        onClick={() => navigate('notifications')}
        style={{
          marginTop: goal ? 22 : 28,
          alignSelf: 'center',
          background: 'transparent',
          border: 'none',
          fontSize: 12,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        what goals sends &mdash; and what it never does
      </button>
    </Screen>
  );
}

// ─── the focus hero (goals.html) ─────────────────────────────────────────────

interface FocusHeroProps {
  goal: FocusGoalVM;
  index: number;
  total: number;
  onFocus: (i: number) => void;
  onOpen: () => void;
}

function FocusHero({ goal, index, total, onFocus, onOpen }: FocusHeroProps) {
  return (
    <>
      {/* the focus goal — a soft 270° open progress arc */}
      <GoalArc pct={goal.pct} label={goal.category || undefined} />

      {/* the goal name — under the arc, calm and large */}
      <div
        style={{
          marginTop: 20,
          fontSize: 26,
          fontWeight: 400,
          color: v2.ink,
          letterSpacing: '-0.022em',
          textAlign: 'center',
        }}
      >
        {goal.name}
      </div>

      {/* the next milestone — one calm forward line, never a deadline scold */}
      <div
        style={{
          marginTop: 9,
          fontSize: 14,
          color: v2.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          textAlign: 'center',
          maxWidth: 300,
        }}
      >
        {goal.nextLabel ? (
          <>
            next milestone &mdash;{' '}
            <b style={{ fontWeight: 600 }}>{goal.nextLabel}</b>
            <span style={{ color: v2.mute, fontWeight: 500 }}>
              {' '}&middot; whenever it&rsquo;s ready
            </span>
          </>
        ) : (
          <span style={{ color: v2.mute, fontWeight: 500 }}>
            no milestones set &mdash; open the goal to add one
          </span>
        )}
      </div>

      {/* the swipe dots — this goal of N */}
      {total > 1 && (
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 7 }}>
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`focus goal ${i + 1} of ${total}`}
              aria-current={i === index}
              onClick={() => onFocus(i)}
              style={{
                width: 6,
                height: 6,
                padding: 0,
                borderRadius: '50%',
                border: 'none',
                background: i === index ? v2.accent : v2.line,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            />
          ))}
        </div>
      )}

      {/* one amber button — open this goal */}
      <AmberButton
        icon={<IconChevronRight size={17} weight={2.2} stroke="#fff" />}
        onClick={onOpen}
        style={{ marginTop: 24, height: 50, borderRadius: 25 }}
      >
        open this goal
      </AmberButton>
    </>
  );
}

// ─── the cold hero (goals-cold.html) ─────────────────────────────────────────

interface ColdHeroProps {
  onAdd: () => void;
}

function ColdHero({ onAdd }: ColdHeroProps) {
  return (
    <>
      {/* the empty progress ring — a calm shape waiting, never a zero */}
      <GoalArc pct={null} label="nothing growing yet">
        <span aria-hidden style={{ display: 'inline-flex' }}>
          <IconSeed size={34} stroke={v2.mute} />
        </span>
      </GoalArc>

      <div
        style={{
          marginTop: 22,
          fontSize: 21,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          textAlign: 'center',
          lineHeight: 1.4,
          maxWidth: 300,
        }}
      >
        <b style={{ fontWeight: 500 }}>no goals yet</b> &mdash; a clean slate,
        not a gap
      </div>

      <div
        style={{
          marginTop: 14,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          maxWidth: 312,
          padding: '0 4px',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: v2.sage,
            flexShrink: 0,
            marginTop: 5,
          }}
        />
        <span
          style={{
            fontSize: 13.5,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.55,
            textAlign: 'left',
          }}
        >
          this is where the bigger things live &mdash;{' '}
          <b style={{ fontWeight: 600 }}>
            ollie holds the milestones, the block you saw coming, and a soft
            check-in now and then.
          </b>{' '}
          add one when you&rsquo;re ready, none before.
        </span>
      </div>

      <AmberButton
        icon={<IconPlus size={18} />}
        onClick={onAdd}
        style={{ marginTop: 28, height: 50, borderRadius: 25 }}
      >
        add your first
      </AmberButton>
    </>
  );
}

// ─── the cold worked example (goals-cold.html) ───────────────────────────────

const EXAMPLE_ROWS: { name: string; cat: string; glyph: 'cap' | 'health' | 'creative' }[] = [
  { name: 'learn a language', cat: 'learning', glyph: 'cap' },
  { name: 'run a half marathon', cat: 'health', glyph: 'health' },
  { name: 'finish the side project', cat: 'creative', glyph: 'creative' },
];

function ExampleGlyph({ kind }: { kind: 'cap' | 'health' | 'creative' }) {
  if (kind === 'cap') return <IconCap size={15} stroke={v2.mute} />;
  if (kind === 'health') return <IconHeart size={15} stroke={v2.mute} />;
  return <IconBrush size={15} stroke={v2.mute} />;
}

function ColdExample() {
  return (
    <>
      <div style={{ marginTop: 42, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          the kinds of things that live here
        </div>
        {EXAMPLE_ROWS.map((eg, i) => (
          <div
            key={eg.name}
            style={{
              boxSizing: 'border-box',
              borderTop: `1px solid ${v2.line}`,
              borderBottom: i === EXAMPLE_ROWS.length - 1 ? `1px solid ${v2.line}` : 'none',
              padding: '14px 2px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: '#F1ECE1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ExampleGlyph kind={eg.glyph} />
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {eg.name}
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: 11.5,
                  color: v2.mute,
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                }}
              >
                {eg.cat}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* the closing note — the slate is clean, not empty */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: v2.line,
            flexShrink: 0,
            marginTop: 5,
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.55,
          }}
        >
          no goal is required to use ollie. starting with none isn&rsquo;t
          behind &mdash; it&rsquo;s just the beginning of the page.
        </span>
      </div>
    </>
  );
}
