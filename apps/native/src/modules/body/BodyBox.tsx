/**
 * BodyBox · /box/body screen.
 *
 * Ported visually from the redesign/money-v2 web BodyFace (apps/web/src/
 * modules/body-v2/screens/BodyFace.tsx) on 2026-05-28. The web version is
 * the live "face" of the body module (a hero glass + drill rows); this
 * native surface keeps the same editorial hero but stays a review +
 * cleanup screen — the AI router still does the writing.
 *
 * Visual structure:
 *   1. kicker + display title — section opener
 *   2. WaterHero — the ink-outline tumbler with sky-blue fill, oversized
 *      numerical readout, "glasses today" caption. Empty state gets the
 *      cold-start dot-and-sentence invitation.
 *   3. Today line — last movement, quiet
 *   4. Sectioned editorial rows (water / movement / symptoms / supplements /
 *      other), each with a small "remove" affordance.
 *
 * Auto-refreshes on focus + every 6s so the screen catches additions
 * made from another tab / from a dump while the page is open.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fontSizes, fontWeights, letterSpacings } from '../../theme/tokens';
import { migrateBody } from './migrate';
import { events as eventsRepo } from './repo';
import {
  DEFAULT_GLASS_ML,
  getAmountMl,
  getBodyPart,
  getDose,
  getDurationMin,
  getLabel,
  getSeverity,
  sectionForKind,
  startOfTodayMs,
  type BodyEvent,
  type BodySection,
} from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;

/** Editorial glass-a-day target. Matches the web v2 default. */
const GLASS_TARGET = 8;

export function BodyBox(): JSX.Element {
  const [items, setItems] = useState<BodyEvent[]>([]);
  const [waterTotalMl, setWaterTotalMl] = useState<number>(0);
  const [lastMovement, setLastMovement] = useState<BodyEvent | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [list, water, movement] = await Promise.all([
      eventsRepo.list(),
      eventsRepo.waterTotalToday(),
      eventsRepo.lastMovement(),
    ]);
    setItems(list);
    setWaterTotalMl(water);
    setLastMovement(movement);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateBody();
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
      await eventsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const grouped = groupBySection(items);
  const todayStart = startOfTodayMs();
  const todaysWater = grouped.water.filter((e) => e.loggedAt >= todayStart);
  const todaysMovement = grouped.movement.filter((e) => e.loggedAt >= todayStart);

  // glass-count read of today's water: prefer the explicit count of water
  // rows so the editorial readout matches "n glasses today", but fall
  // back to mL/250 when rows pre-date the per-glass logging convention.
  const glassCount = countGlassesToday(todaysWater, waterTotalMl);
  const isEmpty = items.length === 0;

  return (
    <Stack gap={48}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text scale="display">Body</Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : (
        <Stack gap={48}>
          <WaterHero count={glassCount} target={GLASS_TARGET} cold={isEmpty} />

          {lastMovement && (
            <Row gap={12} align="baseline" justify="space-between">
              <Text scale="body" color={colors.inkFaint} style={SMCP_STYLE}>
                last movement
              </Text>
              <Text scale="body">{formatLastMovement(lastMovement)}</Text>
            </Row>
          )}

          {!isEmpty && (
            <Stack gap={48}>
              <ListSection label="water" items={todaysWater}>
                {(e) => (
                  <WaterRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
                )}
              </ListSection>

              <ListSection label="movement" items={todaysMovement}>
                {(e) => (
                  <MovementRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
                )}
              </ListSection>

              <ListSection label="symptoms" items={grouped.symptoms}>
                {(e) => (
                  <SymptomRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
                )}
              </ListSection>

              <ListSection label="supplements" items={grouped.supplements}>
                {(e) => (
                  <SupplementRow
                    key={e.id}
                    event={e}
                    onRemove={() => void handleRemove(e.id)}
                  />
                )}
              </ListSection>

              <ListSection label="other" items={grouped.other}>
                {(e) => (
                  <OtherRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
                )}
              </ListSection>
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}

// ─── water hero ──────────────────────────────────────────────────────────
//
// The editorial centerpiece, ported from body-v2's WaterHero. Centered
// column: tumbler glass, oversized serif count, "glasses today" caption,
// then a sage-dot invitation when the page is cold (no logs yet).
//
// This is a review surface — no "add a glass" button. The AmberButton
// from the web v2 face is intentionally dropped (writes belong to the
// brain-dump router on native).

function WaterHero({
  count,
  target,
  cold,
}: {
  count: number;
  target: number;
  cold: boolean;
}): JSX.Element {
  const fill = target > 0 ? Math.min(1, count / target) : 0;
  return (
    <Stack gap={20} align="center">
      <Glass fill={fill} size="big" />

      <Stack gap={4} align="center">
        <div
          style={{
            fontFamily: 'var(--ollie-font-serif)',
            fontSize: 46,
            fontWeight: fontWeights.light,
            color: colors.ink,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {count}
          <span
            style={{
              fontSize: 20,
              color: colors.inkFaint,
              fontWeight: fontWeights.light,
              letterSpacing: '-0.01em',
            }}
          >
            {' '}
            of {target}
          </span>
        </div>
        <div
          style={{
            fontSize: fontSizes.caption,
            color: colors.inkFaint,
            fontWeight: fontWeights.medium,
            letterSpacing: letterSpacings.capsTight,
            ...SMCP_STYLE,
          }}
        >
          glasses today
        </div>
      </Stack>

      {cold && (
        <Row
          gap={9}
          align="start"
          style={{ marginTop: 4, maxWidth: 320 }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: colors.sageDeep,
              flexShrink: 0,
              marginTop: 7,
            }}
          />
          <Text scale="body" color={colors.ink}>
            <b style={{ fontWeight: fontWeights.medium }}>
              this is body — water, supplements, anything the body does.
            </b>{' '}
            try dumping &ldquo;3 glasses of water&rdquo; to start.
          </Text>
        </Row>
      )}
    </Stack>
  );
}

// ─── glass · the iconic water-vessel SVG ────────────────────────────────
//
// Ported from body-v2/components/Glass.tsx. Ink outline + sky-blue water
// (sky is the only place sky/water blue is allowed per redesign rules).
// Two sizes: `big` (118×160 hero) and `small` (22×30 inline). At fill 0
// the big glass shows a faint dashed half-line so it reads "waiting to
// fill", never broken.

function Glass({
  fill,
  size = 'big',
}: {
  fill: number;
  size?: 'big' | 'small';
}): JSX.Element {
  const clipId = useId();
  const f = Math.max(0, Math.min(1, fill));

  if (size === 'small') {
    const cavityTop = 5;
    const cavityBottom = 41;
    const waterTop = cavityBottom - f * (cavityBottom - cavityTop);
    return (
      <svg
        width={22}
        height={30}
        viewBox="0 0 34 46"
        aria-hidden
        style={{ display: 'block' }}
      >
        <clipPath id={clipId}>
          <path d="M7.5 5 L26.5 5 L24.8 35 Q24.4 41 17 41 Q9.6 41 9.2 35 Z" />
        </clipPath>
        {f > 0 && (
          <g clipPath={`url(#${clipId})`}>
            <rect
              x={6}
              y={waterTop}
              width={22}
              height={cavityBottom - waterTop + 6}
              fill={colors.sky}
              opacity={0.88}
            />
            <line
              x1={6}
              y1={waterTop + 0.4}
              x2={28}
              y2={waterTop + 0.4}
              stroke="#fff"
              strokeWidth={1}
              opacity={0.45}
            />
          </g>
        )}
        <path
          d="M7 4 L27 4 L25.1 35 Q24.6 42 17 42 Q9.4 42 8.9 35 Z"
          fill="none"
          stroke={colors.ink}
          strokeWidth={1.6}
        />
      </svg>
    );
  }

  const cavityTop = 18;
  const cavityBottom = 142;
  const waterTop = cavityBottom - f * (cavityBottom - cavityTop);
  return (
    <svg
      width={118}
      height={160}
      viewBox="0 0 118 160"
      aria-hidden
      style={{ display: 'block' }}
    >
      <clipPath id={clipId}>
        <path d="M26 18 L92 18 L86 122 Q84.6 142 59 142 Q33.4 142 32 122 Z" />
      </clipPath>
      {f > 0 ? (
        <g clipPath={`url(#${clipId})`}>
          <rect
            x={22}
            y={waterTop}
            width={74}
            height={cavityBottom - waterTop + 18}
            fill={colors.sky}
            opacity={0.88}
          />
          <line
            x1={22}
            y1={waterTop + 1}
            x2={96}
            y2={waterTop + 1}
            stroke="#fff"
            strokeWidth={2.4}
            opacity={0.5}
          />
        </g>
      ) : (
        <line
          x1={33}
          y1={80}
          x2={86}
          y2={80}
          stroke={colors.hairline}
          strokeWidth={1.6}
          strokeDasharray="3 4"
        />
      )}
      <path
        d="M24 14 L94 14 L87.5 122 Q86 145 59 145 Q32 145 30.5 122 Z"
        fill="none"
        stroke={colors.ink}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── list helpers ─────────────────────────────────────────────────────────

function ListSection({
  label,
  items,
  children,
}: {
  label: string;
  items: BodyEvent[];
  children: (e: BodyEvent) => JSX.Element;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {label}
      </Text>
      <Stack gap={4}>{items.map((e) => children(e))}</Stack>
    </Stack>
  );
}

function WaterRow({ event, onRemove }: { event: BodyEvent; onRemove: () => void }): JSX.Element {
  const ml = getAmountMl(event);
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">{ml != null ? `${ml} mL` : 'water'}</Text>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function MovementRow({
  event,
  onRemove,
}: {
  event: BodyEvent;
  onRemove: () => void;
}): JSX.Element {
  const label = getLabel(event) || 'movement';
  const dur = getDurationMin(event);
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">{dur != null ? `${label} · ${dur} min` : label}</Text>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function SymptomRow({
  event,
  onRemove,
}: {
  event: BodyEvent;
  onRemove: () => void;
}): JSX.Element {
  const label = getLabel(event) || 'symptom';
  const severity = getSeverity(event);
  const bodyPart = getBodyPart(event);
  const parts: string[] = [label];
  if (bodyPart) parts.push(bodyPart);
  if (severity != null) parts.push(`${severity}/5`);
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">{parts.join(' · ')}</Text>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function SupplementRow({
  event,
  onRemove,
}: {
  event: BodyEvent;
  onRemove: () => void;
}): JSX.Element {
  const label = getLabel(event) || 'supplement';
  const dose = getDose(event);
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">{dose ? `${label} · ${dose}` : label}</Text>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function OtherRow({ event, onRemove }: { event: BodyEvent; onRemove: () => void }): JSX.Element {
  const label = describeOther(event);
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Text scale="body">{label}</Text>
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
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
        transition: 'color 200ms ease',
      }}
    >
      remove
    </button>
  );
}

// ─── formatters ───────────────────────────────────────────────────────────

function formatLastMovement(e: BodyEvent | null): string {
  if (!e) return 'none yet';
  const label = getLabel(e) || 'movement';
  const dur = getDurationMin(e);
  return dur != null ? `${label} · ${dur} min` : label;
}

function describeOther(e: BodyEvent): string {
  switch (e.kind) {
    case 'posture':
      return 'posture check';
    case 'hunger':
      return 'hunger noted';
    case 'episode': {
      const label = getLabel(e) || 'episode';
      const dur = e.data['duration'];
      return typeof dur === 'string' && dur ? `${label} · ${dur}` : label;
    }
    default:
      return e.kind;
  }
}

function groupBySection(items: BodyEvent[]): Record<BodySection, BodyEvent[]> {
  const out: Record<BodySection, BodyEvent[]> = {
    water: [],
    movement: [],
    symptoms: [],
    supplements: [],
    other: [],
  };
  for (const e of items) {
    out[sectionForKind(e.kind)].push(e);
  }
  return out;
}

/**
 * Editorial glass count for today.
 *
 * Counts the number of distinct water rows logged today (each "had a
 * glass of water" → one row in the v2 mental model). Falls back to
 * mL / DEFAULT_GLASS_ML when no rows exist but a total is present (e.g.
 * pre-redesign mL-only data, or a single dumped "drank 750 mL").
 */
function countGlassesToday(todaysWater: BodyEvent[], totalMl: number): number {
  if (todaysWater.length > 0) return todaysWater.length;
  if (totalMl <= 0) return 0;
  return Math.round(totalMl / DEFAULT_GLASS_ML);
}
