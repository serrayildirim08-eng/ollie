/**
 * HabitsBox · /box/habits screen.
 *
 * Editorial, ADHD-safe. Ported visually from the redesign/money-v2 habits-v2
 * `HabitsFace` (2026-05-28) — the calm hero is the SINGLE next check-in, not a
 * grid wall of streaks. No flame, no shame: a missed day reads as "—" not "0",
 * the streak count lives as a quiet caption, and the day's progress is a 270°
 * open arc + a row of waiting dots.
 *
 * The visual structure (top to bottom):
 *   1. HERO        · tap-circle + habit name in DM Serif Display + 270° arc +
 *                   waiting-dot row + soft "n still waiting" line
 *   2. TODAY       · drill of habits ticked today (calm bullet list)
 *   3. HABITS      · registry rows + "mark done" + streak caption
 *   4. IDENTITY    · most recent identity statements
 *   5. STREAK BRX  · honest record of when + why
 *   6. CLOSE       · "no streak waits on any of these"
 *
 * Storage is untouched — every read/write still goes through ./repo. The
 * redesign is purely a UI rebuild over the existing data shape (HabitRow with
 * { streak, completedToday } + identity/streak-break events). Concepts from
 * habits-v2 that the native repo doesn't model (cueTime buckets, cue strings,
 * orchestrator patterns) are deliberately not invented here.
 *
 * Polls every 6s + refreshes on window focus to catch additions from other
 * tabs / from brain-dumps made while the page is open.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { migrateHabits } from './migrate';
import { registry, completions, events, listHabitRows } from './repo';
import type { HabitEvent, HabitRow, IdentityData, StreakBreakData } from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;

// ─── visual constants (ported from habits-v2 TapCircle / ProgressArc) ────
const HERO_CIRCLE = 150;     // tap-circle diameter
const ARC_SIZE    = 96;      // progress-arc square
const ARC_STROKE  = 4;
const ARC_RADIUS  = (ARC_SIZE - ARC_STROKE) / 2;
const ARC_LEN     = 2 * Math.PI * ARC_RADIUS;
const ARC_OPEN    = 0.25;    // 25% of circumference left open (90° gap) → 270° arc
const DOT_SIZE    = 9;

export function HabitsBox(): JSX.Element {
  const [rows, setRows] = useState<HabitRow[]>([]);
  const [identityEvents, setIdentityEvents] = useState<HabitEvent[]>([]);
  const [breakEvents, setBreakEvents] = useState<HabitEvent[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [r, ident, brks] = await Promise.all([
      listHabitRows(),
      events.listRecent('identity', 20),
      events.listRecent('streak_break', 20),
    ]);
    setRows(r);
    setIdentityEvents(ident);
    setBreakEvents(brks);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateHabits();
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

  const handleMarkDone = useCallback(
    async (habitName: string) => {
      const h = await registry.ensure(habitName);
      await completions.add(h.id);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveHabit = useCallback(
    async (id: string) => {
      await registry.remove(id);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveEvent = useCallback(
    async (id: string) => {
      await events.remove(id);
      await refresh();
    },
    [refresh],
  );

  // ── view-model derived from the existing repo rows ──
  const vm = useMemo(() => buildVM(rows), [rows]);

  const todayRows = rows.filter((r) => r.completedToday);
  const isEmpty =
    rows.length === 0 && identityEvents.length === 0 && breakEvents.length === 0;

  return (
    <Stack gap={48}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text scale="display">Habits</Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : isEmpty ? (
        <Text scale="body" color={colors.inkFaint}>
          no habits yet — try dumping &lsquo;did yoga&rsquo; or &lsquo;meditated&rsquo;
        </Text>
      ) : (
        <Stack gap={64}>
          {/* ── HERO · single next check-in ─────────────────────────── */}
          <Hero
            vm={vm}
            onCheckIn={() => {
              if (vm.next) void handleMarkDone(vm.next.habit.name);
            }}
          />

          {/* ── TODAY ─────────────────────────────────────────────── */}
          <Section label="today">
            {todayRows.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                nothing ticked yet today
              </Text>
            ) : (
              <Stack gap={4}>
                {todayRows.map((r) => (
                  <Row key={r.habit.id} gap={12} align="baseline">
                    <Text scale="body" color={colors.sage}>
                      ·
                    </Text>
                    <Text scale="body">{r.habit.name}</Text>
                  </Row>
                ))}
              </Stack>
            )}
          </Section>

          {/* ── HABITS REGISTRY ───────────────────────────────────── */}
          <Section label="habits">
            {rows.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                no habits registered yet
              </Text>
            ) : (
              <Stack gap={4}>
                {rows.map((r) => (
                  <HabitRowView
                    key={r.habit.id}
                    row={r}
                    onMarkDone={() => void handleMarkDone(r.habit.name)}
                    onRemove={() => void handleRemoveHabit(r.habit.id)}
                  />
                ))}
              </Stack>
            )}
          </Section>

          {/* ── IDENTITY NOTES ────────────────────────────────────── */}
          <Section label="identity notes">
            {identityEvents.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                nothing yet — try dumping &lsquo;i&rsquo;m someone who reads&rsquo;
              </Text>
            ) : (
              <Stack gap={4}>
                {identityEvents.map((e) => (
                  <EventRow
                    key={e.id}
                    label={readIdentity(e).text}
                    onRemove={() => void handleRemoveEvent(e.id)}
                  />
                ))}
              </Stack>
            )}
          </Section>

          {/* ── STREAK BREAKS ─────────────────────────────────────── */}
          <Section label="streak breaks">
            {breakEvents.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                none recorded
              </Text>
            ) : (
              <Stack gap={4}>
                {breakEvents.map((e) => {
                  const d = readBreak(e);
                  const label = d.reason ? `${d.habitName} — ${d.reason}` : d.habitName;
                  return (
                    <EventRow
                      key={e.id}
                      label={label}
                      onRemove={() => void handleRemoveEvent(e.id)}
                    />
                  );
                })}
              </Stack>
            )}
          </Section>

          {/* ── CLOSING REASSURANCE ─────────────────────────────── */}
          <div
            style={{
              textAlign: 'center',
              fontSize: 12,
              color: colors.inkFaint,
              fontWeight: 400,
              lineHeight: 1.55,
              letterSpacing: '0.01em',
            }}
          >
            no streak waits on any of these — a habit just waits, calmly, for its
            cue.
          </div>
        </Stack>
      )}
    </Stack>
  );
}

// ─── HERO ────────────────────────────────────────────────────────────────

interface VM {
  /** the next habit still to check in today, or null when all done / none on file */
  next: HabitRow | null;
  /** habits checked in today */
  doneCount: number;
  /** total habits on file */
  totalCount: number;
  /** the lead line above the tap-circle */
  lead: string;
  /** the centre label under the count */
  centreLabel: string;
  /** "3 still waiting · no rush" — the calm waiting line */
  waitLine: string;
  /** waiting-dot states, one per habit in registry order */
  waitDots: WaitDotState[];
}

type WaitDotState = 'done' | 'now' | 'waiting';

function buildVM(rows: HabitRow[]): VM {
  const total = rows.length;
  const done  = rows.filter((r) => r.completedToday).length;
  const next  = rows.find((r) => !r.completedToday) ?? null;

  const waiting = total - done;

  const lead =
    total === 0
      ? 'nothing on file yet'
      : next
        ? 'next, when you can'
        : 'all in for today';

  const centreLabel =
    total === 0
      ? 'no habits yet'
      : done === 0
        ? "the day's ahead"
        : done === total
          ? 'all done today'
          : 'done today';

  const waitLine =
    total === 0
      ? 'add one through the brain dump'
      : waiting === 0
        ? 'nothing waits · the day is yours'
        : `${waiting} still waiting · no rush`;

  // dot states — done / now (the next one) / waiting (the rest)
  const waitDots: WaitDotState[] = rows.map((r) => {
    if (r.completedToday) return 'done';
    if (next && r.habit.id === next.habit.id) return 'now';
    return 'waiting';
  });

  return { next, doneCount: done, totalCount: total, lead, centreLabel, waitLine, waitDots };
}

function Hero({ vm, onCheckIn }: { vm: VM; onCheckIn: () => void }): JSX.Element {
  const live = vm.next !== null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
      }}
    >
      {/* lead */}
      <div
        style={{
          fontFamily: fonts.sans,
          fontSize: 13,
          color: colors.inkFaint,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        {vm.lead}
      </div>

      {/* tap-circle */}
      <div style={{ marginTop: 30 }}>
        <TapCircle live={live} label={vm.next?.habit.name} onCheck={onCheckIn} />
      </div>

      {/* habit name — DM Serif Display, large */}
      <div
        style={{
          marginTop: 34,
          fontFamily: fonts.serif,
          fontSize: 30,
          fontWeight: 400,
          color: colors.ink,
          letterSpacing: '-0.015em',
          lineHeight: 1.1,
          textAlign: 'center',
          maxWidth: 320,
        }}
      >
        {vm.next ? vm.next.habit.name : vm.totalCount === 0 ? 'a calm day' : 'all in for today'}
      </div>

      {/* streak caption — ADHD-safe: 0 renders as — */}
      {vm.next && (
        <div
          style={{
            marginTop: 9,
            fontFamily: fonts.sans,
            fontSize: 14,
            color: colors.inkFaint,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {streakCaption(vm.next.streak)}
        </div>
      )}

      {/* progress arc + waiting-dot row */}
      <div
        style={{
          marginTop: 34,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <ProgressArc done={vm.doneCount} total={vm.totalCount} label={vm.centreLabel} />
        <WaitDots dots={vm.waitDots} />
        <div
          style={{
            marginTop: 2,
            fontFamily: fonts.sans,
            fontSize: 13,
            color: colors.inkFaint,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          {vm.waitLine}
        </div>
      </div>
    </div>
  );
}

// ─── TapCircle (ported from habits-v2/components/TapCircle.tsx) ──────────

function TapCircle({
  live,
  label,
  onCheck,
}: {
  live: boolean;
  label?: string;
  onCheck: () => void;
}): JSX.Element {
  const base: React.CSSProperties = {
    boxSizing: 'border-box',
    width: HERO_CIRCLE,
    height: HERO_CIRCLE,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.paper,
    boxShadow: '0 16px 38px rgba(42,38,34,0.07)',
    border: `2px solid ${colors.hairline}`,
    transition: 'transform 200ms cubic-bezier(0.18, 0, 0.22, 1), background 200ms ease',
  };

  if (!live) {
    // every habit is in — quiet decorative all-done mark, never a button
    return (
      <div aria-hidden style={base}>
        <CheckGlyph size={50} stroke={colors.sage} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onCheck}
      aria-label={label ? `check in — ${label}` : 'check this habit in'}
      style={{
        ...base,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        padding: 0,
      }}
    >
      <CheckGlyph size={50} stroke={colors.amber} />
    </button>
  );
}

function CheckGlyph({ size, stroke }: { size: number; stroke: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── ProgressArc · 270° open SVG arc ─────────────────────────────────────

function ProgressArc({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}): JSX.Element {
  const safeTotal = Math.max(1, total);
  const ratio = Math.min(1, Math.max(0, done / safeTotal));
  const visibleLen = ARC_LEN * (1 - ARC_OPEN);
  const filled = visibleLen * ratio;
  const trackDash = `${visibleLen} ${ARC_LEN}`;
  const fillDash  = `${filled} ${ARC_LEN}`;
  // rotate so the 90° gap sits at the bottom (between 7:30 and 4:30 visually).
  // Start the stroke at the top-left of the arc by rotating -225°.
  const rotate = -225;

  return (
    <div
      style={{
        position: 'relative',
        width: ARC_SIZE,
        height: ARC_SIZE,
      }}
      aria-label={`${done} of ${total} ${label}`}
    >
      <svg
        width={ARC_SIZE}
        height={ARC_SIZE}
        viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`}
        style={{ transform: `rotate(${rotate}deg)` }}
      >
        {/* track */}
        <circle
          cx={ARC_SIZE / 2}
          cy={ARC_SIZE / 2}
          r={ARC_RADIUS}
          fill="none"
          stroke={colors.hairline}
          strokeWidth={ARC_STROKE}
          strokeDasharray={trackDash}
          strokeLinecap="round"
        />
        {/* fill */}
        {total > 0 && done > 0 && (
          <circle
            cx={ARC_SIZE / 2}
            cy={ARC_SIZE / 2}
            r={ARC_RADIUS}
            fill="none"
            stroke={colors.sage}
            strokeWidth={ARC_STROKE}
            strokeDasharray={fillDash}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 400ms cubic-bezier(0.18,0,0.22,1)' }}
          />
        )}
      </svg>
      {/* centre label */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 24,
            lineHeight: 1,
            color: colors.ink,
            letterSpacing: '-0.02em',
          }}
        >
          {total === 0 ? '—' : `${done}/${total}`}
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 10,
            color: colors.inkFaint,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

// ─── WaitDots (ported from habits-v2/components/WaitDots.tsx) ────────────

function WaitDots({ dots }: { dots: WaitDotState[] }): JSX.Element {
  if (dots.length === 0) {
    return (
      <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {[0, 1].map((i) => (
          <span
            key={i}
            style={{
              boxSizing: 'border-box',
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: '50%',
              background: 'transparent',
              border: `1.5px dashed ${colors.hairline}`,
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: 240,
      }}
    >
      {dots.map((state, i) => {
        const bg =
          state === 'done' ? colors.sage : state === 'now' ? colors.ink : colors.hairline;
        return (
          <span
            key={i}
            style={{
              boxSizing: 'border-box',
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: '50%',
              background: bg,
              transition: 'background 220ms cubic-bezier(0.18,0,0.22,1)',
            }}
          />
        );
      })}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function streakCaption(streak: number): string {
  // ADHD-safe: zero renders as "—", never "0 days"
  if (streak <= 0) return '—';
  return `${streak} day${streak === 1 ? '' : 's'} running`;
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
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

function HabitRowView({
  row,
  onMarkDone,
  onRemove,
}: {
  row: HabitRow;
  onMarkDone: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Row gap={8} align="baseline">
        <Text scale="body">{row.habit.name}</Text>
        <Text as="span" scale="caption" color={colors.inkFaint}>
          {row.streak > 0 ? `· ${row.streak} day${row.streak === 1 ? '' : 's'}` : '· —'}
        </Text>
      </Row>
      <Row gap={4} align="baseline">
        {!row.completedToday && <SmallButton label="mark done" onClick={onMarkDone} />}
        <SmallButton label="remove" onClick={onRemove} />
      </Row>
    </Row>
  );
}

function EventRow({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">{label}</Text>
      <SmallButton label="remove" onClick={onRemove} />
    </Row>
  );
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 8px',
        color: colors.inkFaint,
        cursor: 'pointer',
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
        fontFamily: fonts.sans,
      }}
    >
      {label}
    </button>
  );
}

function readIdentity(e: HabitEvent): IdentityData {
  try {
    const parsed = JSON.parse(e.data) as Partial<IdentityData>;
    return { text: parsed.text ?? '' };
  } catch {
    return { text: '' };
  }
}

function readBreak(e: HabitEvent): StreakBreakData {
  try {
    const parsed = JSON.parse(e.data) as Partial<StreakBreakData>;
    return {
      habitName: parsed.habitName ?? '',
      reason: parsed.reason,
    };
  } catch {
    return { habitName: '' };
  }
}
