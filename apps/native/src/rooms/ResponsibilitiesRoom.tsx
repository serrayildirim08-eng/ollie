/**
 * ResponsibilitiesRoom — /room/responsibilities
 *
 * Room 3 of the rooms redesign (Household + Health shipped first). Built by
 * copying the HouseholdRoom / HealthRoom template EXACTLY:
 *   - OFFER (smart) at the top: the work + admin watchers' calm C-model offers
 *     (PatternCards), when there is one.
 *   - GLANCE (read): a tight grid of neumorphic tiles, each a small lowercase
 *     label + a BIG value + a faint sub + a › chevron — tap to drill in.
 *       · to-do    → open tasks across work + admin. drill /todo (the shared
 *         task sink where both modules' open rows already aggregate).
 *       · focus    → today's logged focus minutes if the work module has any,
 *         else how many tasks are on today. drill /box/work.
 *       · renewals → upcoming admin renewals (passport / lease / insurance).
 *         drill /box/admin.
 *   - DUMP BAR (write): an inset well with an accent cursor + a round send
 *     button. v1 is a 2nd door to the SAME brain — it opens the home dump
 *     rather than duplicating the route/crisis/dispatch pipeline.
 *
 * No new data layer — reads the existing work + admin repos. Every value is
 * live; missing data degrades to a calm resting state ("clear" / "none yet")
 * rather than a fabricated number. No streaks anywhere.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors, shadows, radii } from '../theme/tokens';
import { useModuleData } from '../lib/useModuleData';
import { PatternCards } from '../patterns/PatternCards';
import { migrateWork } from '../modules/work/migrate';
import { tasks as workTasks, events as workEvents } from '../modules/work/repo';
import { migrateAdmin } from '../modules/admin/migrate';
import { tasks as adminTasks, renewals as adminRenewals } from '../modules/admin/repo';

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

/** Today's local-day window [from, to) in ms — mirrors the work module. */
function todayWindow(now: number = Date.now()): { fromMs: number; toMs: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

interface Glance {
  /** Open tasks: work (kind task/deadline) + admin, both open-only. */
  todoCount: number;
  /** Minutes of focus logged today (work module). 0 when none. */
  focusMinutes: number;
  /** Upcoming admin renewals (future / undated; expired excluded). */
  renewalsCount: number;
}

const EMPTY: Glance = { todoCount: 0, focusMinutes: 0, renewalsCount: 0 };

export function ResponsibilitiesRoom(): JSX.Element {
  const navigate = useNavigate();
  const [g, setG] = useState<Glance>(EMPTY);

  const migrate = useCallback(async () => {
    await Promise.all([migrateWork(), migrateAdmin()]);
  }, []);

  const refresh = useCallback(async () => {
    const { fromMs, toMs } = todayWindow();
    const [openWork, openAdmin, focusMin, upcomingRenewals] = await Promise.all([
      workTasks.listOpen(),
      adminTasks.listOpen(),
      workEvents.focusMinutesBetween(fromMs, toMs),
      adminRenewals.listOpen(),
    ]);
    setG({
      todoCount: openWork.length + openAdmin.length,
      focusMinutes: focusMin,
      renewalsCount: upcomingRenewals.length,
    });
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'room-responsibilities',
    migrate,
    refresh,
  });

  // ── derived glance strings (calm fallbacks, never fabricated values) ──
  const todoVal = !ready ? '·' : g.todoCount > 0 ? String(g.todoCount) : 'clear';
  const todoSub = !ready
    ? ' '
    : g.todoCount > 0
      ? 'open · work + admin'
      : 'nothing open';

  // focus: today's logged minutes if any, else fall back to today's task count
  // (no focus logged yet) — keeps the tile honest without inventing a number.
  const focusVal = !ready
    ? '·'
    : g.focusMinutes > 0
      ? `${g.focusMinutes} min`
      : g.todoCount > 0
        ? `${g.todoCount} today`
        : 'open';
  const focusSub = !ready
    ? ' '
    : g.focusMinutes > 0
      ? 'focused today'
      : 'no focus logged yet';

  const renewalsVal = !ready
    ? '·'
    : g.renewalsCount > 0
      ? String(g.renewalsCount)
      : 'none';
  const renewalsSub = !ready
    ? ' '
    : g.renewalsCount > 0
      ? 'coming up'
      : 'nothing due';

  return (
    <Stack gap={24}>
      {/* hero */}
      <Stack gap={10}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          room
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>
          responsibilities
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          the things that won&rsquo;t wait — the to-dos, today&rsquo;s focus, the renewals.
        </Text>
      </Stack>

      {/* offer — the work + admin watchers' calm C-model offers (hidden when none) */}
      <Stack gap={8}>
        <PatternCards module="work" />
        <PatternCards module="admin" />
      </Stack>

      {/* glance grid — big values, tap to drill */}
      <div style={{ marginTop: 4 }}>
        <div style={{ ...KICKER_STYLE, margin: '0 2px 12px' }}>a glance</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* to-do drills into the shared task sink, not a single box */}
          <Tile to="/todo" label="to-do" value={todoVal} sub={todoSub} />
          <Tile to="/box/work" label="focus" value={focusVal} sub={focusSub} />
          <Tile
            to="/box/admin"
            label="renewals"
            value={renewalsVal}
            sub={renewalsSub}
            wide
          />
        </div>
      </div>

      {/* dump bar — a 2nd door to the same brain */}
      <div>
        <div style={{ ...KICKER_STYLE, margin: '4px 2px 12px' }}>add to responsibilities</div>
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="dump something you need to handle"
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
            need to call someone? a deadline? — just say it
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
