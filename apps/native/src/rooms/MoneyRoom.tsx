/**
 * MoneyRoom — /room/money
 *
 * The "money" room of the rooms redesign. Finance stays SEPARATE and thin —
 * it is not folded into Household or Work; money is amounts/stats, a quiet
 * read, not checkable rows. Built by copying the locked room template
 * (HouseholdRoom / HealthRoom) exactly:
 *   - OFFER (smart) at the top: the finance watchers' calm C-model offers
 *     (PatternCards) — recurring-detected, leak-warnings — when there is one.
 *   - GLANCE (read): a tight grid of neumorphic tiles, each a small lowercase
 *     label + a BIG value + a faint sub + a › chevron — tap to drill into the
 *     finance box. spent-this-week · bills.
 *   - DUMP BAR (write): an inset well with an accent cursor + a round send
 *     button. v1 is a 2nd door to the SAME brain — it opens the home dump
 *     rather than duplicating the route/dispatch pipeline.
 *
 * No new data layer, no new finance read — sums "spent this week" client-side
 * from the existing transactions.list() stream (each row carries occurredAt),
 * and counts upcoming bills from bills.list(). NO budgets, NO judgement, NO
 * fabricated metrics: when nothing is logged the tiles rest at "—" / "none"
 * rather than inventing a number.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors, shadows, radii } from '../theme/tokens';
import { useModuleData } from '../lib/useModuleData';
import { PatternCards } from '../patterns/PatternCards';
import { migrateFinance } from '../modules/finance/migrate';
import { transactions as txRepo, bills as billsRepo } from '../modules/finance/repo';

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

/** Midnight 7 days ago in local time, ms since epoch (rolling week window). */
function startOfWeekWindow(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 6 * 86_400_000;
}

/**
 * Format an amount with a currency prefix — mirrors FinanceBox's formatAmount
 * grammar exactly (read-only here) so the room and the box read the same.
 * Single-char symbols prefix directly; ISO codes get a space.
 */
function formatAmount(amount: number, currency: string | null): string {
  const fixed = amount.toFixed(2);
  if (!currency) return `$${fixed}`;
  if (currency.length === 1) return `${currency}${fixed}`;
  if (currency === 'USD') return `$${fixed}`;
  if (currency === 'EUR') return `€${fixed}`;
  if (currency === 'GBP') return `£${fixed}`;
  return `${currency} ${fixed}`;
}

interface Glance {
  /** Sum of this week's transactions in the dominant currency, or null. */
  weekTotal: number | null;
  weekCurrency: string | null;
  /** Number of transactions logged this week (the honest count fallback). */
  weekCount: number;
  /** Upcoming/recurring bills tracked, or 0. */
  billCount: number;
}

const EMPTY: Glance = {
  weekTotal: null,
  weekCurrency: null,
  weekCount: 0,
  billCount: 0,
};

export function MoneyRoom(): JSX.Element {
  const navigate = useNavigate();
  const [g, setG] = useState<Glance>(EMPTY);

  const migrate = useCallback(async () => {
    await migrateFinance();
  }, []);

  const refresh = useCallback(async () => {
    const windowStart = startOfWeekWindow();
    const [txs, bills] = await Promise.all([txRepo.list(), billsRepo.list()]);

    // This week's spends only. Sum per currency, then surface the dominant
    // bucket so a mixed $/€ ledger never lies by adding across currencies.
    const thisWeek = txs.filter((t) => t.occurredAt >= windowStart);
    const byCurrency = new Map<string, { currency: string | null; total: number }>();
    for (const t of thisWeek) {
      if (t.amount == null) continue;
      const key = t.currency ?? '_';
      const bucket = byCurrency.get(key) ?? { currency: t.currency ?? null, total: 0 };
      bucket.total += t.amount;
      byCurrency.set(key, bucket);
    }
    const dominant = [...byCurrency.values()].sort((a, b) => b.total - a.total)[0];

    setG({
      weekTotal: dominant ? dominant.total : null,
      weekCurrency: dominant ? dominant.currency : null,
      weekCount: thisWeek.length,
      billCount: bills.length,
    });
  }, []);

  const { ready } = useModuleData({ migrationKey: 'room-money', migrate, refresh });

  // ── derived glance strings (calm fallbacks, never fabricated values) ──
  // Prefer the honest weekly total; if no amounts parsed but rows exist, fall
  // back to the count; if nothing this week, rest quietly.
  const spentVal = !ready
    ? '·'
    : g.weekTotal != null
      ? formatAmount(g.weekTotal, g.weekCurrency)
      : g.weekCount > 0
        ? `${g.weekCount}`
        : '—';
  const spentSub = !ready
    ? ' '
    : g.weekTotal != null
      ? 'spent · last 7 days'
      : g.weekCount > 0
        ? 'logged · last 7 days'
        : 'nothing logged this week';

  const billsVal = !ready ? '·' : g.billCount > 0 ? String(g.billCount) : 'none';
  const billsSub = !ready
    ? ' '
    : g.billCount > 0
      ? 'recurring bills tracked'
      : 'no bills tracked yet';

  return (
    <Stack gap={24}>
      {/* hero */}
      <Stack gap={10}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          room
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>
          money
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          what&rsquo;s moving — a quiet read of the week and the bills, no budgets.
        </Text>
      </Stack>

      {/* offer — the finance watchers' calm C-model offers (hidden when none) */}
      <Stack gap={8}>
        <PatternCards module="finance" />
      </Stack>

      {/* glance grid — big values, tap to drill */}
      <div style={{ marginTop: 4 }}>
        <div style={{ ...KICKER_STYLE, margin: '0 2px 12px' }}>a glance</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Tile to="/box/finance" label="this week" value={spentVal} sub={spentSub} />
          <Tile to="/box/finance" label="bills" value={billsVal} sub={billsSub} />
        </div>
      </div>

      {/* dump bar — a 2nd door to the same brain */}
      <div>
        <div style={{ ...KICKER_STYLE, margin: '4px 2px 12px' }}>add to money</div>
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="dump something about money"
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
            spent something? a bill came in? — just say it
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
