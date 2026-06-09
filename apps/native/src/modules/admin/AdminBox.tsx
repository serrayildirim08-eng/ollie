/**
 * AdminBox · /box/admin screen.
 *
 * Visual port of the redesign/money-v2 admin face (AdminFace + Runway + the
 * cold-state grammar from admin-cold.html). The web v2 ships admin as a
 * micro-app with leaf screens; here it's a single flat box. So we keep the
 * v2 *grammar* and translate the rhythm:
 *
 *   - The hero up top: a Runway SVG (90 · 30 · 7 · 0-day stages) with an
 *     umber marker riding it, behind a kicker ("next thing due"), a serif
 *     display title (the soonest renewal), and a calm meta line of the
 *     form `<days-left> · <category>`. If there is no soonest renewal we
 *     show the cold-runway grammar instead (bare dashed ticks + sage-dot
 *     editorial note + "admin is empty — that's fine").
 *
 *   - Below the hero, the rest of the renewals as hairline-bordered rows.
 *
 *   - Then the five task buckets (tasks · phone calls · appointments ·
 *     paperwork · decisions) as smcp-labelled sections of hairline-bordered
 *     rows with a soft circular tick on the left and a small "remove" on
 *     the right. Overdue items get an amber-tinted day-count.
 *
 * Preserved functionality from the v0 of this box:
 *   - reads via `tasks.list()` / `renewals.list()` from `./repo`
 *   - writes via `tasks.setDone` / `tasks.remove` / `renewals.remove`
 *   - migrates on mount via `migrateAdmin()`
 *   - polls every 6s + refreshes on window focus (no observable layer over
 *     SQLite yet, so polling stays)
 *
 * Idioms translated from the web v2 source:
 *   - Tailwind / inline web styles → inline styles using `colors` from theme
 *     tokens (sage / amber / hairline / inkSoft / inkFaint).
 *   - The v2 palette constants (v2.accent / v2.mute / v2.line / "#A8703C")
 *     map to native role tokens (sage / inkFaint / hairline / amber).
 *   - next-router / in-module stack → react-router v7 `Link` for the "all
 *     tasks etc. live here" anchor; the actual section content lives on
 *     this box page (the native AdminBox is the *only* admin surface).
 *   - safe-area-inset paddings dropped (desktop-leaning Tauri).
 *   - framer-motion dropped — a single CSS color transition on hover.
 *
 * Visual elements intentionally dropped:
 *   - the v2 sub-routes (AddScreen / TasksScreen / TaskScreen / CallsScreen
 *     / BurstScreen / PatternsScreen / NotificationsScreen) — adding is
 *     done via the Brain Dump router, not an inline form on the box.
 *   - the AmberButton "do this one" CTA — clicking the hero would route to
 *     a task-detail screen that doesn't exist here. The hero is purely
 *     a glance surface; the task is acted on via its row's check below.
 *   - the "2-min burst" + "see the rest" pattern rows — depend on selectors
 *     not present in this repo (`burstCount`, `patternLine`).
 *   - the footer "what admin sends — and what it never does" link — leads
 *     to the v2 NotificationsScreen, no parallel here yet.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateAdmin } from './migrate';
import {
  cadence as cadenceRepo,
  renewals as renewalsRepo,
  tasks as tasksRepo,
} from './repo';
import {
  daysUntil,
  formatDaysUntil,
  type AdminRenewal,
  type AdminTask,
  type AdminTaskKind,
} from './types';

// ─── style atoms ──────────────────────────────────────────────────────────

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;

/** Umber accent for renewal markers. Lifted verbatim from v2 Runway. */
const UMBER = '#A8703C';

// ─── runway geometry (lifted from v2 Runway.tsx) ──────────────────────────

const TRACK_X0 = 8;
const TRACK_X1 = 200;
const TRACK_Y = 30;

/** map a 0..1 stage position to runway pixel x (1 = left start, 0 = right) */
function markerX(pos: number): number {
  const clamped = Math.max(0, Math.min(1, pos));
  return TRACK_X1 - clamped * (TRACK_X1 - TRACK_X0);
}

/**
 * The runway position from a days-until-due integer. 1 = at the 90-day
 * stage (just started), 0 = due or overdue. Mirrors v2 selectors faceVM.
 */
function runwayPosFromDays(days: number): number {
  if (days >= 90) return 1;
  if (days <= 0) return 0;
  return days / 90;
}

// ─── component ────────────────────────────────────────────────────────────

export function AdminBox(): JSX.Element {
  const [taskList, setTaskList] = useState<AdminTask[]>([]);
  const [renewalList, setRenewalList] = useState<AdminRenewal[]>([]);
  const [renewalCadence, setRenewalCadence] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [t, r] = await Promise.all([tasksRepo.list(), renewalsRepo.list()]);
    setTaskList(t);
    setRenewalList(r);

    // Fan-out cadence reads — one per distinct renewal type. Most users
    // will only ever cross 'observed' for things like an annual lease or
    // insurance after a couple of years; we surface silently until then.
    const types = new Set<string>();
    for (const row of r) {
      if (row.renewalType) types.add(row.renewalType);
    }
    const pairs = await Promise.all(
      Array.from(types).map(
        async (type) =>
          [type, await cadenceRepo.getRenewalCadenceFor(type)] as const,
      ),
    );
    setRenewalCadence(new Map(pairs));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateAdmin();
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

  const handleRemoveTask = useCallback(
    async (id: string) => {
      await tasksRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const handleToggleTask = useCallback(
    async (id: string, nextDone: boolean) => {
      await tasksRepo.setDone(id, nextDone);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveRenewal = useCallback(
    async (id: string) => {
      await renewalsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  // Bucket tasks once per render so each section reads naturally.
  const buckets = useMemo(() => groupByKind(taskList), [taskList]);

  // The soonest-due renewal with an actual due_date — drives the hero.
  // Renewals are already sorted by `due_date ASC` in the repo, with no-date
  // entries sinking to the bottom, so the head is the soonest dated row.
  const nextDue = useMemo<AdminRenewal | null>(() => {
    const head = renewalList[0];
    return head && head.dueDate ? head : null;
  }, [renewalList]);

  const restRenewals = useMemo(() => {
    if (!nextDue) return renewalList;
    return renewalList.filter((r) => r.id !== nextDue.id);
  }, [renewalList, nextDue]);

  return (
    <Stack gap={56}>
      {/* kicker + serif title — the box hero strip, sibling-pattern parity */}
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box · admin
        </Text>
        <Text scale="display">Admin</Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          the things you forget — passport, lease, taxes, the dentist. ollie
          carries the dates.
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : (
        <Stack gap={56}>
          {/* the hero: next-due renewal on the runway, OR a cold runway */}
          {nextDue ? (
            <NextDueHero renewal={nextDue} />
          ) : (
            <ColdHero hasAnyData={taskList.length > 0 || renewalList.length > 0} />
          )}

          {/* every other renewal, hairline-bound */}
          {restRenewals.length > 0 && (
            <Section label="upcoming renewals">
              <HairlineList
                items={restRenewals}
                renderRow={(r) => (
                  <RenewalRow
                    renewal={r}
                    cadence={renewalCadence.get(r.renewalType)}
                    onRemove={() => void handleRemoveRenewal(r.id)}
                  />
                )}
              />
            </Section>
          )}

          <TaskSection
            label="tasks"
            empty="no tasks yet — try dumping 'passport renewal' or 'dentist tuesday'"
            items={buckets.task}
            onToggle={handleToggleTask}
            onRemove={handleRemoveTask}
          />

          <TaskSection
            label="phone calls"
            empty="no calls to make"
            items={buckets.phone}
            onToggle={handleToggleTask}
            onRemove={handleRemoveTask}
            renderSecondary={(task) => {
              const reason = task.data.kind === 'phone' ? task.data.reason : undefined;
              return reason ? `· ${reason}` : null;
            }}
            primaryPrefix="call"
          />

          <TaskSection
            label="appointments"
            empty="no appointments scheduled"
            items={buckets.appointment}
            onToggle={handleToggleTask}
            onRemove={handleRemoveTask}
            renderSecondary={(task) => {
              const date = task.data.kind === 'appointment' ? task.data.date : undefined;
              return date ? `· ${date}` : null;
            }}
          />

          <TaskSection
            label="paperwork"
            empty="no paperwork pending"
            items={buckets.paperwork}
            onToggle={handleToggleTask}
            onRemove={handleRemoveTask}
          />

          <TaskSection
            label="decisions"
            empty="no decisions to revisit"
            items={buckets.decision}
            onToggle={handleToggleTask}
            onRemove={handleRemoveTask}
          />

          {/* Layer-2 noticings — the admin watcher's computed patterns
              (stale ball, renewal cues, cost-of-delay, …) surface here once
              there's enough signal. Renders nothing when empty. */}
          <PatternCards module="admin" />
        </Stack>
      )}
    </Stack>
  );
}

// ─── hero ─────────────────────────────────────────────────────────────────

function NextDueHero({ renewal }: { renewal: AdminRenewal }): JSX.Element {
  const days = daysUntil(renewal.dueDate);
  const tag = formatDaysUntil(renewal.dueDate);
  const overdue = days != null && days < 0;
  const pos = days != null ? runwayPosFromDays(days) : null;
  return (
    <Stack gap={0} align="center">
      <Runway pos={pos} />
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        next thing due
      </Text>
      <div
        style={{
          marginTop: 8,
          fontFamily: 'var(--ollie-font-serif)',
          fontSize: 40,
          fontWeight: 300,
          color: colors.ink,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          textAlign: 'center',
        }}
      >
        {renewal.renewalType}
      </div>
      <div
        style={{
          marginTop: 13,
          fontSize: 14,
          color: colors.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        <strong
          style={{
            fontWeight: 600,
            color: overdue ? colors.rubric : UMBER,
          }}
        >
          {tag}
        </strong>
        <span style={{ color: colors.hairline, margin: '0 7px' }}>·</span>
        <span style={{ color: colors.inkSoft }}>renewal</span>
      </div>
    </Stack>
  );
}

function ColdHero({ hasAnyData }: { hasAnyData: boolean }): JSX.Element {
  return (
    <Stack gap={0} align="center">
      <Runway pos={null} />
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        nothing due yet
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
        admin is empty &mdash; that&rsquo;s fine
      </div>
      {/* on the truly-cold face (no tasks AND no renewals), echo the v2
          worked example — three sage-dot examples of what admin holds. */}
      {!hasAnyData && (
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
            this is where the{' '}
            <strong style={{ fontWeight: 600 }}>stuff you forget</strong>{' '}
            lives &mdash; passport, lease, taxes, the dentist. dump the first
            one and ollie will carry the dates.
          </span>
        </div>
      )}
    </Stack>
  );
}

// ─── runway (lifted from v2 components/Runway.tsx) ────────────────────────

function Runway({ pos }: { pos: number | null }): JSX.Element {
  if (pos == null) {
    return (
      <div style={{ boxSizing: 'border-box', width: 208, height: 44, marginBottom: 24 }}>
        <svg width="208" height="44" viewBox="0 0 208 44" style={{ display: 'block' }} aria-hidden>
          <line
            x1={TRACK_X0}
            y1={TRACK_Y}
            x2={TRACK_X1}
            y2={TRACK_Y}
            stroke={colors.hairline}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="2 5"
          />
          {[8, 72, 136, 200].map((x) => (
            <line
              key={x}
              x1={x}
              y1={25}
              x2={x}
              y2={35}
              stroke={colors.hairline}
              strokeWidth={1.6}
            />
          ))}
        </svg>
      </div>
    );
  }

  const mx = markerX(pos);
  return (
    <div style={{ boxSizing: 'border-box', width: 208, height: 44, marginBottom: 24 }}>
      <svg width="208" height="44" viewBox="0 0 208 44" style={{ display: 'block' }} aria-hidden>
        <line
          x1={TRACK_X0}
          y1={TRACK_Y}
          x2={TRACK_X1}
          y2={TRACK_Y}
          stroke={colors.hairline}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <line
          x1={TRACK_X0}
          y1={TRACK_Y}
          x2={mx}
          y2={TRACK_Y}
          stroke={UMBER}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.4}
        />
        <line x1={8} y1={24} x2={8} y2={36} stroke={colors.hairline} strokeWidth={2} />
        <line x1={142} y1={24} x2={142} y2={36} stroke={colors.hairline} strokeWidth={2} />
        <line x1={178} y1={24} x2={178} y2={36} stroke={colors.hairline} strokeWidth={2} />
        <line x1={200} y1={24} x2={200} y2={36} stroke={colors.hairline} strokeWidth={2} />
        <circle cx={mx} cy={TRACK_Y} r={7} fill={UMBER} />
        <circle cx={mx} cy={TRACK_Y} r={7} fill="none" stroke={colors.paper} strokeWidth={3} />
        <text
          x={8}
          y={14}
          fontSize={9}
          fontWeight={600}
          fill={colors.inkFaint}
          textAnchor="middle"
        >
          90
        </text>
        <text
          x={142}
          y={14}
          fontSize={9}
          fontWeight={600}
          fill={colors.inkFaint}
          textAnchor="middle"
        >
          30
        </text>
        <text
          x={178}
          y={14}
          fontSize={9}
          fontWeight={600}
          fill={colors.inkFaint}
          textAnchor="middle"
        >
          7
        </text>
        <text
          x={200}
          y={14}
          fontSize={9}
          fontWeight={600}
          fill={colors.inkFaint}
          textAnchor="middle"
        >
          0
        </text>
      </svg>
    </div>
  );
}

// ─── sections ─────────────────────────────────────────────────────────────

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

function TaskSection({
  label,
  empty,
  items,
  onToggle,
  onRemove,
  renderSecondary,
  primaryPrefix,
}: {
  label: string;
  empty: string;
  items: AdminTask[];
  onToggle: (id: string, nextDone: boolean) => void;
  onRemove: (id: string) => void;
  renderSecondary?: (task: AdminTask) => string | null;
  primaryPrefix?: string;
}): JSX.Element {
  return (
    <Section label={label}>
      {items.length === 0 ? (
        <Text scale="body" color={colors.inkFaint}>
          {empty}
        </Text>
      ) : (
        <HairlineList
          items={items}
          renderRow={(t) => (
            <TaskRow
              task={t}
              primaryPrefix={primaryPrefix}
              secondary={renderSecondary?.(t) ?? null}
              onToggle={() => onToggle(t.id, !t.done)}
              onRemove={() => onRemove(t.id)}
            />
          )}
        />
      )}
    </Section>
  );
}

/**
 * Render a list of items as hairline-bordered rows (top + bottom rule on
 * the last row). Mirrors the v2 torn-note grammar from admin-cold.html.
 */
function HairlineList<T extends { id: string }>({
  items,
  renderRow,
}: {
  items: T[];
  renderRow: (item: T, index: number) => ReactNode;
}): JSX.Element {
  return (
    <Stack gap={0}>
      {items.map((item, i) => (
        <div
          key={item.id}
          style={{
            borderTop: `1px solid ${colors.hairline}`,
            borderBottom:
              i === items.length - 1 ? `1px solid ${colors.hairline}` : 'none',
            padding: '14px 2px',
          }}
        >
          {renderRow(item, i)}
        </div>
      ))}
    </Stack>
  );
}

// ─── rows ─────────────────────────────────────────────────────────────────

function RenewalRow({
  renewal,
  cadence,
  onRemove,
}: {
  renewal: AdminRenewal;
  cadence?: CadenceEstimate | undefined;
  onRemove: () => void;
}): JSX.Element {
  const days = daysUntil(renewal.dueDate);
  const overdue = days != null && days < 0;
  const dueSoon = days != null && days >= 0 && days <= 7;
  const tag = formatDaysUntil(renewal.dueDate);
  const tagColor = overdue
    ? colors.rubric
    : dueSoon
      ? colors.amber
      : colors.inkFaint;
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Row gap={11} align="baseline">
        {/* a tiny umber square — the renewal cue, matching v2's marker hue */}
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 2,
            background: overdue ? colors.rubric : dueSoon ? colors.amber : UMBER,
            flexShrink: 0,
            opacity: overdue || dueSoon ? 1 : 0.6,
          }}
        />
        <Stack gap={2}>
          <Text scale="body" color={colors.ink}>
            {renewal.renewalType}
            <Text
              as="span"
              scale="caption"
              color={tagColor}
              style={{
                marginLeft: 8,
                fontWeight: overdue || dueSoon ? 600 : 500,
              }}
            >
              · {tag}
            </Text>
          </Text>
          <WhenCaption ts={renewal.addedAt} />
          {cadence && (
            <CadenceHint estimate={cadence} subject={renewal.renewalType} />
          )}
        </Stack>
      </Row>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

/**
 * Faint sub-line under a renewal row: "last passport 365 days ago ·
 * usually every year". Silent at low-data — most renewals only fire once
 * a year, so the second instance is when this lights up.
 */
function CadenceHint({
  estimate,
  subject,
}: {
  estimate: CadenceEstimate;
  subject: string;
}): JSX.Element | null {
  if (estimate.confidence === 'low-data' || estimate.lastTs == null) {
    return null;
  }
  const now = Date.now();
  const since = daysSinceLast(estimate, now) ?? 0;
  const every = medianIntervalDays(estimate);
  const sinceLabel = formatDays(since);
  const everyLabel = formatEvery(every);
  return (
    <Text
      scale="caption"
      color={colors.inkFaint}
      style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.06em' }}
    >
      {`last ${subject} ${sinceLabel} ago · usually every ${everyLabel}`}
    </Text>
  );
}

function formatDays(d: number): string {
  if (d < 1) return 'less than a day';
  const rounded = Math.round(d);
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

/**
 * Renewals run on yearly+ cadence, so we humanise the median: anything
 * over 300d reads as years; anything under, as days. Keeps the editorial
 * voice honest without inventing "months" for an admin row that's really
 * an annual rhythm.
 */
function formatEvery(d: number): string {
  if (d >= 300) {
    const years = Math.round(d / 365);
    return years === 1 ? 'year' : `${years} years`;
  }
  return formatDays(d);
}

function TaskRow({
  task,
  primaryPrefix,
  secondary,
  onToggle,
  onRemove,
}: {
  task: AdminTask;
  primaryPrefix?: string;
  secondary: string | null;
  onToggle: () => void;
  onRemove: () => void;
}): JSX.Element {
  const label = primaryPrefix ? `${primaryPrefix} ${task.text}` : task.text;
  return (
    <Row gap={12} align="center" justify="space-between">
      <Row gap={11} align="center" style={{ flex: 1, minWidth: 0 }}>
        <TickCircle done={task.done} onClick={onToggle} />
        <Stack gap={2}>
          <Text
            scale="body"
            color={task.done ? colors.inkFaint : colors.ink}
            style={task.done ? { textDecoration: 'line-through' } : undefined}
          >
            {label}
            {secondary && (
              <Text
                as="span"
                scale="caption"
                color={colors.inkFaint}
                style={{ marginLeft: 8 }}
              >
                {secondary}
              </Text>
            )}
          </Text>
          <WhenCaption ts={task.createdAt} />
        </Stack>
      </Row>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

// ─── primitives ───────────────────────────────────────────────────────────

/**
 * Soft round tick — the v2 ShopList grammar, ported. Empty = a thin sage
 * ring; checked = a filled sage disc with a paper-coloured check.
 */
function TickCircle({
  done,
  onClick,
}: {
  done: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={done ? 'mark undone' : 'mark done'}
      aria-pressed={done}
      style={{
        appearance: 'none',
        background: done ? colors.sage : 'transparent',
        border: `1.5px solid ${done ? colors.sage : colors.hairline}`,
        width: 18,
        height: 18,
        padding: 0,
        borderRadius: '50%',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background-color 200ms cubic-bezier(0.18, 0, 0.22, 1), border-color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    >
      {done && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 5.2 L4.2 7.2 L8 3"
            fill="none"
            stroke={colors.paper}
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

// ─── helpers ──────────────────────────────────────────────────────────────

function groupByKind(items: AdminTask[]): Record<AdminTaskKind, AdminTask[]> {
  const out: Record<AdminTaskKind, AdminTask[]> = {
    task: [],
    phone: [],
    appointment: [],
    paperwork: [],
    decision: [],
  };
  for (const item of items) {
    const bucket = out[item.kind];
    if (bucket) bucket.push(item);
  }
  return out;
}
