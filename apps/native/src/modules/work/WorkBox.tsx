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

import { useCallback, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  formatDays,
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row, Box } from '../../layout';
import { Text, Input, Button } from '../../ui';
import { colors } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateWork } from './migrate';
import {
  cadence as cadenceRepo,
  events as eventsRepo,
  handoffs as handoffsRepo,
  scheduledBlocks as scheduledBlocksRepo,
  tasks as tasksRepo,
} from './repo';
import type {
  WorkEvent,
  WorkHandoffNote,
  WorkScheduledBlock,
  WorkTask,
} from './types';
import { FocusTimer } from './FocusTimer';

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

interface TodaySnapshot {
  focusMinutes: number;
  lastDone: WorkTask | null;
}

export function WorkBox(): JSX.Element {
  const [allTasks, setAllTasks] = useState<WorkTask[]>([]);
  const [deadlines, setDeadlines] = useState<WorkTask[]>([]);
  const [recentEvents, setRecentEvents] = useState<WorkEvent[]>([]);
  const [blocks, setBlocks] = useState<WorkScheduledBlock[]>([]);
  const [openHandoffs, setOpenHandoffs] = useState<WorkHandoffNote[]>([]);
  const [taskCadence, setTaskCadence] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [today, setToday] = useState<TodaySnapshot>({
    focusMinutes: 0,
    lastDone: null,
  });

  const refresh = useCallback(async () => {
    const { fromMs, toMs } = todayWindow();
    const [t, d, e, focusMin, lastDone, blk, ho] = await Promise.all([
      tasksRepo.list(),
      tasksRepo.listDeadlines(),
      eventsRepo.list(20),
      eventsRepo.focusMinutesBetween(fromMs, toMs),
      tasksRepo.lastDone(),
      scheduledBlocksRepo.list(),
      handoffsRepo.listOpen(),
    ]);
    setAllTasks(t);
    setDeadlines(d);
    setRecentEvents(e);
    setToday({ focusMinutes: focusMin, lastDone });
    setBlocks(blk);
    setOpenHandoffs(ho);

    // Fan-out cadence reads — one per distinct task text touched by both
    // sections. Tasks dedupe by text within the open set; recurring chores
    // ("send invoice", "weekly check-in") produce real cadence rows once
    // toggled done + dumped again.
    const texts = new Set<string>();
    for (const row of [...t, ...d]) texts.add(row.text);
    const pairs = await Promise.all(
      Array.from(texts).map(
        async (txt) => [txt, await cadenceRepo.getTaskCadenceFor(txt)] as const,
      ),
    );
    setTaskCadence(new Map(pairs));
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'work',
    migrate: migrateWork,
    refresh,
  });

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

  const handleAddBlock = useCallback(
    async (input: { label: string | null; startTs: number }) => {
      await scheduledBlocksRepo.add({
        label: input.label,
        startTs: input.startTs,
      });
      await refresh();
    },
    [refresh],
  );

  const handleCancelBlock = useCallback(
    async (id: string) => {
      await scheduledBlocksRepo.cancel(id);
      await refresh();
    },
    [refresh],
  );

  const handleAddHandoff = useCallback(
    async (input: { text: string; project: string | null }) => {
      await handoffsRepo.add(input);
      await refresh();
    },
    [refresh],
  );

  const handleResolveHandoff = useCallback(
    async (id: string) => {
      await handoffsRepo.resolve(id);
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
    !today.lastDone &&
    blocks.length === 0 &&
    openHandoffs.length === 0;

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
        <Text
          scale="title"
          color={colors.ink}
          style={{
            fontFamily: 'var(--ollie-font-sans)',
            fontSize: '26px',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          work
        </Text>
      </Stack>

      {/* THE WORK CARD — a tall raised neumorphic block. The gutter (62px)
          holds the matter-stack glyph and the body sits in the rest. */}
      <Box
        bg="cream"
        radius="surface"
        shadow="raised"
        style={{ padding: '24px 20px 26px' }}
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
          {/* Focus timer — always visible, independent of data readiness */}
          <FocusTimer onSessionLogged={() => void refresh()} />

          {/* Capture: schedule a deep-work block + leave a hand-off note.
              Always visible (they are inputs), separated by a hairline. */}
          <div
            style={{
              marginTop: 32,
              paddingTop: 28,
              borderTop: `1px solid ${colors.hairlineSoft}`,
            }}
          >
            <Stack gap={28}>
              <ScheduleBlockSection
                blocks={blocks}
                onAdd={(i) => void handleAddBlock(i)}
                onCancel={(id) => void handleCancelBlock(id)}
              />
              <HandoffSection
                notes={openHandoffs}
                onAdd={(i) => void handleAddHandoff(i)}
                onResolve={(id) => void handleResolveHandoff(id)}
              />
            </Stack>
          </div>

          {/* Data sections — separated by a hairline */}
          <div
            style={{
              marginTop: 32,
              paddingTop: 28,
              borderTop: `1px solid ${colors.hairlineSoft}`,
            }}
          >
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
                    cadence={taskCadence.get(item.text)}
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
                    cadence={taskCadence.get(item.text)}
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

          {/* Layer-2 noticings — the work watcher's computed patterns
              (deep-focus hours, pacing breach, meeting cliff, …) surface here
              once focus_log has enough signal. Renders nothing when empty. */}
          <PatternCards module="work" />
        </div>
      </Box>

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
  cadence,
  onToggle,
  onRemove,
}: {
  item: WorkTask;
  cadence?: CadenceEstimate | undefined;
  onToggle: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Stack gap={2}>
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
      <WhenCaption ts={item.createdAt} style={{ marginLeft: 26 }} />
      {cadence && (
        <CadenceHint
          estimate={cadence}
          subject={item.text}
          style={{ marginLeft: 26 }}
        />
      )}
    </Stack>
  );
}

function DeadlineRow({
  item,
  cadence,
  onToggle,
  onRemove,
}: {
  item: WorkTask;
  cadence?: CadenceEstimate | undefined;
  onToggle: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Stack gap={2}>
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
      <WhenCaption ts={item.createdAt} style={{ marginLeft: 26 }} />
      {cadence && (
        <CadenceHint
          estimate={cadence}
          subject={item.text}
          style={{ marginLeft: 26 }}
        />
      )}
    </Stack>
  );
}

/**
 * Faint sub-line under a task / deadline row: "last send invoice 7 days
 * ago · usually every 14 days". Silent at low-data — Serra's minimal UI
 * prefers nothing to a misleading prediction. Recurring chores leave a
 * trail of created_at timestamps across rows; one-offs never trigger.
 */
function CadenceHint({
  estimate,
  subject,
  style,
}: {
  estimate: CadenceEstimate;
  subject: string;
  style?: CSSProperties;
}): JSX.Element | null {
  if (estimate.confidence === 'low-data' || estimate.lastTs == null) {
    return null;
  }
  const now = Date.now();
  const since = daysSinceLast(estimate, now) ?? 0;
  const every = medianIntervalDays(estimate);
  const sinceLabel = formatDays(since);
  const everyLabel = every >= 1 ? formatDays(every) : 'less than a day';
  return (
    <Text
      scale="caption"
      color={colors.inkFaint}
      style={{
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.06em',
        ...style,
      }}
    >
      {`last ${subject} ${sinceLabel} ago · usually every ${everyLabel}`}
    </Text>
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
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{formatEvent(event)}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
    </Stack>
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
        width: 24,
        height: 24,
        borderRadius: '50%',
        border: 'none',
        background: checked ? colors.sageDeep : colors.cream,
        boxShadow: checked
          ? 'none'
          : 'inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)',
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

// ─── schedule deep-work block ───────────────────────────────────────────────

/**
 * Capture a future deep-work block (optional label + start time) and see the
 * upcoming ones. Once booked, the bridge mirrors it into work.scheduled_blocks
 * and the orchestrator fires a reminder ahead of the start. Calm: a single
 * label field, a native datetime picker, one quiet "schedule" button.
 */
function ScheduleBlockSection({
  blocks,
  onAdd,
  onCancel,
}: {
  blocks: WorkScheduledBlock[];
  onAdd: (input: { label: string | null; startTs: number }) => void;
  onCancel: (id: string) => void;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [when, setWhen] = useState('');

  const submit = () => {
    if (!when) return;
    const ts = new Date(when).getTime();
    if (!Number.isFinite(ts)) return;
    onAdd({ label: label.trim() || null, startTs: ts });
    setLabel('');
    setWhen('');
  };

  // Only show blocks still in the future as "upcoming"; past ones drop off.
  const upcoming = blocks.filter((b) => b.startTs >= Date.now());

  return (
    <Stack gap={12}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        deep-work blocks
      </Text>
      <Stack gap={10}>
        <Input
          value={label}
          onChange={setLabel}
          placeholder="what — e.g. Q3 deck"
          label="block label"
          labelHidden
        />
        <Row gap={10} align="center">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            aria-label="start time"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              borderBottom: `1px solid ${colors.hairline}`,
              padding: '6px 2px',
              color: colors.ink,
              fontSize: 14,
              fontFamily: 'inherit',
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={submit}
            disabled={!when}
          >
            schedule
          </Button>
        </Row>
      </Stack>
      {upcoming.length === 0 ? (
        <Text scale="caption" color={colors.inkFaint}>
          none booked — ollie will nudge you before one starts
        </Text>
      ) : (
        <Stack gap={6}>
          {upcoming.map((b) => (
            <Row key={b.id} gap={12} align="baseline" justify="space-between">
              <Text scale="body">
                {b.label ?? 'deep work'}
                <Text
                  as="span"
                  scale="caption"
                  color={colors.inkFaint}
                  style={{ marginLeft: 8 }}
                >
                  · {formatBlockWhen(b.startTs)}
                </Text>
              </Text>
              <button
                onClick={() => onCancel(b.id)}
                aria-label="cancel block"
                style={GHOST_LINK_STYLE}
              >
                cancel
              </button>
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ─── hand-off notes ─────────────────────────────────────────────────────────

/**
 * Capture a hand-off — "asked Burhan to send the file" — against an optional
 * project, and resolve open ones. Capture + display only; no watcher consumes
 * hand-offs yet (see bridge.ts header), so this never feeds work.* — it's a
 * memory surface, intentionally.
 */
function HandoffSection({
  notes,
  onAdd,
  onResolve,
}: {
  notes: WorkHandoffNote[];
  onAdd: (input: { text: string; project: string | null }) => void;
  onResolve: (id: string) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [project, setProject] = useState('');

  const submit = () => {
    if (!text.trim()) return;
    onAdd({ text: text.trim(), project: project.trim() || null });
    setText('');
    setProject('');
  };

  return (
    <Stack gap={12}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        hand-offs
      </Text>
      <Stack gap={10}>
        <Input
          value={text}
          onChange={setText}
          placeholder="who you handed what to — e.g. asked Burhan to send the file"
          label="hand-off note"
          labelHidden
        />
        <Row gap={10} align="center">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input
              value={project}
              onChange={setProject}
              placeholder="project (optional)"
              label="project"
              labelHidden
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={submit}
            disabled={!text.trim()}
          >
            remember
          </Button>
        </Row>
      </Stack>
      {notes.length === 0 ? (
        <Text scale="caption" color={colors.inkFaint}>
          nothing waiting on anyone
        </Text>
      ) : (
        <Stack gap={6}>
          {notes.map((n) => (
            <Stack key={n.id} gap={2}>
              <Row gap={12} align="baseline" justify="space-between">
                <Row gap={12} align="baseline">
                  <Checkbox checked={false} onClick={() => onResolve(n.id)} />
                  <Text scale="body">
                    {n.text}
                    {n.project && (
                      <Text
                        as="span"
                        scale="caption"
                        color={colors.inkFaint}
                        style={{ marginLeft: 8 }}
                      >
                        · {n.project}
                      </Text>
                    )}
                  </Text>
                </Row>
              </Row>
              <WhenCaption ts={n.ts} style={{ marginLeft: 26 }} />
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

const GHOST_LINK_STYLE: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px 8px',
  color: colors.inkFaint,
  cursor: 'pointer',
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
  fontSize: 12,
};

/** Friendly local "Mon 3:00 PM" / "Jun 4, 3:00 PM" for an upcoming block. */
function formatBlockWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameWeek =
    Math.abs(ts - now.getTime()) < 6 * 24 * 60 * 60 * 1000;
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (sameWeek) {
    const day = d.toLocaleDateString(undefined, { weekday: 'short' });
    return `${day} ${time}`;
  }
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${date}, ${time}`;
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

/** [start, end) ms window for the user's local day. */
function todayWindow(): { fromMs: number; toMs: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}
