/**
 * HealthRoom — /room/health
 *
 * Room 2 of the rooms redesign (Household shipped first). Built to the
 * signed-off mock (ollie-health-walkthrough.html, screen 1) by copying the
 * HouseholdRoom template exactly:
 *   - OFFER (smart) at the top: the health watchers' calm C-model offers
 *     (PatternCards) for sleep · cycle · body · medication, when there is one.
 *   - GLANCE (read): a tight grid of neumorphic tiles, each a small lowercase
 *     label + a BIG value + a faint sub + a › chevron — tap to drill into the
 *     box. sleep · energy · cycle · body · medication.
 *       · ENERGY is READ-ONLY — mood folded in (no chevron, no drill). It is
 *         the mood log's one real consumer.
 *   - DUMP BAR (write): an inset well with an accent cursor + a round send
 *     button. v1 is a 2nd door to the SAME brain — it opens the home dump
 *     rather than duplicating the route/crisis/dispatch pipeline.
 *
 * No new data layer — reads the existing sleep / cycle / body / medication /
 * mood repos. Every value is live; missing data degrades to a calm resting
 * state ("—" / "resting") rather than a fabricated number.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors, shadows, radii } from '../theme/tokens';
import { useModuleData } from '../lib/useModuleData';
import { PatternCards } from '../patterns/PatternCards';
import { migrateSleep } from '../modules/sleep/migrate';
import { sleepRepo } from '../modules/sleep/repo';
import { migrateCycle } from '../modules/cycle/migrate';
import { cycleRepo } from '../modules/cycle/repo';
import { migrateBody } from '../modules/body/migrate';
import { events as bodyEvents, profile as bodyProfile } from '../modules/body/repo';
import { waterTargetForAge } from '../modules/body/types';
import { migrateMedication } from '../modules/medication/migrate';
import { medications as medsRepo, events as medEvents } from '../modules/medication/repo';
import { migrateMood } from '../modules/mood/migrate';
import { events as moodEvents } from '../modules/mood/repo';
import { energyGlanceLabel } from '../modules/mood/types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const KICKER_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: colors.inkSoft,
};

const TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ollie-font-sans)',
  fontSize: '26px',
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
};

/** Midnight-of-today in local time, ms since epoch (matches the modules). */
function startOfLocalDay(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Format fractional hours as "6h 40m" (or "7h" on the hour). Null → null. */
function formatHours(hours: number | null | undefined): string | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) return null;
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Cycle phase label — mirrors CycleBox's derivation exactly (read-only here).
 * Sensitive surface: descriptive only, no predictions/warnings.
 */
function phaseLabel(daysSinceStart: number, bleeding: boolean): string {
  if (bleeding) return 'bleeding';
  if (daysSinceStart < 14) return 'follicular';
  if (daysSinceStart < 17) return 'around ovulation';
  return 'luteal';
}

interface Glance {
  /** Last-night sleep, formatted ("6h 40m") or null when none logged. */
  sleep: string | null;
  /** Read-only energy word (mood folded in), or null → resting. */
  energy: string | null;
  /** Cycle day (1-based: day 0 since start = "day 1"), or null when none. */
  cycleDay: number | null;
  cyclePhase: string | null;
  /** Whether the cycle is paused (pregnancy) — softens the cycle sub-copy. */
  cyclePaused: boolean;
  /** Today's water glasses + the age-sized target. */
  waterCount: number;
  waterTarget: number;
  /** Whether any movement has ever been logged (presence, not a number). */
  movedToday: boolean;
  /** Medication doses: taken today (N) of scheduled-today (M). */
  medTaken: number;
  medScheduled: number;
}

const EMPTY: Glance = {
  sleep: null,
  energy: null,
  cycleDay: null,
  cyclePhase: null,
  cyclePaused: false,
  waterCount: 0,
  waterTarget: 8,
  movedToday: false,
  medTaken: 0,
  medScheduled: 0,
};

export function HealthRoom(): JSX.Element {
  const navigate = useNavigate();
  const [g, setG] = useState<Glance>(EMPTY);

  const migrate = useCallback(async () => {
    await Promise.all([
      migrateSleep(),
      migrateCycle(),
      migrateBody(),
      migrateMedication(),
      migrateMood(),
    ]);
  }, []);

  const refresh = useCallback(async () => {
    const startOfToday = startOfLocalDay();
    const [
      latestSleep,
      current,
      paused,
      waterMl,
      age,
      lastMovement,
      meds,
      todayDoses,
      latestEnergy,
    ] = await Promise.all([
      sleepRepo.latestSleep(),
      cycleRepo.current(),
      cycleRepo.isPregnant(),
      bodyEvents.waterTotalToday(),
      bodyProfile.getAge(),
      bodyEvents.lastMovement(),
      medsRepo.list(),
      medEvents.listByKindSince('dose', startOfToday),
      moodEvents.latestEnergyOrMood(),
    ]);

    const target = waterTargetForAge(age);
    // One glass ≈ 250 mL (DEFAULT_GLASS_ML); show whole glasses toward target.
    const waterCount = Math.round(waterMl / 250);

    // Scheduled doses today = total schedule slots across every registered med
    // (one slot = one expected dose). Taken = today's dose events, capped at
    // the scheduled count so the tile never reads "4 of 3".
    const medScheduled = meds.reduce((acc, m) => acc + m.schedule.length, 0);
    const medTaken = Math.min(todayDoses.length, medScheduled || todayDoses.length);

    const movedToday =
      lastMovement != null && lastMovement.loggedAt >= startOfToday;

    // latestSleep() only returns kind='sleep' rows, but SleepEvent is a
    // discriminated union — narrow on kind before reading hoursSlept.
    const sleepHours =
      latestSleep && latestSleep.kind === 'sleep' ? latestSleep.data.hoursSlept : null;

    setG({
      sleep: formatHours(sleepHours),
      energy: energyGlanceLabel(latestEnergy),
      cycleDay: current ? current.daysSinceStart + 1 : null,
      cyclePhase: current ? phaseLabel(current.daysSinceStart, current.bleeding) : null,
      cyclePaused: paused,
      waterCount,
      waterTarget: target,
      movedToday,
      medTaken,
      medScheduled,
    });
  }, []);

  const { ready } = useModuleData({ migrationKey: 'room-health', migrate, refresh });

  // ── derived glance strings (calm fallbacks, never fabricated values) ──
  const sleepVal = !ready ? '·' : (g.sleep ?? 'no log');
  const sleepSub = !ready ? ' ' : g.sleep ? 'last night' : 'last night';

  const energyVal = !ready ? '·' : (g.energy ?? 'resting');
  const energySub = 'mood, folded in · read-only';

  const cycleVal = !ready
    ? '·'
    : g.cyclePaused
      ? 'paused'
      : g.cycleDay != null
        ? `day ${g.cycleDay}`
        : 'start';
  const cycleSub = !ready
    ? ' '
    : g.cyclePaused
      ? 'pregnancy pause'
      : g.cyclePhase ?? 'tap to begin';

  const waterVal = !ready ? '·' : `${g.waterCount} of ${g.waterTarget}`;
  const waterSub = !ready
    ? ' '
    : g.movedToday
      ? 'water · moved today'
      : 'water · movement';

  const medVal = !ready
    ? '·'
    : g.medScheduled > 0
      ? `${g.medTaken} of ${g.medScheduled} today`
      : g.medTaken > 0
        ? `${g.medTaken} today`
        : 'none yet';
  const medSub = !ready
    ? ' '
    : g.medScheduled > 0
      ? 'scheduled doses'
      : 'today · cabinet';

  return (
    <Stack gap={24}>
      {/* hero */}
      <Stack gap={10}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          room
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>
          health
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          how the body&rsquo;s doing — sleep, energy, your cycle, water, the meds.
        </Text>
      </Stack>

      {/* offer — the health watchers' calm C-model offers (hidden when none) */}
      <Stack gap={8}>
        <PatternCards module="sleep" />
        <PatternCards module="cycle" />
        <PatternCards module="body" />
        <PatternCards module="medication" />
      </Stack>

      {/* glance grid — big values, tap to drill (energy is read-only) */}
      <div style={{ marginTop: 4 }}>
        <div style={{ ...KICKER_STYLE, margin: '0 2px 12px' }}>a glance</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Tile to="/box/sleep" label="sleep" value={sleepVal} sub={sleepSub} />
          {/* energy: mood folded in — READ-ONLY, no drill, no chevron */}
          <Tile label="energy" value={energyVal} sub={energySub} />
          <Tile to="/box/cycle" label="cycle" value={cycleVal} sub={cycleSub} />
          <Tile to="/box/body" label="body" value={waterVal} sub={waterSub} />
          <Tile to="/box/medication" label="medication" value={medVal} sub={medSub} wide />
        </div>
      </div>

      {/* dump bar — a 2nd door to the same brain */}
      <div>
        <div style={{ ...KICKER_STYLE, margin: '4px 2px 12px' }}>add to health</div>
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="dump something about your health"
          style={{
            appearance: 'none',
            textAlign: 'left',
            width: '100%',
            border: 'none',
            borderRadius: 24,
            background: colors.cream,
            boxShadow: shadows.inset,
            padding: '14px 16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 15, color: colors.inkFaint, lineHeight: 1.4 }}>
            slept badly? took your meds? — just say it
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 2,
                height: 16,
                background: colors.sageDeep,
                verticalAlign: '-3px',
                marginLeft: 3,
                borderRadius: 2,
              }}
            />
          </span>
          <span
            aria-hidden
            style={{
              width: 40,
              height: 40,
              flex: '0 0 auto',
              borderRadius: '50%',
              background: colors.cream,
              boxShadow: shadows.raisedSm,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={colors.sageDeep}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="19" x2="12" y2="6" />
              <polyline points="6 11 12 5 18 11" />
            </svg>
          </span>
        </button>
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, color: colors.inkFaint, marginTop: 4 }}>
        tap any glance to see the full picture
      </div>
    </Stack>
  );
}

/** One glance tile: small label + a BIG value + a faint sub + a › chevron.
 *  The neumorphic surface is the SAME colour as the page — depth comes from
 *  shadow alone (the olive-neumorphic signature), not a lighter fill.
 *
 *  When `to` is omitted the tile is READ-ONLY: it renders as a plain div with
 *  no chevron and no link (the energy/mood tile — there's no mood screen). */
function Tile({
  to,
  label,
  value,
  sub,
  wide,
}: {
  to?: string;
  label: string;
  value: string;
  sub: string;
  wide?: boolean;
}): JSX.Element {
  const inner = (
    <div
      style={{
        position: 'relative',
        borderRadius: radii.card,
        background: colors.cream,
        boxShadow: shadows.raised,
        padding: '15px 16px',
        minHeight: 76,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        justifyContent: 'center',
      }}
    >
      {to != null && (
        <span
          aria-hidden
          style={{ position: 'absolute', top: 13, right: 14, color: colors.inkFaint, fontSize: 16, lineHeight: 1 }}
        >
          ›
        </span>
      )}
      <span style={{ fontSize: 11, color: colors.inkSoft, letterSpacing: '0.02em' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600, color: colors.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: colors.inkFaint }}>{sub}</span>
    </div>
  );

  if (to == null) {
    return <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>{inner}</div>;
  }

  return (
    <Link
      to={to}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
      {inner}
    </Link>
  );
}
