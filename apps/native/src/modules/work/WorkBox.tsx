/**
 * WorkBox · /box/work screen.
 *
 * Editorial layout ported from the redesign/money-v2 web `WorkFaceScreen`
 * (apps/web/src/modules/work-v2/screens/WorkFaceScreen.tsx). The face is a
 * single tall preview block sitting between two hairline rules — a stack
 * glyph in the gutter, a SMCP "work" kicker + glance line at the head,
 * and the day's three quiet sections in the body:
 *
 *   - today      · focus minutes for the current local day + last task done
 *   - tasks      · open (and recently closed) checkable rows
 *   - deadlines  · upcoming, soonest first
 *   - recent events · last few focus / meeting / distraction entries
 *
 * Auto-refreshes on focus + every 6s — kept verbatim from the previous
 * version (there's no observable layer over SQLite yet).
 *
 * Storage layer is untouched: the screen calls `tasks` / `events` from
 * `./repo` plus `migrateWork` from `./migrate`. Translation only happens at
 * the visual layer (tailwind → inline styles + tokens; framer-motion → CSS
 * transitions; safe-area-inset omitted; mobile bottom-sheet patterns
 * inlined for desktop-first Tauri).
 */

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors } from '../../theme/tokens';
import { migrateWork } from './migrate';
import { tasks as tasksRepo, events as eventsRepo } from './repo';
import type { WorkEvent, WorkTask } from './types';

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;

interface TodaySnapshot {
  focusMinutes: number;
  lastDone: WorkTask | null;
}

export function WorkBox(): JSX.Element {
  const [allTasks, setAllTasks] = useState<WorkTask[]>([]);
  const [deadlines, setDeadlines] = useState<WorkTask[]>([]);
  const [recentEvents, setRecentEvents] = useState<WorkEvent[]>([]);
  const [today, setToday] = useState<TodaySnapshot>({
    focusMinutes: 0,
    lastDone: null,
  });
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const { fromMs, toMs } = todayWindow();
    const [t, d, e, focusMin, lastDone] = await Promise.all([
      tasksRepo.list(),
      tasksRepo.listDeadlines(),
      eventsRepo.list(20),
      eventsRepo.focusMinutesBetween(fromMs, toMs),
      tasksRepo.lastDone(),
    ]);
    setAllTasks(t);
    setDeadlines(d);
    setRecentEvents(e);
    setToday({ focusMinutes: focusMin, lastDone });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateWork();
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      void refresh();
    }, POLL_MS);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const handleToggleTask = useCallback(
    async (id: string) => {
      await tasksRepo.toggleDone(id);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveTask = useCallback(
    async (id: string) => {
      await tasksRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveEvent = useCallback(
    async (id: string) => {
      await eventsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  // Tasks section excludes deadlines (those have their own surface).
  const taskRows = allTasks.filter((t) => t.kind === 'task');
  const isEmpty =
    taskRows.length === 0 &&
    deadlines.length === 0 &&
    recentEvents.length === 0 &&
    today.focusMinutes === 0 &&
    !today.lastDone;

  // The glance line above the body — first phrase reads as the lead, second
  // half is the calm tail. Mirrors the v2 face's `glanceLead — glanceTail`.
  const glance = buildGlance({
    ready,
    isEmpty,
    today,
    taskCount: taskRows.length,
    deadlineCount: deadlines.length,
  });

  return (
    <Stack gap={48}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text scale="display">Work</Text>
      </Stack>

      {/* THE WORK CARD — a tall preview block sitting between hairline rules.
          The v2 face's `borderTop / borderBottom` + 24/26 vertical padding
          ports straight over; the gutter (62px) holds the matter-stack glyph
          and the body sits in the rest. */}
      <div
        style={{
          boxSizing: 'border-box',
          borderTop: `1px solid ${colors.hairline}`,
          borderBottom: `1px solid ${colors.hairline}`,
          padding: '24px 2px 26px',
        }}
      >
        {/* card head — gutter glyph + glance line */}
        <Row gap={16} align="center" style={{ width: '100%' }}>
          <span
            style={{
              width: 62,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <WorkStackGlyph />
          </span>
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
              {glance.kicker}
            </Text>
            <Text scale="body">
              <b style={{ fontWeight: 600 }}>{glance.lead}</b>
              {glance.tail ? ` — ${glance.tail}` : null}
            </Text>
          </Stack>
        </Row>

        {/* card body — the three sections, indented to align under the glance
            line (matches the v2 face's 78px gutter offset = 62 glyph + 16 gap). */}
        <div style={{ marginTop: 18, marginLeft: 78 }}>
          {!ready ? (
            <Text scale="caption" color={colors.inkFaint}>
              loading…
            </Text>
          ) : isEmpty ? (
            <Text scale="body" color={colors.inkFaint}>
              nothing yet — try dumping &lsquo;pomodoro done&rsquo; or
              &lsquo;send invoice&rsquo;
            </Text>
          ) : (
            <Stack gap={28}>
              <TodaySection snapshot={today} />

              <ListSection
                label="tasks"
                empty="no open tasks — try dumping 'send invoice'"
                items={taskRows}
                renderItem={(item) => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    onToggle={() => void handleToggleTask(item.id)}
                    onRemove={() => void handleRemoveTask(item.id)}
                  />
                )}
              />

              <ListSection
                label="deadlines"
                empty="no deadlines noted"
                items={deadlines}
                renderItem={(item) => (
                  <DeadlineRow
                    key={item.id}
                    item={item}
                    onToggle={() => void handleToggleTask(item.id)}
                    onRemove={() => void handleRemoveTask(item.id)}
                  />
                )}
              />

              <ListSection
                label="recent events"
                empty="nothing logged yet"
                items={recentEvents}
                renderItem={(item) => (
                  <EventRow
                    key={item.id}
                    event={item}
                    onRemove={() => void handleRemoveEvent(item.id)}
                  />
                )}
              />
            </Stack>
          )}
        </div>
      </div>

      {/* The closing sage note — calm in-voice line about how the box stays
          fed. Mirrors the v2 face's sage-dot tail; passive (no CTA), because
          everything in the work box arrives from the dump router. */}
      <Row gap={9} align="start" style={{ padding: '0 2px' }}>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: colors.sage,
            flexShrink: 0,
            marginTop: 8,
          }}
        />
        <Text scale="body" color={colors.inkSoft} style={{ lineHeight: 1.5 }}>
          tasks, deadlines, and focus aren&rsquo;t logged by hand — when you
          throw something at ollie, the work box notices.
        </Text>
      </Row>
    </Stack>
  );
}

// ─── sections ─────────────────────────────────────────────────────────────

function TodaySection({ snapshot }: { snapshot: TodaySnapshot }): JSX.Element {
  const { focusMinutes, lastDone } = snapshot;
  return (
    <Stack gap={12}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        today
      </Text>
      <Stack gap={4}>
        <Text scale="body">
          {focusMinutes > 0
            ? `${focusMinutes} min focused`
            : 'no focus logged yet'}
        </Text>
        <Text scale="caption" color={colors.inkFaint}>
          {lastDone ? `last done · ${lastDone.text}` : 'no task closed yet'}
        </Text>
      </Stack>
    </Stack>
  );
}

function ListSection<T>({
  label,
  empty,
  items,
  renderItem,
}: {
  label: string;
  empty: string;
  items: T[];
  renderItem: (item: T) => JSX.Element;
}): JSX.Element {
  return (
    <Stack gap={12}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {label}
      </Text>
      {items.length === 0 ? (
        <Text scale="body" color={colors.inkFaint}>
          {empty}
        </Text>
      ) : (
        <Stack gap={6}>{items.map(renderItem)}</Stack>
      )}
    </Stack>
  );
}

// ─── rows ─────────────────────────────────────────────────────────────────

function TaskRow({
  item,
  onToggle,
  onRemove,
}: {
  item: WorkTask;
  onToggle: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Row gap={12} align="baseline">
        <Checkbox checked={item.done} onClick={onToggle} />
        <Text
          scale="body"
          color={item.done ? colors.inkFaint : undefined}
          style={item.done ? { textDecoration: 'line-through' } : undefined}
        >
          {item.text}
          {item.project && (
            <Text
              as="span"
              scale="caption"
              color={colors.inkFaint}
              style={{ marginLeft: 8 }}
            >
              · {item.project}
            </Text>
          )}
        </Text>
      </Row>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function DeadlineRow({
  item,
  onToggle,
  onRemove,
}: {
  item: WorkTask;
  onToggle: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Row gap={12} align="baseline">
        <Checkbox checked={item.done} onClick={onToggle} />
        <Text
          scale="body"
          color={item.done ? colors.inkFaint : undefined}
          style={item.done ? { textDecoration: 'line-through' } : undefined}
        >
          {item.text}
          {item.dueDate && (
            <Text
              as="span"
              scale="caption"
              color={colors.inkFaint}
              style={{ marginLeft: 8 }}
            >
              · due {item.dueDate}
            </Text>
          )}
        </Text>
      </Row>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function EventRow({
  event,
  onRemove,
}: {
  event: WorkEvent;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">
        {formatEvent(event)}
        <Text
          as="span"
          scale="caption"
          color={colors.inkFaint}
          style={{ marginLeft: 8 }}
        >
          · {formatRelative(event.loggedAt)}
        </Text>
      </Text>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function Checkbox({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={checked ? 'mark undone' : 'mark done'}
      aria-pressed={checked}
      style={{
        appearance: 'none',
        background: checked ? colors.sageSoft : 'transparent',
        border: `1px solid ${colors.sageSoft}`,
        width: 14,
        height: 14,
        padding: 0,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    />
  );
}

function RemoveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label="remove"
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 8px',
        color: colors.inkFaint,
        cursor: 'pointer',
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
      }}
    >
      remove
    </button>
  );
}

// ─── stack glyph ──────────────────────────────────────────────────────────

/**
 * The work-stack glyph — three overlapping file tabs. Mirrors `MatterStack`
 * from work-v2/glyphs.tsx, retuned to native tokens (sage-soft stroke,
 * paper fill on the front tab). Decorative; sits in the card gutter.
 */
function WorkStackGlyph(): JSX.Element {
  const stroke = colors.sageSoft;
  const fill = colors.paper;
  return (
    <svg width={50} height={46} viewBox="0 0 50 46" aria-hidden>
      <path
        fill="none"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinejoin="round"
        d="M12 13h14l3 3h13v22a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2z"
      />
      <path
        fill="none"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinejoin="round"
        d="M9 19h14l3 3h13v22a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V21a2 2 0 0 1 2-2z"
      />
      <path
        fill={fill}
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinejoin="round"
        d="M6 25h14l3 3h13v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V27a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}

// ─── glance line ──────────────────────────────────────────────────────────

interface GlanceInput {
  ready: boolean;
  isEmpty: boolean;
  today: TodaySnapshot;
  taskCount: number;
  deadlineCount: number;
}

interface Glance {
  kicker: string;
  lead: string;
  tail: string | null;
}

/**
 * Build the head's three-part glance: a SMCP kicker ("work"), a bold lead
 * phrase (the headline of the day's state), and a calm tail. Empty + loading
 * states fall back to a single lead with no tail. Mirrors the v2 face's
 * `glanceLead / glanceTail` shape.
 */
function buildGlance({
  ready,
  isEmpty,
  today,
  taskCount,
  deadlineCount,
}: GlanceInput): Glance {
  if (!ready) {
    return { kicker: 'work', lead: 'reading the box', tail: null };
  }
  if (isEmpty) {
    return {
      kicker: 'work',
      lead: 'nothing in the box',
      tail: 'throw something at ollie',
    };
  }
  const leadParts: string[] = [];
  if (taskCount > 0) leadParts.push(`${taskCount} ${plural(taskCount, 'task')}`);
  if (deadlineCount > 0) {
    leadParts.push(`${deadlineCount} ${plural(deadlineCount, 'deadline')}`);
  }
  const lead = leadParts.length > 0 ? leadParts.join(' · ') : 'a quiet day';
  const tailBits: string[] = [];
  if (today.focusMinutes > 0) {
    tailBits.push(`${today.focusMinutes} min focused today`);
  }
  if (today.lastDone) {
    tailBits.push(`last done · ${today.lastDone.text}`);
  }
  const tail = tailBits.length > 0 ? tailBits.join(' · ') : null;
  return { kicker: 'work', lead, tail };
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

// ─── formatting ───────────────────────────────────────────────────────────

function formatEvent(event: WorkEvent): string {
  const d = event.data;
  if (d.kind === 'focus_session') {
    const mins = d.durationMin != null ? `${d.durationMin} min` : 'focus';
    const proj = d.project ? ` · ${d.project}` : '';
    return `focus · ${mins}${proj}`;
  }
  if (d.kind === 'meeting') {
    const who = d.with ?? 'meeting';
    const mins = d.durationMin != null ? ` · ${d.durationMin} min` : '';
    return `meeting · ${who}${mins}`;
  }
  return `distraction · ${d.what}`;
}

/** Loose relative-time formatter — minutes, hours, days. */
function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** [start, end) ms window for the user's local day. */
function todayWindow(): { fromMs: number; toMs: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}
