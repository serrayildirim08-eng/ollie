/**
 * admin-v2 · BurstScreen — 2-min burst (admin-burst.html)
 *
 * A focused momentum session — ONE sub-2-minute task at a time. A quiet pip
 * strip counts the session (done = sage, current = amber, rest = faint);
 * the current task fills the focus with a soft 2-min countdown ring; tap
 * "done — next" and the next slides in. No list, no scroll, one focus. The
 * only way out is the swipe-down handle (no Find / Safe chrome competing).
 *
 * Real data + real logic: `burstVM` over the live `admin.tasks` slice
 * (the sub-2-min set `detectTwoMinuteTask` from `@ollie/logic/admin`
 * batches). "done — next" marks the real task done in the live store via
 * `useAdminActions.markDone`; "skip" advances the session without writing.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconCheck, v2 } from '../../money-v2/v2';
import { useAdminSlices } from '../useAdminSlices';
import { useAdminActions } from '../useAdminActions';
import { burstVM } from '../selectors';

export interface BurstScreenProps {
  now: number;
  onBack: () => void;
}

const RING = 132;
const RING_R = 58;
const RING_CIRC = 2 * Math.PI * RING_R; // ≈ 364.4

export function BurstScreen({ now, onBack }: BurstScreenProps) {
  const slices = useAdminSlices();
  const actions = useAdminActions(now);
  // the burst task list is snapshotted on mount so marking one done doesn't
  // re-shuffle the session under the user's feet
  const vm = useMemo(() => burstVM(slices, now), [slices, now]);

  // the session cursor + which indices were completed (vs skipped)
  const [idx, setIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);

  const total = vm.tasks.length;
  const finished = idx >= total;
  const current = finished ? null : vm.tasks[idx];

  const advance = () => setIdx((i) => i + 1);

  const completeCurrent = () => {
    if (current) actions.markDone(current.id);
    setDoneCount((c) => c + 1);
    advance();
  };

  // the empty / finished states
  if (total === 0 || finished) {
    return (
      <Screen label="2-min burst" onBack={onBack} centered>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              border: `1.5px solid ${v2.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 22,
            }}
          >
            <IconCheck size={20} stroke={v2.sage} />
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 300,
              color: v2.ink,
              letterSpacing: '-0.02em',
              lineHeight: 1.4,
            }}
          >
            {total === 0 ? (
              <>nothing under two minutes right now.</>
            ) : (
              <>
                <b style={{ fontWeight: 500 }}>that&rsquo;s the burst.</b>{' '}
                {doneCount} done.
              </>
            )}
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.6,
              maxWidth: 280,
            }}
          >
            {total === 0
              ? 'add a task with a tiny duration and it shows up here, ready for a momentum run.'
              : 'small things, cleared in one sitting. the rest of the list can wait.'}
          </div>
        </div>
      </Screen>
    );
  }

  // the live burst — one task in focus
  const remaining = 0.7; // a calm ~70%-remaining ring, decorative
  const fillLen = RING_CIRC * remaining;

  return (
    <Screen label="2-min burst" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the session progress — a quiet pip row */}
      <div
        style={{
          marginTop: 56,
          display: 'flex',
          justifyContent: 'center',
          gap: 9,
        }}
      >
        {vm.tasks.map((t, i) => (
          <span
            key={t.id}
            aria-hidden
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background:
                i < idx ? v2.sage : i === idx ? v2.accent : v2.line,
              boxShadow:
                i === idx ? '0 0 0 4px rgba(201,146,62,.16)' : 'none',
            }}
          />
        ))}
      </div>
      <div
        style={{
          marginTop: 14,
          textAlign: 'center',
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        task <b style={{ color: v2.ink, fontWeight: 600 }}>{idx + 1}</b> of {total}
        {doneCount > 0 && <> &middot; {doneCount} done</>}
      </div>

      {/* the current task — the one focus */}
      <div
        style={{
          marginTop: 50,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: RING,
            height: RING,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width={RING}
            height={RING}
            viewBox={`0 0 ${RING} ${RING}`}
            style={{ position: 'absolute' }}
            aria-hidden
          >
            <circle cx={66} cy={66} r={RING_R} fill="none" stroke={v2.line} strokeWidth={6} />
            <circle
              cx={66}
              cy={66}
              r={RING_R}
              fill="none"
              stroke={v2.accent}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={`${fillLen} ${RING_CIRC - fillLen}`}
              transform={`rotate(-90 66 66)`}
            />
          </svg>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <div
              style={{
                fontSize: 30,
                fontWeight: 300,
                color: v2.ink,
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              2
            </div>
            <div
              style={{
                fontSize: 11,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}
            >
              min
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 30,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          do this one now
        </div>
        <div
          style={{
            marginTop: 9,
            fontSize: 30,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.03em',
            lineHeight: 1.18,
            textAlign: 'center',
            maxWidth: 300,
          }}
        >
          {current!.title}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
            textAlign: 'center',
            maxWidth: 268,
          }}
        >
          the smallest move: start it, finish it, mark it. under two minutes,
          then it&rsquo;s gone.
        </div>

        <AmberButton
          icon={<IconCheck size={20} />}
          onClick={completeCurrent}
          style={{ marginTop: 34, height: 54, borderRadius: 27, padding: '0 34px' }}
        >
          done &mdash; next
        </AmberButton>

        <button
          type="button"
          onClick={advance}
          style={{
            marginTop: 18,
            background: 'transparent',
            border: 'none',
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          not now &mdash; skip to the next
        </button>
      </div>
    </Screen>
  );
}
