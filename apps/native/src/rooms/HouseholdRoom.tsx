/**
 * HouseholdRoom — /room/household
 *
 * The first "room", built to the agreed room mock (ollie-room-health.html):
 *   - OFFER (smart) at the top: the household watchers' one calm C-model offer
 *     (PatternCards), when there is one.
 *   - GLANCE (read): a tight grid of neumorphic tiles, each a small lowercase
 *     label + a BIG value + a faint sub + a › chevron — tap to drill into the
 *     box. chores · to buy · pantry.
 *   - DUMP BAR (write): an inset well with an accent cursor + a round send
 *     button. "say it, don't tap-edit". v1 is a 2nd door to the SAME brain — it
 *     opens the home dump (which owns the full route + crisis + dispatch
 *     pipeline) rather than duplicating it; inline dispatch is a follow-up.
 *
 * No new data layer — reads the existing grocery + chores repos.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors, shadows, radii } from '../theme/tokens';
import { useModuleData } from '../lib/useModuleData';
import { PatternCards } from '../patterns/PatternCards';
import { migrateChores } from '../modules/chores/migrate';
import { chores as choresRepo } from '../modules/chores/repo';
import { migrateGrocery } from '../modules/grocery/migrate';
import { pantry as pantryRepo, shopping as shoppingRepo } from '../modules/grocery/repo';

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
  choresToday: number;
  toBuy: number;
  pantryCount: number;
}

export function HouseholdRoom(): JSX.Element {
  const navigate = useNavigate();
  const [g, setG] = useState<Glance>({ choresToday: 0, toBuy: 0, pantryCount: 0 });

  const migrate = useCallback(async () => {
    await Promise.all([migrateChores(), migrateGrocery()]);
  }, []);

  const refresh = useCallback(async () => {
    const [dueToday, openOneOff, shop, pantry] = await Promise.all([
      choresRepo.listDueToday(),
      choresRepo.listOpenOneOff(),
      shoppingRepo.list(),
      pantryRepo.list(),
    ]);
    setG({
      choresToday: dueToday.length + openOneOff.length,
      toBuy: shop.length,
      pantryCount: pantry.length,
    });
  }, []);

  const { ready } = useModuleData({ migrationKey: 'room-household', migrate, refresh });

  return (
    <Stack gap={24}>
      {/* hero */}
      <Stack gap={10}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          room
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>
          household
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          running the home — the chores, the shopping, what&rsquo;s on the shelf.
        </Text>
      </Stack>

      {/* offer — the household watchers' calm C-model offers (hidden when none) */}
      <Stack gap={8}>
        <PatternCards module="chores" />
        <PatternCards module="grocery" />
      </Stack>

      {/* glance grid — big values, tap to drill */}
      <div style={{ marginTop: 4 }}>
        <div style={{ ...KICKER_STYLE, margin: '0 2px 12px' }}>a glance</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Tile
            to="/box/chores"
            label="chores"
            value={ready ? (g.choresToday > 0 ? String(g.choresToday) : 'clear') : '·'}
            sub={ready ? (g.choresToday > 0 ? "on today's list" : 'all clear today') : ' '}
          />
          <Tile
            to="/box/grocery"
            label="to buy"
            value={ready ? String(g.toBuy) : '·'}
            sub="on the shopping list"
          />
          <Tile
            to="/box/grocery"
            label="pantry"
            value={ready ? String(g.pantryCount) : '·'}
            sub="in the pantry · by aisle"
            wide
          />
        </div>
      </div>

      {/* dump bar — a 2nd door to the same brain */}
      <div>
        <div style={{ ...KICKER_STYLE, margin: '4px 2px 12px' }}>add to household</div>
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="dump something for the house"
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
            cleaned the kitchen? need milk? — just say it
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
