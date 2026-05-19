/**
 * admin-v2 · TasksScreen — the full task list (admin-tasks.html)
 *
 * The full task list — every task ONE quiet hairline row, no card, no
 * shadow. Ordered by days-left. A calm 3-segment filter (active / done /
 * all) with live counts rides the top, the active segment underlined amber.
 * Each row carries a quiet ball-state mark (MINE = filled ink square,
 * THEIRS = open umber square, WAITING = open mute square). One amber
 * "add a task" floats at the bottom.
 *
 * Real data: `tasksVM` over the live `admin.tasks` slice via `useAdminSlices`.
 * Tapping a row opens the task detail; the filter is local screen state.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconPlus, v2 } from '../../money-v2/v2';
import { useAdminSlices } from '../useAdminSlices';
import { tasksVM, type TaskFilter, type BallTag } from '../selectors';

export interface TasksScreenProps {
  now: number;
  onBack: () => void;
  onOpenTask: (id: string) => void;
  onAdd: () => void;
  onSafe: () => void;
}

export function TasksScreen({ now, onBack, onOpenTask, onAdd, onSafe }: TasksScreenProps) {
  const slices = useAdminSlices();
  const [filter, setFilter] = useState<TaskFilter>('active');
  const vm = useMemo(() => tasksVM(slices, filter, now), [slices, filter, now]);

  return (
    <Screen
      label="all tasks"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      <div style={{ marginTop: 44 }}>
        {/* the filter — 3 calm text segments, live counts, near-zero chrome */}
        <div style={{ display: 'flex', gap: 22, paddingBottom: 4 }}>
          <FilterSeg
            label="active"
            count={vm.counts.active}
            on={filter === 'active'}
            onClick={() => setFilter('active')}
          />
          <FilterSeg
            label="done"
            count={vm.counts.done}
            on={filter === 'done'}
            onClick={() => setFilter('done')}
          />
          <FilterSeg
            label="all"
            count={vm.counts.all}
            on={filter === 'all'}
            onClick={() => setFilter('all')}
          />
        </div>

        {/* the task rows */}
        {vm.rows.length === 0 ? (
          <div
            style={{
              marginTop: 30,
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
                color: v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
                lineHeight: 1.5,
              }}
            >
              {filter === 'done'
                ? "nothing's been closed off yet — it'll gather here as you finish things."
                : 'nothing on the list yet. add the first thing below.'}
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 0, display: 'flex', flexDirection: 'column' }}>
            {vm.rows.map((row, i) => (
              <TaskListRow
                key={row.id}
                title={row.title}
                sub={row.sub}
                ball={row.ball}
                daysLine={row.daysLine}
                soon={row.soon}
                done={row.done}
                last={i === vm.rows.length - 1}
                onOpen={() => onOpenTask(row.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AmberButton
        block
        icon={<IconPlus size={20} />}
        onClick={onAdd}
        style={{ marginTop: 30, height: 50, borderRadius: 25 }}
      >
        add a task
      </AmberButton>
    </Screen>
  );
}

// ─── the filter segment ──────────────────────────────────────────────────────

interface FilterSegProps {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}

function FilterSeg({ label, count, on, onClick }: FilterSegProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        boxSizing: 'border-box',
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${on ? v2.accent : 'transparent'}`,
        padding: '0 0 7px',
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        color: on ? v2.ink : v2.mute,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}{' '}
      <b style={{ fontWeight: 600, color: on ? v2.accent : v2.mute }}>{count}</b>
    </button>
  );
}

// ─── the ball-state mark ─────────────────────────────────────────────────────

interface BallMarkProps {
  ball: BallTag;
  /** a done task overrides the mark to a calm sage square */
  done: boolean;
}

/** the quiet ball-state mark — a small square, not a badge */
function BallMark({ ball, done }: BallMarkProps) {
  let style: React.CSSProperties;
  if (done) {
    style = { background: v2.sage };
  } else if (ball === 'MINE') {
    style = { background: v2.ink };
  } else if (ball === 'THEIRS') {
    style = { background: 'transparent', border: '1.8px solid #A8703C' };
  } else {
    style = { background: 'transparent', border: `1.8px solid ${v2.mute}` };
  }
  return (
    <span
      aria-hidden
      style={{
        boxSizing: 'border-box',
        width: 11,
        height: 11,
        borderRadius: 3,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// ─── one task row ────────────────────────────────────────────────────────────

interface TaskListRowProps {
  title: string;
  sub: string;
  ball: BallTag;
  daysLine: string;
  soon: boolean;
  done: boolean;
  last: boolean;
  onOpen: () => void;
}

function TaskListRow({ title, sub, ball, daysLine, soon, done, last, onOpen }: TaskListRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '17px 2px',
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <BallMark ball={ball} done={done} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span
          style={{
            fontSize: 15,
            color: done ? v2.mute : v2.ink,
            fontWeight: done ? 400 : 500,
            letterSpacing: '-0.012em',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {sub}
        </span>
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: done ? 500 : 600,
          letterSpacing: '-0.01em',
          color: done ? v2.sage : soon ? '#A8703C' : v2.mute,
          flexShrink: 0,
        }}
      >
        {daysLine}
      </span>
    </button>
  );
}
