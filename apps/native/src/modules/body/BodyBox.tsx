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

import { useCallback, useId, useState } from 'react';
import {
  formatDays,
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fontSizes, fontWeights, letterSpacings } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateBody } from './migrate';
import { cadence as cadenceRepo, events as eventsRepo, profile as profileRepo } from './repo';
import {
  DEFAULT_GLASS_ML,
  getAmountMl,
  getBodyPart,
  getDose,
  getDurationMin,
  getLabel,
  getSeverity,
  normaliseLabel,
  sectionForKind,
  startOfTodayMs,
  waterTargetForAge,
  type BodyEvent,
  type BodySection,
} from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export function BodyBox(): JSX.Element {
  const [items, setItems] = useState<BodyEvent[]>([]);
  const [waterTotalMl, setWaterTotalMl] = useState<number>(0);
  const [lastMovement, setLastMovement] = useState<BodyEvent | null>(null);
  const [age, setAge] = useState<number | null>(null);
  const [movementCadenceByActivity, setMovementCadenceByActivity] = useState<
    Map<string, CadenceEstimate>
  >(() => new Map());

  const refresh = useCallback(async () => {
    const [list, water, movement, storedAge] = await Promise.all([
      eventsRepo.list(),
      eventsRepo.waterTotalToday(),
      eventsRepo.lastMovement(),
      profileRepo.getAge(),
    ]);
    setItems(list);
    setWaterTotalMl(water);
    setLastMovement(movement);
    setAge(storedAge);

    // One cadence per distinct movement activity. We fan-out off the
    // already-fetched event list so we don't ping the DB twice.
    const activities = new Set<string>();
    for (const e of list) {
      if (e.kind !== 'movement') continue;
      const label = normaliseLabel(getLabel(e));
      if (label) activities.add(label);
    }
    const pairs = await Promise.all(
      [...activities].map(
        async (a) => [a, await cadenceRepo.getMovementCadenceFor(a)] as const,
      ),
    );
    setMovementCadenceByActivity(new Map(pairs));
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'body',
    migrate: migrateBody,
    refresh,
  });

  const handleRemove = useCallback(
    async (id: string) => {
      await eventsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const handleSaveAge = useCallback(
    async (years: number | null) => {
      await profileRepo.setAge(years);
      await refresh();
    },
    [refresh],
  );

  // Daily glass target, sized by the one-time age (falls back to 8 when unset).
  const glassTarget = waterTargetForAge(age);
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
          <WaterHero
            count={glassCount}
            target={glassTarget}
            cold={isEmpty}
            onAddGlass={() =>
              void (async () => {
                await eventsRepo.add({ kind: 'water', data: { amountMl: 250 } });
                await refresh();
              })()
            }
          />

          <AgeField age={age} onSave={(years) => void handleSaveAge(years)} />

          {lastMovement && (
            <Row gap={12} align="baseline" justify="space-between">
              <Text scale="body" color={colors.inkFaint} style={SMCP_STYLE}>
                last movement
              </Text>
              <Text scale="body">{formatLastMovement(lastMovement)}</Text>
            </Row>
          )}

          {/* Layer-2 noticings — soft cards from the body watcher (hydration
              drift, hyperfocus dehydration, hunger↔thirst, episode patterns). */}
          <PatternCards module="body" />

          {!isEmpty && (
            <Stack gap={48}>
              <ListSection label="water" items={todaysWater}>
                {(e) => (
                  <WaterRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
                )}
              </ListSection>

              <ListSection label="movement" items={todaysMovement}>
                {(e) => (
                  <MovementRow
                    key={e.id}
                    event={e}
                    cadence={movementCadenceByActivity.get(normaliseLabel(getLabel(e)))}
                    onRemove={() => void handleRemove(e.id)}
                  />
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
  onAddGlass,
}: {
  count: number;
  target: number;
  cold: boolean;
  onAddGlass: () => void;
}): JSX.Element {
  const fill = target > 0 ? Math.min(1, count / target) : 0;
  return (
    <Stack gap={20} align="center">
      <button
        type="button"
        onClick={onAddGlass}
        aria-label="add a glass of water"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
        }}
      >
        <Glass fill={fill} size="big" />
      </button>

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

// ─── age field · one-time profile input that sizes the water target ──────
//
// Calm, low-stakes: when age is unknown it's a single quiet "set age" link;
// when set it reads "age 34 · target 8 glasses" with an edit affordance.
// No shame, no required-field gate — the target falls back to 8 without it.

function AgeField({
  age,
  onSave,
}: {
  age: number | null;
  onSave: (years: number | null) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputId = useId();

  const begin = () => {
    setDraft(age != null ? String(age) : '');
    setEditing(true);
  };

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    const next = Number.isFinite(parsed) && parsed > 0 && parsed < 130 ? parsed : null;
    onSave(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <Row gap={10} align="center" justify="center">
        <label htmlFor={inputId} style={{ ...SMCP_STYLE, fontSize: 12, color: colors.inkFaint }}>
          age
        </label>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={129}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{
            width: 64,
            border: `1px solid ${colors.hairline}`,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 15,
            color: colors.ink,
            background: colors.paper,
            fontFamily: 'var(--ollie-font-sans)',
          }}
        />
        <AgeTextButton label="save" onClick={commit} strong />
        <AgeTextButton label="cancel" onClick={() => setEditing(false)} />
      </Row>
    );
  }

  return (
    <Row gap={10} align="baseline" justify="center">
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {age != null
          ? `age ${age} · target ${waterTargetForAge(age)} glasses`
          : 'target 8 glasses — set your age to tune it'}
      </Text>
      <AgeTextButton label={age != null ? 'edit' : 'set age'} onClick={begin} />
    </Row>
  );
}

function AgeTextButton({
  label,
  onClick,
  strong = false,
}: {
  label: string;
  onClick: () => void;
  strong?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: '2px 4px',
        cursor: 'pointer',
        color: strong ? colors.ink : colors.inkFaint,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
        fontFamily: 'var(--ollie-font-sans)',
      }}
    >
      {label}
    </button>
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
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{ml != null ? `${ml} mL` : 'water'}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
    </Stack>
  );
}

function MovementRow({
  event,
  cadence,
  onRemove,
}: {
  event: BodyEvent;
  cadence: CadenceEstimate | undefined;
  onRemove: () => void;
}): JSX.Element {
  const label = getLabel(event) || 'movement';
  const dur = getDurationMin(event);
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{dur != null ? `${label} · ${dur} min` : label}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
      <CadenceHint estimate={cadence} subject={label} />
    </Stack>
  );
}

/**
 * One muted line under a movement row: "last yoga 4 days ago · usually
 * every 3 days". Silent at low-data confidence — Serra prefers nothing
 * to a misleading prediction.
 */
function CadenceHint({
  estimate,
  subject,
}: {
  estimate: CadenceEstimate | undefined;
  subject: string;
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
      {`last ${subject} ${sinceLabel} ago · usually every ${everyLabel}`}
    </Text>
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
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{parts.join(' · ')}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
    </Stack>
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
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{dose ? `${label} · ${dose}` : label}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
    </Stack>
  );
}

function OtherRow({ event, onRemove }: { event: BodyEvent; onRemove: () => void }): JSX.Element {
  const label = describeOther(event);
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{label}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
    </Stack>
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
