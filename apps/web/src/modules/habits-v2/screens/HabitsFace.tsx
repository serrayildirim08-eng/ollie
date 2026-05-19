/**
 * habits-v2 · HabitsFace — the habits submodule page (Level 2)
 *
 * Mirrors habits.html (the day has a shape → the SINGLE next check-in is
 * the hero: one big tap-circle, the habit large with its cue, the 270°
 * progress arc + the waiting-dot row, an "add a habit" amber button, and
 * two calm drill rows) and habits-cold.html (first run → ollie's 6 seeded
 * habits already give the day a shape; the first is held up as the next
 * check-in, with a sage invitation naming them). One face, two states —
 * picked by `habitsFaceVM().hasHistory`.
 *
 * Core principle: ONE focus per screen, NO streak, NO grid wall, NO
 * "you missed" — the progress arc is a calm ledger, the dot row counts
 * what waits.
 *
 * Real data: every line comes from `selectors.ts` over the live
 * `shared.habits_v2` + `habits.patterns` slices via `useHabitsSlices`. The
 * tap-circle checks a real habit in through `useHabitsActions`.
 */
import { useMemo } from 'react';
import { Screen, NavRow, AmberButton, ProgressArc, IconPlus, v2 } from '../../money-v2/v2';
import { useHabitsSlices } from '../useHabitsSlices';
import { useHabitsActions } from '../useHabitsActions';
import { habitsFaceVM } from '../selectors';
import { TapCircle } from '../components/TapCircle';
import { WaitDots } from '../components/WaitDots';
import type { HabitsRoute } from '../HabitsApp';

export interface HabitsFaceProps {
  now: number;
  navigate: (to: HabitsRoute) => void;
  onSafe: () => void;
}

export function HabitsFace({ now, navigate, onSafe }: HabitsFaceProps) {
  const slices = useHabitsSlices();
  const actions = useHabitsActions(now);
  const face = useMemo(() => habitsFaceVM(slices, now), [slices, now]);

  return (
    <Screen
      label="habits"
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* THE HERO — the single next check-in */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {face.lead}
        </div>

        {/* the one tap-circle — checking this habit in */}
        <div style={{ marginTop: 30 }}>
          <TapCircle
            live={face.hasNext}
            label={face.hasNext ? face.nextName : undefined}
            onCheck={
              face.nextId
                ? () => actions.checkIn(face.nextId as string)
                : undefined
            }
          />
        </div>

        {/* the habit, large — and its cue, the anchor it hangs from */}
        <div
          style={{
            marginTop: 34,
            fontSize: 30,
            fontWeight: 400,
            color: v2.ink,
            letterSpacing: '-0.015em',
            lineHeight: 1.1,
            textAlign: 'center',
          }}
        >
          {face.nextName}
        </div>
        {face.nextCue ? (
          <div
            style={{
              marginTop: 9,
              fontSize: 14,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '0.01em',
            }}
          >
            <CueLine cue={face.nextCue} />
          </div>
        ) : (
          face.hasNext && (
            <div
              style={{
                marginTop: 9,
                fontSize: 14,
                color: v2.mute,
                fontWeight: 500,
              }}
            >
              no cue set
            </div>
          )
        )}

        {/* the progress — a 270° open arc + the waiting-dot row */}
        <div
          style={{
            marginTop: 34,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <ProgressArc
            done={face.doneCount}
            total={face.totalCount}
            label={face.centreLabel}
          />
          <WaitDots dots={face.waitDots} />
          <div
            style={{
              marginTop: 2,
              fontSize: 13,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {face.waitLine}
          </div>
        </div>

        {/* the cold invitation — only on first run, naming the seeded 6 */}
        {!face.hasHistory && (
          <div
            style={{
              marginTop: 22,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              maxWidth: 294,
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
                marginTop: 6,
              }}
            />
            <span
              style={{
                fontSize: 14,
                color: v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
                lineHeight: 1.45,
                textAlign: 'left',
              }}
            >
              ollie&rsquo;s left you{' '}
              <b style={{ fontWeight: 600 }}>
                {face.totalCount} small habits to start with
              </b>{' '}
              &mdash; brush teeth, water, vitamin d, move, evening meds, wind
              down. keep what fits, change the rest, add your own.
            </span>
          </div>
        )}

        {/* one amber button — add a habit */}
        <AmberButton
          icon={<IconPlus size={18} />}
          onClick={() => navigate('add')}
          style={{ marginTop: 30, height: 50, borderRadius: 25 }}
        >
          add a habit
        </AmberButton>
      </div>

      {/* THE DRILL ROWS — calm, with air */}
      <div style={{ marginTop: 46, display: 'flex', flexDirection: 'column' }}>
        <NavRow
          first
          rowKey="all habits"
          value={face.allLine}
          onOpen={() => navigate('all')}
        />
        <NavRow
          last
          flag={face.hasPattern}
          rowKey="see the rest"
          value={face.patternLine}
          dim={!face.hasPattern}
          onOpen={() => navigate('patterns')}
        />
      </div>

      {/* a quiet way to preview the notification voice */}
      <button
        type="button"
        onClick={() => navigate('notifications')}
        style={{
          marginTop: 28,
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
        what habits sends &mdash; and what it never does
      </button>

      {/* the closing reassurance — no streak waits on any of this */}
      <div
        style={{
          marginTop: 24,
          textAlign: 'center',
          fontSize: 12,
          color: v2.mute,
          fontWeight: 400,
          lineHeight: 1.55,
        }}
      >
        no streaks wait on any of these &mdash; a habit just waits, calmly, for
        its cue.
      </div>
    </Screen>
  );
}

/**
 * The cue line — "after coffee", with the anchor word in ink. The live
 * habits cues read as a phrase ("after coffee", "before the sun sets"); the
 * mockup bolds the last word as the concrete anchor.
 */
function CueLine({ cue }: { cue: string }) {
  const words = cue.trim().split(/\s+/);
  if (words.length <= 1) {
    return <b style={{ color: v2.ink, fontWeight: 600 }}>{cue}</b>;
  }
  const head = words.slice(0, -1).join(' ');
  const tail = words[words.length - 1];
  return (
    <>
      {head}{' '}
      <b style={{ color: v2.ink, fontWeight: 600 }}>{tail}</b>
    </>
  );
}
