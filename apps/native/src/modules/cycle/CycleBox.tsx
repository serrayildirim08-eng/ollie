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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { migrateCycle } from './migrate';
import { cycleRepo } from './repo';
import type { CurrentCycle, CycleEvent } from './types';

// ── visual constants ──────────────────────────────────────────────────────

/**
 * umber — the cycle bleeding-day ink (redesign tokens.css `--umber`).
 * Native `colors` doesn't surface it as a role, so it lives locally.
 * NEVER red, NEVER amber — colour never alarms here.
 */
const UMBER = '#8A4B2C';

const POLL_MS = 6000;

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
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [cur, sym, pil, starts, ends] = await Promise.all([
      cycleRepo.current(),
      cycleRepo.list('symptom', 10),
      cycleRepo.list('pill', 10),
      cycleRepo.list('period_start', 6),
      cycleRepo.list('period_end', 6),
    ]);
    setCurrent(cur);
    setSymptoms(sym);
    setPills(pil);
    // Merge starts + ends, sort desc, keep top 6 — gives a chronological
    // view of "what landed lately on the period timeline".
    const merged = [...starts, ...ends]
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 6);
    setHistory(merged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateCycle();
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

  const handleRemove = useCallback(
    async (id: string) => {
      await cycleRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

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
        <Text scale="display">Cycle</Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : isEmpty ? (
        <Stack gap={32} align="center">
          <CycleRing day={1} phase="still learning" length={RING_LENGTH} bleeding={false} />
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
          {/* HERO — the phase ring */}
          <Stack gap={20} align="center">
            <CycleRing
              day={ringDay}
              phase={phaseLabel}
              length={RING_LENGTH}
              bleeding={current?.bleeding ?? false}
              showLutealArc={(current?.daysSinceStart ?? 0) >= BLEEDING_WINDOW_DAYS}
            />
            <NowLine current={current} />
          </Stack>

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
        </Stack>
      )}
    </Stack>
  );
}

// ─── ring ────────────────────────────────────────────────────────────────
//
// Geometry follows the cycle-v2 web ring exactly: 236×236 viewBox, r=100,
// centre (118, 118). Day N rides the ring at angle -90° + (N/length)*360°
// — 0 at the top, clockwise.

const VIEW = 236;
const CX = 118;
const CY = 118;
const R = 100;
const CIRC = 2 * Math.PI * R;

function ringPoint(day: number, length: number): { x: number; y: number } {
  const frac = Math.max(0, Math.min(1, (day - 1) / Math.max(1, length)));
  const angle = -Math.PI / 2 + frac * 2 * Math.PI;
  return {
    x: CX + R * Math.cos(angle),
    y: CY + R * Math.sin(angle),
  };
}

function CycleRing({
  day,
  phase,
  length,
  bleeding,
  showLutealArc = false,
  size = 236,
}: {
  day: number;
  phase: string;
  length: number;
  bleeding: boolean;
  showLutealArc?: boolean;
  size?: number;
}): JSX.Element {
  const safeLength = Math.max(1, length);
  const marker = ringPoint(day, safeLength);

  // luteal arc covers the back half of the ring — drawn only once we're
  // past the bleeding window so it never overlaps the bleeding-day ink.
  // Mirrors the v2 web treatment where the arc only shows when warmed.
  const lutealStartDay = Math.floor(safeLength / 2) + 1;
  let arcDash: string | undefined;
  let arcOffset: number | undefined;
  if (showLutealArc) {
    const startFrac = (lutealStartDay - 1) / safeLength;
    const arcStart = startFrac * CIRC;
    const arcLen = CIRC - arcStart;
    arcDash = `${arcLen} ${arcStart}`;
    arcOffset = -arcStart;
  }

  // ovulation point sits at ~mid-cycle, drawn only once warmed
  const ovulationDay = Math.floor(safeLength / 2);
  const ov = showLutealArc ? ringPoint(ovulationDay + 0.5, safeLength) : null;

  // bleeding days carry the umber ink; the rest of the cycle sits in sage.
  const markerInk = bleeding ? UMBER : colors.sage;

  return (
    <div
      style={{
        boxSizing: 'border-box',
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        style={{ position: 'absolute', display: 'block' }}
        aria-hidden
      >
        {/* full cycle track — quiet cream hairline ring */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={colors.paper}
          strokeWidth={9}
        />

        {/* luteal arc — sage, the back stretch */}
        {arcDash && (
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={colors.sage}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={arcDash}
            strokeDashoffset={arcOffset}
            transform={`rotate(-90 ${CX} ${CY})`}
            opacity={0.55}
          />
        )}

        {/* ovulation point — a small open ink ring */}
        {ov && (
          <circle
            cx={ov.x}
            cy={ov.y}
            r={5.5}
            fill="none"
            stroke={colors.ink}
            strokeWidth={2}
          />
        )}

        {/* travelling day marker — umber when bleeding, sage otherwise.
         *  Paper halo lifts it off the track ring without a hard edge. */}
        <circle cx={marker.x} cy={marker.y} r={8} fill={markerInk} />
        <circle
          cx={marker.x}
          cy={marker.y}
          r={8}
          fill="none"
          stroke={colors.cream}
          strokeWidth={3.5}
        />
      </svg>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
        }}
        role="img"
        aria-label={`cycle day ${day}, ${phase}`}
      >
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 56,
            fontWeight: 400,
            color: colors.ink,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {day}
        </div>
        <div
          style={{
            marginTop: 8,
            fontFamily: fonts.sans,
            fontSize: 12,
            color: colors.inkFaint,
            fontWeight: 500,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
          }}
        >
          {phase}
        </div>
      </div>
    </div>
  );
}

// ─── sections ─────────────────────────────────────────────────────────────

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
        <Stack gap={4}>{items.map(renderItem)}</Stack>
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
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">
        {label}
        <Text as="span" scale="caption" color={colors.inkFaint} style={{ marginLeft: 8 }}>
          · {formatWhen(occurredAt)}
        </Text>
      </Text>
      <RemoveButton onClick={onRemove} />
    </Row>
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
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="caption" color={colors.inkFaint}>
        {label} · {formatWhen(event.occurredAt)}
      </Text>
      <RemoveButton onClick={onRemove} />
    </Row>
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

function formatWhen(ms: number): string {
  const diffMs = Date.now() - ms;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
