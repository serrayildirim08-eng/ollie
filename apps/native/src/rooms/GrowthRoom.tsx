/**
 * GrowthRoom — /room/growth
 *
 * Room of the rooms redesign (Household + Health shipped first). Built by
 * copying the HouseholdRoom / HealthRoom template exactly:
 *   - OFFER (smart) at the top: the growth watchers' calm C-model offers
 *     (PatternCards) for habits + goals, when there is one.
 *   - GLANCE (read): a tight grid of neumorphic tiles, each a small lowercase
 *     label + a BIG value + a faint sub + a › chevron — tap to drill into the
 *     box. habits · goals.
 *   - DUMP BAR (write): an inset well with an accent cursor + a round send
 *     button. v1 is a 2nd door to the SAME brain — it opens the home dump
 *     (which owns the full route + crisis + dispatch pipeline) rather than
 *     duplicating it.
 *
 * NO STREAKS — habits shows "N done today" of "N habits", never a run count
 * (mandate: feedback-ollie-no-streaks). goals carries protective machinery
 * (cap, low-mood delete-lock); the room only surfaces a calm active count + a
 * faint latest-progress line. No new data layer — reads the existing habits +
 * goals repos; every value is live, missing data degrades to a calm rest
 * state rather than a fabricated number.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors, shadows, radii } from '../theme/tokens';
import { useModuleData } from '../lib/useModuleData';
import { PatternCards } from '../patterns/PatternCards';
import { migrateHabits } from '../modules/habits/migrate';
import { listHabitRows } from '../modules/habits/repo';
import { migrateGoals } from '../modules/goals/migrate';
import { goals as goalsRepo } from '../modules/goals/repo';

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

interface Glance {
  /** Habits completed today (local day). */
  habitsDone: number;
  /** Total registered habits. */
  habitsTotal: number;
  /** Active goals (all registry rows are active — no archive flag). */
  goalsActive: number;
  /** Latest progress note across goals, or null when none logged. */
  latestProgress: string | null;
}

const EMPTY: Glance = {
  habitsDone: 0,
  habitsTotal: 0,
  goalsActive: 0,
  latestProgress: null,
};

export function GrowthRoom(): JSX.Element {
  const navigate = useNavigate();
  const [g, setG] = useState<Glance>(EMPTY);

  const migrate = useCallback(async () => {
    await Promise.all([migrateHabits(), migrateGoals()]);
  }, []);

  const refresh = useCallback(async () => {
    const [habitRows, goalsWithLatest] = await Promise.all([
      listHabitRows(),
      goalsRepo.listWithLatest(),
    ]);

    const habitsDone = habitRows.reduce((acc, r) => acc + (r.completedToday ? 1 : 0), 0);

    // Newest latest-progress across all goals (listWithLatest is newest-first
    // by created_at; pick the first goal that actually has a progress note).
    const withProgress = goalsWithLatest.find((gl) => gl.latestProgress != null);
    const latestProgress = withProgress?.latestProgress?.text?.trim() || null;

    setG({
      habitsDone,
      habitsTotal: habitRows.length,
      goalsActive: goalsWithLatest.length,
      latestProgress,
    });
  }, []);

  const { ready } = useModuleData({ migrationKey: 'room-growth', migrate, refresh });

  // ── derived glance strings (calm fallbacks, never fabricated values) ──
  const habitsVal = !ready
    ? '·'
    : g.habitsTotal > 0
      ? `${g.habitsDone} done today`
      : 'none yet';
  const habitsSub = !ready
    ? ' '
    : g.habitsTotal > 0
      ? `${g.habitsTotal} ${g.habitsTotal === 1 ? 'habit' : 'habits'}`
      : 'tap to begin';

  const goalsVal = !ready
    ? '·'
    : g.goalsActive > 0
      ? `${g.goalsActive} active`
      : 'none yet';
  const goalsSub = !ready
    ? ' '
    : g.latestProgress
      ? truncate(g.latestProgress, 38)
      : g.goalsActive > 0
        ? 'what you’re moving toward'
        : 'tap to begin';

  return (
    <Stack gap={24}>
      {/* hero */}
      <Stack gap={10}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          room
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>
          growth
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          your habits + what you&rsquo;re moving toward.
        </Text>
      </Stack>

      {/* offer — the growth watchers' calm C-model offers (hidden when none) */}
      <Stack gap={8}>
        <PatternCards module="habits" />
        <PatternCards module="goals" />
      </Stack>

      {/* glance grid — big values, tap to drill */}
      <div style={{ marginTop: 4 }}>
        <div style={{ ...KICKER_STYLE, margin: '0 2px 12px' }}>a glance</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Tile to="/box/habits" label="habits" value={habitsVal} sub={habitsSub} />
          <Tile to="/box/goals" label="goals" value={goalsVal} sub={goalsSub} />
        </div>
      </div>

      {/* dump bar — a 2nd door to the same brain */}
      <div>
        <div style={{ ...KICKER_STYLE, margin: '4px 2px 12px' }}>add to growth</div>
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="dump something about your habits or goals"
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
            did the thing? moved a goal forward? — just say it
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

/** Soft-truncate a sub line so a long progress note never breaks the tile. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** One glance tile: small label + a BIG value + a faint sub + a › chevron. The
 *  neumorphic surface is the SAME colour as the page — depth comes from shadow
 *  alone (the olive-neumorphic signature), not a lighter fill. */
function Tile({
  to,
  label,
  value,
  sub,
  wide,
}: {
  to: string;
  label: string;
  value: string;
  sub: string;
  wide?: boolean;
}): JSX.Element {
  return (
    <Link
      to={to}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
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
        <span
          aria-hidden
          style={{ position: 'absolute', top: 13, right: 14, color: colors.inkFaint, fontSize: 16, lineHeight: 1 }}
        >
          ›
        </span>
        <span style={{ fontSize: 11, color: colors.inkSoft, letterSpacing: '0.02em' }}>{label}</span>
        <span style={{ fontSize: 22, fontWeight: 600, color: colors.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          {value}
        </span>
        <span style={{ fontSize: 11, color: colors.inkFaint }}>{sub}</span>
      </div>
    </Link>
  );
}
