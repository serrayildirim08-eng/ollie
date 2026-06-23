/**
 * ChoresBox · /box/chores screen.
 *
 * Household cleaning + upkeep. Olive-neumorphic grammar, mirrored from
 * AdminBox / GroceryBox: a kicker + serif title hero, then two sections of
 * raised cream cards —
 *
 *   - "today"    — the day's list. Recurring chores DUE TODAY (weekday-anchored
 *                  "laundry on wednesdays", or interval "every N days") AUTO-
 *                  appear first, each tagged ↻ with a "you do this wednesdays" /
 *                  cadence sub-line so it never feels like it came from nowhere;
 *                  then open one-offs. Round neumorphic checkbox: ✓ on a
 *                  recurring resets its clock, ✓ on a one-off drops it.
 *   - "recent"   — chores done recently (the calm "you did this" strip).
 *
 * A dump-bar placeholder sits at the bottom — adding a chore is done through
 * the Brain Dump router ("cleaned the kitchen" / "laundry on wednesdays"), not
 * an inline form, so this is a quiet hint, not an input.
 *
 * Reads via chores.list()/listDueToday()/listOpenOneOff() + cadence; writes
 * via chores.setDone()/markDone()/remove(). Migrates + polls via useModuleData.
 */

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  daysSinceLast,
  medianIntervalDays,
  formatDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row, Box } from '../../layout';
import { Text } from '../../ui';
import { colors } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateChores } from './migrate';
import { chores as choresRepo, cadence as cadenceRepo } from './repo';
import { formatWeekdays, type Chore } from './types';

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

/** How many recently-done chores the "recent" strip shows. */
const RECENT_LIMIT = 6;

export function ChoresBox(): JSX.Element {
  const [all, setAll] = useState<Chore[]>([]);
  const [dueToday, setDueToday] = useState<Chore[]>([]);
  const [openOneOff, setOpenOneOff] = useState<Chore[]>([]);
  const [cadenceByName, setCadenceByName] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );

  const refresh = useCallback(async () => {
    const [list, dueList, openList] = await Promise.all([
      choresRepo.list(),
      choresRepo.listDueToday(),
      choresRepo.listOpenOneOff(),
    ]);
    setAll(list);
    setDueToday(dueList);
    setOpenOneOff(openList);

    // Cadence reads for the recurring chores (one per name). Silent until a
    // chore has been done twice — most chores cross 'observed' quickly.
    const recurringNames = new Set<string>();
    for (const c of list) {
      if (c.kind === 'recurring') recurringNames.add(c.name);
    }
    const pairs = await Promise.all(
      Array.from(recurringNames).map(
        async (name) => [name, await cadenceRepo.getCadenceFor(name)] as const,
      ),
    );
    setCadenceByName(new Map(pairs));
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'chores',
    migrate: migrateChores,
    refresh,
  });

  const handleMarkRecurringDone = useCallback(
    async (name: string) => {
      await choresRepo.markDone(name);
      await refresh();
    },
    [refresh],
  );

  const handleToggleOneOff = useCallback(
    async (id: string, nextDone: boolean) => {
      await choresRepo.setDone(id, nextDone);
      await refresh();
    },
    [refresh],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      await choresRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  // The "recent" strip: any chore with a lastDoneAt, most-recent first.
  const recent = useMemo(() => {
    return all
      .filter((c) => c.lastDoneAt != null)
      .sort((a, b) => (b.lastDoneAt ?? 0) - (a.lastDoneAt ?? 0))
      .slice(0, RECENT_LIMIT);
  }, [all]);

  const hasAnything = all.length > 0;

  return (
    <Stack gap={56}>
      {/* kicker + serif title — the box hero strip */}
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box · chores
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
          chores
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          the cleaning + upkeep — vacuuming, dishes, laundry. ollie learns the
          rhythm and reminds you, gently.
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : !hasAnything ? (
        <ColdState />
      ) : (
        <Stack gap={56}>
          {/* today — the day's list. Recurring chores due today (weekday-anchored
              or interval) AUTO-appear first, tagged ↻; then open one-offs. */}
          <Section label="today">
            {dueToday.length === 0 && openOneOff.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                nothing on today&rsquo;s list — try dumping &ldquo;clean the
                bathroom&rdquo;
              </Text>
            ) : (
              <Stack gap={12}>
                {dueToday.map((c) => (
                  <CardRow key={c.id}>
                    <RecurringRow
                      chore={c}
                      cadence={cadenceByName.get(c.name)}
                      onDone={() => void handleMarkRecurringDone(c.name)}
                      onRemove={() => void handleRemove(c.id)}
                    />
                  </CardRow>
                ))}
                {openOneOff.map((c) => (
                  <CardRow key={c.id}>
                    <OneOffRow
                      chore={c}
                      onToggle={() => void handleToggleOneOff(c.id, !c.done)}
                      onRemove={() => void handleRemove(c.id)}
                    />
                  </CardRow>
                ))}
              </Stack>
            )}
          </Section>

          {/* recent — the calm "you did this" strip */}
          {recent.length > 0 && (
            <Section label="recent">
              <CardList
                items={recent}
                renderRow={(c) => <RecentRow chore={c} />}
              />
            </Section>
          )}

          {/* Layer-2 noticings — the chores watcher's "chore due" offers
              surface here once there's enough signal. Renders nothing when
              empty. */}
          <PatternCards module="chores" />
        </Stack>
      )}

      {/* dump-bar placeholder — adding a chore is done via the dump, not a form */}
      <DumpBarHint />
    </Stack>
  );
}

// ─── sections + lists ───────────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/** One raised neumorphic cream card wrapping a single row. */
function CardRow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
      {children}
    </Box>
  );
}

/** Render items as raised neumorphic cream cards — one per row, calm gap. */
function CardList<T extends { id: string }>({
  items,
  renderRow,
}: {
  items: T[];
  renderRow: (item: T) => ReactNode;
}): JSX.Element {
  return (
    <Stack gap={12}>
      {items.map((item) => (
        <Box
          key={item.id}
          bg="cream"
          radius="card"
          shadow="raised"
          style={{ padding: '16px 18px' }}
        >
          {renderRow(item)}
        </Box>
      ))}
    </Stack>
  );
}

// ─── rows ───────────────────────────────────────────────────────────────────

/**
 * A recurring chore that's surfaced on today's list. It got here automatically
 * (weekday matched, or the interval clock rolled over) — the ↻ tag + "you do
 * this wednesdays" / cadence sub-line tell the user WHY it's here, so an
 * auto-added item never feels like it appeared from nowhere.
 */
function RecurringRow({
  chore,
  cadence,
  onDone,
  onRemove,
}: {
  chore: Chore;
  cadence?: CadenceEstimate | undefined;
  onDone: () => void;
  onRemove: () => void;
}): JSX.Element {
  const weekdayLabel =
    chore.weekdays && chore.weekdays.length > 0 ? formatWeekdays(chore.weekdays) : null;
  return (
    <Row gap={12} align="center" justify="space-between">
      <Row gap={11} align="center" style={{ flex: 1, minWidth: 0 }}>
        <TickCircle done={false} onClick={onDone} label="mark done" />
        <Stack gap={2}>
          <Text scale="body" color={colors.ink}>
            {chore.name}
            <Text
              as="span"
              scale="caption"
              color={colors.inkFaint}
              aria-label="recurring"
              style={{ marginLeft: 8 }}
            >
              ↻
            </Text>
          </Text>
          {weekdayLabel ? (
            <Text
              scale="caption"
              color={colors.inkFaint}
              style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.06em' }}
            >
              you do this {weekdayLabel}
            </Text>
          ) : (
            <CadenceHint estimate={cadence} cadenceDays={chore.cadenceDays} />
          )}
        </Stack>
      </Row>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function OneOffRow({
  chore,
  onToggle,
  onRemove,
}: {
  chore: Chore;
  onToggle: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Row gap={12} align="center" justify="space-between">
      <Row gap={11} align="center" style={{ flex: 1, minWidth: 0 }}>
        <TickCircle done={chore.done} onClick={onToggle} />
        <Stack gap={2}>
          <Text
            scale="body"
            color={chore.done ? colors.inkFaint : colors.ink}
            style={chore.done ? { textDecoration: 'line-through' } : undefined}
          >
            {chore.name}
          </Text>
          <WhenCaption ts={chore.createdAt} />
        </Stack>
      </Row>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function RecentRow({ chore }: { chore: Chore }): JSX.Element {
  return (
    <Row gap={11} align="center">
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: colors.sage,
          flexShrink: 0,
        }}
      />
      <Stack gap={2}>
        <Text scale="body" color={colors.inkSoft}>
          {chore.name}
        </Text>
        {chore.lastDoneAt != null && <WhenCaption ts={chore.lastDoneAt} />}
      </Stack>
    </Row>
  );
}

/**
 * Faint sub-line under a recurring chore: "usually every 7 days". Prefers the
 * observed cadence once there's enough signal; falls back to the registered
 * cadence target so the rhythm is always visible.
 */
function CadenceHint({
  estimate,
  cadenceDays,
}: {
  estimate?: CadenceEstimate | undefined;
  cadenceDays: number | null;
}): JSX.Element | null {
  let everyLabel: string | null = null;
  if (estimate && estimate.confidence !== 'low-data') {
    everyLabel = formatDays(medianIntervalDays(estimate));
  } else if (cadenceDays != null && cadenceDays > 0) {
    everyLabel = formatDays(cadenceDays);
  }
  if (!everyLabel) return null;

  const since =
    estimate && estimate.lastTs != null
      ? daysSinceLast(estimate, Date.now())
      : null;

  return (
    <Text
      scale="caption"
      color={colors.inkFaint}
      style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.06em' }}
    >
      {since != null
        ? `${formatDays(since)} ago · usually every ${everyLabel}`
        : `usually every ${everyLabel}`}
    </Text>
  );
}

// ─── cold state + dump hint ─────────────────────────────────────────────────

function ColdState(): JSX.Element {
  return (
    <Stack gap={0} align="center">
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        nothing here yet
      </Text>
      <div
        style={{
          marginTop: 9,
          fontFamily: 'var(--ollie-font-serif)',
          fontSize: 30,
          fontWeight: 300,
          color: colors.ink,
          letterSpacing: '-0.025em',
          lineHeight: 1.25,
          textAlign: 'center',
          maxWidth: 320,
        }}
      >
        chores is empty &mdash; that&rsquo;s fine
      </div>
      <div
        style={{
          marginTop: 22,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          maxWidth: 360,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: colors.sage,
            flexShrink: 0,
            marginTop: 6,
          }}
        />
        <span
          style={{
            fontSize: 14,
            color: colors.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.5,
            textAlign: 'left',
          }}
        >
          dump a chore &mdash; &ldquo;cleaned the kitchen&rdquo;,
          &ldquo;need to vacuum&rdquo;, or &ldquo;do laundry every week&rdquo;.
        </span>
      </div>
    </Stack>
  );
}

/** A quiet placeholder where the dump bar will sit — adding is via the dump. */
function DumpBarHint(): JSX.Element {
  return (
    <Box
      bg="cream"
      radius="card"
      shadow="raised"
      style={{ padding: '14px 18px', opacity: 0.7 }}
    >
      <Text scale="caption" color={colors.inkFaint}>
        dump a chore to add it — &ldquo;vacuumed&rdquo;, &ldquo;clean the
        bathroom&rdquo;, &ldquo;mop every week&rdquo;
      </Text>
    </Box>
  );
}

// ─── primitives ─────────────────────────────────────────────────────────────

/**
 * Soft round tick — neumorphic. Empty = a pressed cream well; checked = a
 * filled sageDeep disc with a cream check. Lifted from AdminBox's TickCircle.
 */
function TickCircle({
  done,
  onClick,
  label,
}: {
  done: boolean;
  onClick: () => void;
  label?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? (done ? 'mark undone' : 'mark done')}
      aria-pressed={done}
      style={{
        appearance: 'none',
        background: done ? colors.sageDeep : colors.cream,
        border: 'none',
        boxShadow: done
          ? 'none'
          : 'inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)',
        width: 24,
        height: 24,
        padding: 0,
        borderRadius: '50%',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background-color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    >
      {done && (
        <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 5.2 L4.2 7.2 L8 3"
            fill="none"
            stroke={colors.cream}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
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
        transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    >
      remove
    </button>
  );
}
