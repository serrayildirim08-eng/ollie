/**
 * CycleBox · /box/cycle screen.
 *
 * Visual port of `apps/web/src/modules/cycle-v2/screens/CycleFace.tsx`
 * (the redesign/money-v2 branch). One serif day number sits centred
 * inside a calm phase ring — a cream track with a soft sage luteal arc
 * (drawn only when we know enough to draw it), a quiet ovulation point,
 * and a single travelling marker for "today". Beneath the ring, the
 * recent symptoms / pills / history sections from the v0 surface remain
 * as quiet SMCP-labelled lists.
 *
 * Per redesign tokens.css, bleeding-day dots use umber `#8A4B2C` — never
 * the amber accent, never red. The marker carries that ink while a
 * period is on; once the bleeding window closes, the marker softens to
 * sage so the ring stops "alarming".
 *
 * Data, polling and repo contracts are unchanged from the previous
 * version. The ring is fully cold-start safe: when the cycle history is
 * empty, the track stands alone with an honest "still learning" line.
 *
 * No predictions, no warnings, no risk scoring — this is a sensitive
 * surface. The AI router does adds via brain-dump; this screen reads +
 * lets you undo.
 *
 * Auto-refreshes on focus + every 6s so the screen catches additions
 * made from another tab while it's open. Same polling pattern as Grocery.
 */

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  formatDays,
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row, Box } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { CycleTree } from './CycleTree';
import { cycleVisual } from './cycleVisual';
import { migrateCycle } from './migrate';
import { cycleCadence, cycleRepo } from './repo';
import {
  BLEEDING_INTENSITIES,
  type BleedingIntensity,
  type CurrentCycle,
  type CycleEvent,
} from './types';

// ── visual constants ──────────────────────────────────────────────────────

/**
 * umber — the cycle bleeding-day ink (redesign tokens.css `--umber`).
 * Native `colors` doesn't surface it as a role, so it lives locally.
 * NEVER red, NEVER amber — colour never alarms here.
 */
const UMBER = '#8A4B2C';

/** typical cycle length used for the ring's angular scale when we don't
 *  know the user's true length yet. 28 is the cold-start convention. */
const RING_LENGTH = 28;
/** roughly the bleeding window — used to soften the marker once it ends */
const BLEEDING_WINDOW_DAYS = 8;

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const COLD_NOTE_STYLE: CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: '-0.01em',
  lineHeight: 1.45,
  color: colors.ink,
  maxWidth: 280,
  textAlign: 'left',
};

// ── component ────────────────────────────────────────────────────────────

export function CycleBox(): JSX.Element {
  const [current, setCurrent] = useState<CurrentCycle | null>(null);
  const [symptoms, setSymptoms] = useState<CycleEvent[]>([]);
  const [pills, setPills] = useState<CycleEvent[]>([]);
  const [history, setHistory] = useState<CycleEvent[]>([]);
  const [periodCadence, setPeriodCadence] = useState<CadenceEstimate | null>(null);
  const [todayBleeding, setTodayBleeding] = useState<BleedingIntensity | null>(null);
  const [pregnant, setPregnant] = useState(false);

  const refresh = useCallback(async () => {
    const [cur, sym, pil, starts, ends, cad, bleeding, preg] = await Promise.all([
      cycleRepo.current(),
      cycleRepo.list('symptom', 10),
      cycleRepo.list('pill', 10),
      cycleRepo.list('period_start', 6),
      cycleRepo.list('period_end', 6),
      cycleCadence.getPeriodCadence(),
      cycleRepo.bleedingForDay(),
      cycleRepo.isPregnant(),
    ]);
    setCurrent(cur);
    setSymptoms(sym);
    setPills(pil);
    setPeriodCadence(cad);
    setTodayBleeding(bleeding);
    setPregnant(preg);
    // Merge starts + ends, sort desc, keep top 6 — gives a chronological
    // view of "what landed lately on the period timeline".
    const merged = [...starts, ...ends]
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 6);
    setHistory(merged);
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'cycle',
    migrate: migrateCycle,
    refresh,
  });

  const handleRemove = useCallback(
    async (id: string) => {
      await cycleRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const handleSetBleeding = useCallback(
    async (intensity: BleedingIntensity) => {
      // re-tapping the active tag clears today's flow; setBleeding upserts so
      // there's only ever one tag per day.
      if (todayBleeding === intensity) {
        const dayEvents = await cycleRepo.list('bleeding', 50);
        const today = dayEvents.find((e) => isSameLocalDay(e.occurredAt, Date.now()));
        if (today) await cycleRepo.remove(today.id);
      } else {
        await cycleRepo.setBleeding(intensity);
      }
      await refresh();
    },
    [todayBleeding, refresh],
  );

  const handleSetPregnant = useCallback(async () => {
    await cycleRepo.setPregnant();
    await refresh();
  }, [refresh]);

  const handleEndPregnancy = useCallback(async () => {
    await cycleRepo.endPregnancy();
    await refresh();
  }, [refresh]);

  const isEmpty =
    ready &&
    current === null &&
    symptoms.length === 0 &&
    pills.length === 0 &&
    history.length === 0;

  const ringDay = useMemo(() => {
    if (!current) return 1;
    // clamp into the ring's visual range so a long gap doesn't wrap weirdly
    const d = current.daysSinceStart + 1;
    return Math.max(1, Math.min(RING_LENGTH, d));
  }, [current]);

  const phaseLabel = useMemo(() => {
    if (!current) return 'still learning';
    if (current.bleeding) return 'bleeding';
    if (current.daysSinceStart < BLEEDING_WINDOW_DAYS) return 'early cycle';
    if (current.daysSinceStart < 14) return 'follicular';
    if (current.daysSinceStart < 17) return 'around ovulation';
    return 'luteal';
  }, [current]);

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
          cycle
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : pregnant ? (
        <PausedView onResume={() => void handleEndPregnancy()} />
      ) : isEmpty ? (
        <Stack gap={32} align="center">
          <CycleTree
            {...cycleVisual(1, 'still learning', false)}
            day={1}
            phase="still learning"
          />
          <span style={COLD_NOTE_STYLE}>
            <b style={{ fontWeight: 600 }}>nothing tracked yet.</b>{' '}
            <span style={{ color: colors.inkFaint }}>
              try dumping &lsquo;got my period&rsquo; — ollie won&rsquo;t guess
              a date until your cycle warms up.
            </span>
          </span>
        </Stack>
      ) : (
        <Stack gap={56}>
          {/* HERO — the living olive tree (day + phase render below it) */}
          <Stack gap={20} align="center">
            <CycleTree
              {...cycleVisual(ringDay, phaseLabel, current?.bleeding ?? false)}
              day={ringDay}
              phase={phaseLabel}
            />
            <NowLine current={current} />
            <CadenceHint estimate={periodCadence} />
          </Stack>

          {/* bleeding intensity — a quiet chip row for today's flow. */}
          <Stack gap={16}>
            <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
              today&rsquo;s flow
            </Text>
            <BleedingChips selected={todayBleeding} onSelect={handleSetBleeding} />
          </Stack>

          {/* Layer-2 noticings — fed by the SQLite→store bridge + cycle watcher. */}
          <PatternCards module="cycle" />

          <ListSection
            label="recent symptoms"
            empty="none logged"
            items={symptoms}
            renderItem={(ev) => (
              <EventRow
                key={ev.id}
                label={ev.symptom ?? 'symptom'}
                occurredAt={ev.occurredAt}
                onRemove={() => void handleRemove(ev.id)}
              />
            )}
          />

          <ListSection
            label="pills"
            empty="none logged"
            items={pills}
            renderItem={(ev) => (
              <EventRow
                key={ev.id}
                label="pill"
                occurredAt={ev.occurredAt}
                onRemove={() => void handleRemove(ev.id)}
              />
            )}
          />

          <ListSection
            label="history"
            empty="no period events yet"
            items={history}
            renderItem={(ev) => (
              <HistoryRow
                key={ev.id}
                event={ev}
                onRemove={() => void handleRemove(ev.id)}
              />
            )}
          />

          {/* quiet pause control — tucked at the very bottom, never loud. */}
          <PauseControl onPause={() => void handleSetPregnant()} />
        </Stack>
      )}
    </Stack>
  );
}

// ─── bleeding intensity ────────────────────────────────────────────────────

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * The 9 editorial bleeding-intensity tags as a calm wrapping chip row. The
 * selected chip carries the umber bleeding ink (filled, soft); the rest are
 * quiet outlines. Tapping a chip sets today's flow; tapping the active one
 * again clears it. No alarm colour, no scoring.
 */
function BleedingChips({
  selected,
  onSelect,
}: {
  selected: BleedingIntensity | null;
  onSelect: (intensity: BleedingIntensity) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
      }}
      role="group"
      aria-label="bleeding intensity"
    >
      {BLEEDING_INTENSITIES.map((tag) => {
        const active = selected === tag;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={active}
            aria-label={`flow: ${tag}`}
            onClick={() => onSelect(tag)}
            style={{
              background: active ? UMBER : colors.cream,
              border: 'none',
              borderRadius: 999,
              padding: '8px 16px',
              color: active ? colors.cream : colors.inkSoft,
              cursor: 'pointer',
              fontFamily: fonts.sans,
              fontSize: 13,
              letterSpacing: '0.02em',
              lineHeight: 1.2,
              boxShadow: active
                ? 'inset 3px 3px 6px rgba(120,140,122,0.40), inset -3px -3px 6px rgba(255,255,255,0.55)'
                : '4px 4px 9px rgba(120,140,122,0.55), -4px -4px 9px rgba(255,255,255,0.70)',
              transition: 'background 120ms ease, color 120ms ease, box-shadow 120ms ease',
            }}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

// ─── sections ─────────────────────────────────────────────────────────────

/**
 * Faint sub-line under the NowLine: "last period 26 days ago · usually
 * every 28 days". Silent at low-data — Serra's minimal UI prefers nothing
 * to a misleading prediction, and this is a sensitive surface where a
 * wrong forecast is worse than silence.
 */
function CadenceHint({
  estimate,
}: {
  estimate: CadenceEstimate | null;
}): JSX.Element | null {
  if (!estimate || estimate.confidence === 'low-data' || estimate.lastTs == null) {
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
      style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.06em' }}
    >
      {`last period ${sinceLabel} ago · usually every ${everyLabel}`}
    </Text>
  );
}


function NowLine({ current }: { current: CurrentCycle | null }): JSX.Element {
  if (current === null) {
    return (
      <Text scale="caption" color={colors.inkFaint}>
        no period on record yet
      </Text>
    );
  }
  if (current.bleeding) {
    return (
      <Text scale="caption" color={colors.inkFaint}>
        day {current.daysSinceStart + 1} · bleeding
      </Text>
    );
  }
  return (
    <Text scale="caption" color={colors.inkFaint}>
      {current.daysSinceStart === 0
        ? 'less than a day since last period started'
        : `${current.daysSinceStart} days since last period started`}
    </Text>
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
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {label}
      </Text>
      {items.length === 0 ? (
        <Text scale="body" color={colors.inkFaint}>
          {empty}
        </Text>
      ) : (
        <Stack gap={12}>{items.map(renderItem)}</Stack>
      )}
    </Stack>
  );
}

// ─── rows ─────────────────────────────────────────────────────────────────

function EventRow({
  label,
  occurredAt,
  onRemove,
}: {
  label: string;
  occurredAt: number;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Box bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
      <Stack gap={2}>
        <Row gap={12} align="baseline" justify="space-between">
          <Text scale="body">{label}</Text>
          <RemoveButton onClick={onRemove} />
        </Row>
        <WhenCaption ts={occurredAt} />
      </Stack>
    </Box>
  );
}

function HistoryRow({
  event,
  onRemove,
}: {
  event: CycleEvent;
  onRemove: () => void;
}): JSX.Element {
  const label = event.kind === 'period_start' ? 'period start' : 'period end';
  return (
    <Box bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
      <Stack gap={2}>
        <Row gap={12} align="baseline" justify="space-between">
          <Text scale="caption" color={colors.inkFaint}>
            {label}
          </Text>
          <RemoveButton onClick={onRemove} />
        </Row>
        <WhenCaption ts={event.occurredAt} />
      </Stack>
    </Box>
  );
}

// ─── pregnancy pause ───────────────────────────────────────────────────────
//
// NOT pregnancy tracking — no due date, no trimester, no weight, nothing.
// Just a pause + resume. The paused view is deliberately quiet: a plain note
// that tracking is on hold and will resume when this ends, plus one neutral
// "mark this as ended" link. No clinical tone, no alarm, no celebration — a
// miscarriage or termination must read exactly as neutrally as a birth, so
// the only word is "ended".

function PausedView({ onResume }: { onResume: () => void }): JSX.Element {
  return (
    <Stack gap={28}>
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          paused
        </Text>
        <span style={COLD_NOTE_STYLE}>
          <b style={{ fontWeight: 600 }}>cycle paused.</b>{' '}
          <span style={{ color: colors.inkFaint }}>
            tracking will resume when this ends. nothing to do here in the
            meantime.
          </span>
        </span>
      </Stack>
      <QuietLink label="mark this as ended" onClick={onResume} />
    </Stack>
  );
}

function PauseControl({ onPause }: { onPause: () => void }): JSX.Element {
  return (
    <Stack gap={8}>
      <QuietLink label="pause cycle — i'm pregnant" onClick={onPause} />
    </Stack>
  );
}

/**
 * A single calm text link — small-caps, ink-faint, no fill. Used for the
 * pregnancy pause/resume so neither reads as a loud button.
 */
function QuietLink({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        alignSelf: 'flex-start',
        background: 'none',
        border: 'none',
        padding: '4px 0',
        color: colors.inkFaint,
        cursor: 'pointer',
        fontFamily: fonts.sans,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 13,
      }}
    >
      {label}
    </button>
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
        fontFamily: fonts.sans,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
      }}
    >
      remove
    </button>
  );
}

