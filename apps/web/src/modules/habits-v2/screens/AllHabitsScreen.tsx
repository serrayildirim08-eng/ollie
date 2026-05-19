/**
 * habits-v2 · AllHabitsScreen — all habits (habits-all.html)
 *
 * The full list, calm and ordered morning → anytime → evening. Each habit
 * is ONE quiet hairline-divided block: its name + a cue-time badge, the
 * cue under it, a soft row of recent-day dots, and a quiet "last · …"
 * recency note. NOT a grid, NOT a streak count — a soft record of recent
 * days. A filled sage dot is a day it happened; a faint line dot a day it
 * didn't; today is a calm open sage ring (still open, no rush).
 *
 * The closing note restates the frame: a gap is just a gap, the habit
 * waits for its cue.
 *
 * Real data: `allHabitsVM` over the live `shared.habits_v2` slice — the
 * recent dots are computed from each habit's real `completions` log.
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { useHabitsSlices } from '../useHabitsSlices';
import { allHabitsVM, type HabitRow, type RecentDot } from '../selectors';

export interface AllHabitsScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function AllHabitsScreen({ now, onBack, onSafe }: AllHabitsScreenProps) {
  const slices = useHabitsSlices();
  const vm = useMemo(() => allHabitsVM(slices, now), [slices, now]);

  return (
    <Screen
      label="all habits"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {!vm.hasHabits ? (
        <div
          style={{
            marginTop: 44,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
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
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            no habits on file yet &mdash; add one and it will gather here.
          </span>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 44 }}>
            {vm.sections.map((section) => (
              <div key={section.cueTime} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: v2.mute,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: 2,
                  }}
                >
                  {section.label}
                </div>
                {section.rows.map((row, i) => (
                  <HabitBlock
                    key={row.id}
                    row={row}
                    last={i === section.rows.length - 1}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* the closing note — a record, never a scoreboard */}
          <div
            style={{
              marginTop: 24,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
              <IconInfo size={15} stroke={v2.mute} />
            </span>
            <span
              style={{
                fontSize: 12,
                color: v2.mute,
                fontWeight: 400,
                lineHeight: 1.5,
              }}
            >
              a soft record of recent days &mdash; no streaks, no score. a
              gap is just a gap. the habit waits for its cue.
            </span>
          </div>
        </>
      )}
    </Screen>
  );
}

// ─── one habit block ─────────────────────────────────────────────────────────

function HabitBlock({ row, last }: { row: HabitRow; last: boolean }) {
  return (
    <div
      style={{
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '17px 2px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span
          style={{
            fontSize: 16,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.012em',
          }}
        >
          {row.name}
        </span>
        <span
          aria-hidden
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: v2.mute,
            border: `1px solid ${v2.line}`,
            borderRadius: 7,
            padding: '3px 7px',
            flexShrink: 0,
          }}
        >
          {row.badge}
        </span>
      </div>

      {row.cue && (
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 400,
            letterSpacing: '0.01em',
          }}
        >
          <CueLine cue={row.cue} />
        </div>
      )}

      {/* the recent check-ins — a soft row of sage dots */}
      <div
        style={{
          marginTop: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div aria-hidden style={{ display: 'flex', gap: 6 }}>
          {row.recent.map((dot, i) => (
            <RecentDotMark key={i} state={dot} />
          ))}
        </div>
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          last &middot;{' '}
          <b style={{ color: v2.sage, fontWeight: 600 }}>{row.last}</b>
        </span>
      </div>
    </div>
  );
}

function RecentDotMark({ state }: { state: RecentDot }) {
  const base = {
    boxSizing: 'border-box' as const,
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'block',
  };
  if (state === 'on') {
    return <span style={{ ...base, background: v2.sage }} />;
  }
  if (state === 'today') {
    // today — a calm open sage ring, "still open, no rush"
    return (
      <span
        style={{
          ...base,
          background: 'transparent',
          border: `1.5px solid ${v2.sage}`,
        }}
      />
    );
  }
  return <span style={{ ...base, background: v2.line }} />;
}

/** the cue line — "after coffee", anchor word in ink */
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
