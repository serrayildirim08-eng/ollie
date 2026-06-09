/**
 * SleepBox · /box/sleep screen.
 *
 * Ported from sleep-v2's <SleepFace> on the redesign/money-v2 branch
 * (2026-05-28). The v2 grammar is: ONE focus — last night's duration —
 * as a large editorial serif figure, with the recent week reading as a
 * row of calm baseline bars above. The drill rows (wind-down, dreams,
 * rough nights) expand inline below the fold instead of pushing onto a
 * stack (desktop-friendly: no swipe-back).
 *
 * Storage is untouched: this screen calls `sleepRepo.latestSleep`,
 * `sleepRepo.listByKind`, `sleepRepo.remove` and `migrateSleep` exactly
 * as before. Polling cadence and focus-refresh are preserved (6s + focus).
 *
 * Translation notes:
 *   - tailwind classes → inline styles + token colors
 *   - next-router → no in-module navigation; the Tauri shell owns routing
 *   - safe-area-inset → omitted (desktop)
 *   - framer-motion → omitted (CSS transitions only)
 *   - "the rest" drawer → drill sections rendered inline
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateSleep } from './migrate';
import { cadence as cadenceRepo, sleepRepo } from './repo';
import { SLEEP_FEELS, type SleepEvent, type SleepFeel } from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;
const RECENT_SLEEP_LIMIT = 7;

// the calm baseline-bar visual from sleep-v2 / WeekBars
const BAR_MAX_HEIGHT = 56;
const BAR_MIN = 16;
const BAR_WIDTH = 11;
const BAR_GAP = 10;
// 0..1 fill is computed against this — same anchor v2 uses (10h = full bar)
const BAR_FULL_HOURS = 10;

export function SleepBox(): JSX.Element {
  const [latest, setLatest] = useState<SleepEvent | null>(null);
  const [recentSleep, setRecentSleep] = useState<SleepEvent[]>([]);
  const [windDown, setWindDown] = useState<SleepEvent[]>([]);
  const [dreams, setDreams] = useState<SleepEvent[]>([]);
  const [insomnia, setInsomnia] = useState<SleepEvent[]>([]);
  const [logCadence, setLogCadence] = useState<CadenceEstimate | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [latestSleep, sleeps, winds, dreamRows, rough, cad] = await Promise.all([
      sleepRepo.latestSleep(),
      sleepRepo.listByKind('sleep', RECENT_SLEEP_LIMIT),
      sleepRepo.listByKind('wind_down', 20),
      sleepRepo.listByKind('dream', 20),
      sleepRepo.listByKind('insomnia', 20),
      cadenceRepo.getSleepLogCadence(),
    ]);
    setLatest(latestSleep);
    setRecentSleep(sleeps);
    setWindDown(winds);
    setDreams(dreamRows);
    setInsomnia(rough);
    setLogCadence(cad);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateSleep();
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
      await sleepRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  // Tap a feel tag to set it; tap the active one again to clear it.
  const handleSetFeel = useCallback(
    async (id: string, feel: SleepFeel | null) => {
      await sleepRepo.setFeel(id, feel);
      await refresh();
    },
    [refresh],
  );

  const weekBars = useMemo(() => buildWeekBars(recentSleep), [recentSleep]);

  const anyData =
    latest !== null ||
    recentSleep.length > 0 ||
    windDown.length > 0 ||
    dreams.length > 0 ||
    insomnia.length > 0;

  return (
    <Stack gap={48}>
      {/* page kicker */}
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text scale="display">Sleep</Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : !anyData ? (
        <Text scale="body" color={colors.inkFaint}>
          no sleep logged yet — try dumping &lsquo;slept 7 hours&rsquo;
        </Text>
      ) : (
        <Stack gap={56}>
          {/* HERO — the v2 sleep face's signature: one focus, big serif figure */}
          <HeroSection
            latest={latest}
            weekBars={weekBars}
            logCadence={logCadence}
            onSetFeel={handleSetFeel}
          />

          {/* Layer-2 noticings — soft cards from the sleep watcher (bedtime
              drift, revenge bedtime, caffeine×onset, weekday/weekend gap). */}
          <PatternCards module="sleep" />

          {/* recent week as a list — keeps the data behind the bars readable */}
          <ListSection
            label="recent sleep"
            empty="—"
            items={recentSleep}
            renderItem={(event) => (
              <SleepRow
                key={event.id}
                event={event}
                onRemove={() => void handleRemove(event.id)}
                onSetFeel={(feel) => void handleSetFeel(event.id, feel)}
              />
            )}
          />

          {/* drill rows — expand inline (the desktop translation of the
              iPhone "the rest" drawer pattern) */}
          <ListSection
            label="wind-down notes"
            empty="—"
            items={windDown}
            renderItem={(event) => (
              <WindDownRow
                key={event.id}
                event={event}
                onRemove={() => void handleRemove(event.id)}
              />
            )}
          />

          <ListSection
            label="dreams"
            empty="—"
            items={dreams}
            renderItem={(event) => (
              <DreamRow
                key={event.id}
                event={event}
                onRemove={() => void handleRemove(event.id)}
              />
            )}
          />

          <ListSection
            label="rough nights"
            empty="—"
            items={insomnia}
            renderItem={(event) => (
              <InsomniaRow
                key={event.id}
                event={event}
                onRemove={() => void handleRemove(event.id)}
              />
            )}
          />
        </Stack>
      )}
    </Stack>
  );
}

// ─── hero ─────────────────────────────────────────────────────────────────

interface WeekBarDatum {
  key: string;
  fill: number;
  isLast: boolean;
  empty: boolean;
}

function HeroSection({
  latest,
  weekBars,
  logCadence,
  onSetFeel,
}: {
  latest: SleepEvent | null;
  weekBars: WeekBarDatum[];
  logCadence: CadenceEstimate | null;
  onSetFeel: (id: string, feel: SleepFeel | null) => void;
}): JSX.Element {
  const sleepLatest = latest && latest.kind === 'sleep' ? latest : null;
  const totalMin =
    sleepLatest && sleepLatest.data.hoursSlept != null
      ? Math.round(sleepLatest.data.hoursSlept * 60)
      : null;

  return (
    <Stack gap={24} align="center">
      <WeekBars bars={weekBars} />

      <Stack gap={8} align="center">
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          last night
        </Text>
        <Duration min={totalMin} />
        {sleepLatest && <SubLine event={sleepLatest} />}
        {sleepLatest && (
          <Stack gap={8} align="center" style={{ marginTop: 4 }}>
            <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
              how it felt
            </Text>
            <FeelTags
              selected={sleepLatest.data.feel}
              onSelect={(feel) => onSetFeel(sleepLatest.id, feel)}
            />
          </Stack>
        )}
        <CadenceHint estimate={logCadence} />
      </Stack>
    </Stack>
  );
}

/**
 * The four "how it felt" tags as calm, tappable pills. Tapping the active
 * tag again clears it (toggle). Selected = ink fill; unselected = quiet
 * hairline outline. No judgement copy — just the word.
 */
function FeelTags({
  selected,
  onSelect,
}: {
  selected: SleepFeel | null;
  onSelect: (feel: SleepFeel | null) => void;
}): JSX.Element {
  return (
    <Row gap={8} align="center" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
      {SLEEP_FEELS.map((feel) => {
        const active = selected === feel;
        return (
          <button
            key={feel}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : feel)}
            style={{
              border: `1px solid ${active ? colors.ink : colors.hairline}`,
              background: active ? colors.ink : 'transparent',
              color: active ? colors.paper : colors.inkSoft,
              borderRadius: 999,
              padding: '5px 14px',
              cursor: 'pointer',
              fontFamily: fonts.sans,
              fontSize: 13,
              fontVariantCaps: 'all-small-caps',
              letterSpacing: '0.06em',
              lineHeight: 1,
              transition: 'all 160ms cubic-bezier(0.18, 0, 0.22, 1)',
            }}
          >
            {feel}
          </button>
        );
      })}
    </Row>
  );
}

/**
 * One muted line under the hero subline: "last logged 1 day ago · usually
 * every 1 day". Silent at low-data — Serra's minimal UI prefers nothing
 * to a misleading prediction.
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
      {`last logged ${sinceLabel} ago · usually every ${everyLabel}`}
    </Text>
  );
}

function formatDays(d: number): string {
  if (d < 1) return 'less than a day';
  const rounded = Math.round(d);
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

function Duration({ min }: { min: number | null }): JSX.Element {
  if (min == null) {
    return (
      <span
        style={{
          fontFamily: fonts.serif,
          fontSize: 26,
          fontWeight: 400,
          color: colors.inkFaint,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        nothing logged yet
      </span>
    );
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return (
    <span
      aria-label={`${h} hours ${m} minutes`}
      style={{
        fontFamily: fonts.serif,
        fontSize: 74,
        fontWeight: 300,
        color: colors.ink,
        letterSpacing: '-0.04em',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'baseline',
      }}
    >
      {h}
      <span style={UNIT_STYLE}>h</span>
      <span style={{ display: 'inline-block', width: 12 }} />
      {String(m).padStart(2, '0')}
      <span style={UNIT_STYLE}>m</span>
    </span>
  );
}

const UNIT_STYLE: React.CSSProperties = {
  fontSize: 30,
  color: colors.inkFaint,
  fontWeight: 300,
  letterSpacing: '-0.02em',
};

function SubLine({
  event,
}: {
  event: Extract<SleepEvent, { kind: 'sleep' }>;
}): JSX.Element | null {
  const fragments: string[] = [];
  if (event.data.bedtime && event.data.wake) {
    fragments.push(`bed ${event.data.bedtime} → wake ${event.data.wake}`);
  } else if (event.data.bedtime) {
    fragments.push(`bed ${event.data.bedtime}`);
  } else if (event.data.wake) {
    fragments.push(`wake ${event.data.wake}`);
  }
  if (event.data.quality != null) {
    fragments.push(`quality ${event.data.quality}`);
  }
  if (event.data.feel) {
    fragments.push(event.data.feel);
  }
  if (fragments.length === 0) return null;
  return (
    <Text scale="caption" color={colors.inkSoft}>
      {fragments.join('  ·  ')}
    </Text>
  );
}

// ─── week bars (the signature visual) ─────────────────────────────────────

/**
 * Build the 7-night bar series, oldest-first / newest-last.
 *
 * - rows with `hoursSlept` produce a real bar (fill = hours / 10h, capped)
 * - rows that landed but have no hour count get a small floor bar
 * - missing nights pad with `empty: true` (dashed placeholder)
 */
function buildWeekBars(rows: SleepEvent[]): WeekBarDatum[] {
  const sleepRows = rows.filter(
    (r): r is Extract<SleepEvent, { kind: 'sleep' }> => r.kind === 'sleep',
  );
  // repo returns desc; the bar grammar reads oldest -> newest left -> right.
  const ordered = [...sleepRows].reverse();
  const real: WeekBarDatum[] = ordered.map((row, i) => {
    const hours = row.data.hoursSlept ?? 0;
    const fill = clamp01(hours / BAR_FULL_HOURS);
    return {
      key: row.id,
      // any logged row deserves at least the minimum visible bar
      fill: hours > 0 ? Math.max(fill, BAR_MIN / BAR_MAX_HEIGHT) : 0.18,
      isLast: i === ordered.length - 1,
      empty: false,
    };
  });
  const padCount = Math.max(0, RECENT_SLEEP_LIMIT - real.length);
  const padding: WeekBarDatum[] = Array.from({ length: padCount }, (_, i) => ({
    key: `empty-${i}`,
    fill: 0,
    isLast: false,
    empty: true,
  }));
  // padding goes on the LEFT (older slots), real bars hug the right
  return [...padding, ...real];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function WeekBars({ bars }: { bars: WeekBarDatum[] }): JSX.Element {
  return (
    <div
      role="img"
      aria-label="recent nights of sleep, by duration"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        gap: BAR_GAP,
        height: BAR_MAX_HEIGHT + 8,
        paddingBottom: 6,
      }}
    >
      {/* baseline hairline rule */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 4,
          height: 1,
          background: colors.hairline,
        }}
      />
      {bars.map((b) => {
        if (b.empty) {
          return (
            <span
              key={b.key}
              aria-hidden
              style={{
                width: BAR_WIDTH,
                height: BAR_MIN,
                borderRadius: 2,
                border: `1px dashed ${colors.hairline}`,
                background: 'transparent',
              }}
            />
          );
        }
        const h = Math.max(BAR_MIN, Math.round(b.fill * BAR_MAX_HEIGHT));
        return (
          <span
            key={b.key}
            aria-hidden
            style={{
              width: BAR_WIDTH,
              height: h,
              borderRadius: 2,
              background: b.isLast ? colors.amber : colors.ink,
              transition: 'height 220ms cubic-bezier(0.18, 0, 0.22, 1)',
            }}
          />
        );
      })}
    </div>
  );
}

// ─── sections + rows ─────────────────────────────────────────────────────

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

function SleepRow({
  event,
  onRemove,
  onSetFeel,
}: {
  event: SleepEvent;
  onRemove: () => void;
  onSetFeel: (feel: SleepFeel | null) => void;
}): JSX.Element {
  if (event.kind !== 'sleep') return <></>;
  return (
    <Stack gap={6}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{formatSleepLine(event)}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <FeelTags selected={event.data.feel} onSelect={onSetFeel} />
      <WhenCaption ts={event.occurredAt} />
    </Stack>
  );
}

function WindDownRow({
  event,
  onRemove,
}: {
  event: SleepEvent;
  onRemove: () => void;
}): JSX.Element {
  if (event.kind !== 'wind_down') return <></>;
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{event.data.note}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.occurredAt} />
    </Stack>
  );
}

function DreamRow({
  event,
  onRemove,
}: {
  event: SleepEvent;
  onRemove: () => void;
}): JSX.Element {
  if (event.kind !== 'dream') return <></>;
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{event.data.text}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.occurredAt} />
    </Stack>
  );
}

function InsomniaRow({
  event,
  onRemove,
}: {
  event: SleepEvent;
  onRemove: () => void;
}): JSX.Element {
  if (event.kind !== 'insomnia') return <></>;
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{formatInsomniaLine(event)}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.occurredAt} />
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
        fontFamily: fonts.sans,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
        transition: 'color 120ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = colors.ink;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = colors.inkFaint;
      }}
    >
      remove
    </button>
  );
}

// ─── formatters ──────────────────────────────────────────────────────────

/** "7.5h · quality 4" / "bed 23:00 → wake 06:30" / "logged" */
function formatSleepLine(event: Extract<SleepEvent, { kind: 'sleep' }>): string {
  const parts: string[] = [];
  if (event.data.hoursSlept != null) {
    parts.push(`${event.data.hoursSlept}h`);
  } else if (event.data.bedtime && event.data.wake) {
    parts.push(`bed ${event.data.bedtime} → wake ${event.data.wake}`);
  } else if (event.data.bedtime) {
    parts.push(`bed ${event.data.bedtime}`);
  } else if (event.data.wake) {
    parts.push(`wake ${event.data.wake}`);
  }
  if (event.data.quality != null) {
    parts.push(`quality ${event.data.quality}`);
  }
  if (parts.length === 0) return 'logged';
  return parts.join(' · ');
}

function formatInsomniaLine(event: Extract<SleepEvent, { kind: 'insomnia' }>): string {
  const parts: string[] = [];
  if (event.data.durationAttemptedMin != null) {
    parts.push(`${event.data.durationAttemptedMin} min attempted`);
  }
  if (event.data.wokeCount != null) {
    parts.push(`woke ${event.data.wokeCount}×`);
  }
  if (parts.length === 0) return 'couldn’t sleep';
  return parts.join(' · ');
}
