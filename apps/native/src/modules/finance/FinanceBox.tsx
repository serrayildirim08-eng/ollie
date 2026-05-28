/**
 * FinanceBox · /box/finance screen.
 *
 * Visual port of `apps/web/src/modules/money-v2/screens/MoneyFace.tsx`
 * (the redesign/money-v2 branch). One serif hero number sits over three
 * expandable area-cards — bills / subscriptions / recent transactions —
 * each opening in place with a quiet key-value detail strip. Data,
 * polling and repo contracts are unchanged from the previous version.
 *
 * The hero shows the current calendar month's spend total in DM Serif
 * Display, with the currency symbol carried in DM Mono mute, mirroring
 * the money-v2 HeroNumber primitive. When the month carries multiple
 * currencies the dominant one anchors the hero and the rest line up as
 * a small caption beneath — the closest equivalent the finance repo can
 * express of money-v2's "safe to spend" + "horizon" pairing.
 *
 * Spends whose currency the router never resolved get rendered in umber
 * (#8A4B2C) — money-v2's "unaccounted" ink — so the user can see at a
 * glance what slipped through ledger parsing.
 *
 * Auto-refreshes on focus + every 6s so the screen catches additions
 * made from another tab / from a dump while the page is open.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { migrateFinance } from './migrate';
import { bills as billsRepo, subscriptions as subsRepo, transactions as txRepo } from './repo';
import type { FinanceBill, FinanceSubscription, FinanceTransaction } from './types';

// ── visual constants ──────────────────────────────────────────────────────

/**
 * umber — money-v2's "unaccounted spend" ink. Native `colors` doesn't
 * surface it (per redesign tokens.css `--umber`) so it lives locally.
 */
const UMBER = '#8A4B2C';

const POLL_MS = 6000;

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const HERO_LEAD_STYLE: CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.02em',
  color: colors.inkFaint,
};

const HERO_CAPTION_STYLE: CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 13,
  fontWeight: 500,
  color: colors.inkFaint,
  textAlign: 'center',
};

const AREA_KEY_STYLE: CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.01em',
  color: colors.inkFaint,
  flexShrink: 0,
};

const AREA_VALUE_STYLE: CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: '-0.01em',
  color: colors.ink,
  flex: 1,
  minWidth: 0,
};

const AREA_DOT_STYLE: CSSProperties = {
  color: colors.hairline,
  margin: '0 8px',
  fontSize: 13,
};

const DETAIL_K_STYLE: CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 13,
  fontWeight: 500,
  color: colors.inkFaint,
};

const DETAIL_V_STYLE: CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 13,
  fontWeight: 500,
  color: colors.ink,
  fontVariantNumeric: 'tabular-nums',
};

// ── component ─────────────────────────────────────────────────────────────

type AreaKey = 'bills' | 'subscriptions' | 'recent transactions';

export function FinanceBox(): JSX.Element {
  const [txs, setTxs] = useState<FinanceTransaction[]>([]);
  const [billRows, setBillRows] = useState<FinanceBill[]>([]);
  const [subRows, setSubRows] = useState<FinanceSubscription[]>([]);
  const [ready, setReady] = useState(false);
  const [openCard, setOpenCard] = useState<AreaKey | null>(null);

  const refresh = useCallback(async () => {
    const [t, b, s] = await Promise.all([
      txRepo.list(),
      billsRepo.list(),
      subsRepo.list(),
    ]);
    setTxs(t);
    setBillRows(b);
    setSubRows(s);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateFinance();
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

  const handleRemoveTx = useCallback(
    async (id: string) => {
      await txRepo.remove(id);
      await refresh();
    },
    [refresh],
  );
  const handleRemoveBill = useCallback(
    async (id: string) => {
      await billsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );
  const handleRemoveSub = useCallback(
    async (id: string) => {
      await subsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const monthTotals = useMemo(() => sumThisMonth(txs), [txs]);
  const hasData = txs.length > 0 || billRows.length > 0 || subRows.length > 0;

  const toggle = useCallback((k: AreaKey) => {
    setOpenCard((cur) => (cur === k ? null : k));
  }, []);

  // ── glance lines for area-cards ────────────────────────────────────────

  const nextBill = billRows[0] ?? null;
  const billsLine: ReactNode = nextBill
    ? (
      <>
        {nextBill.merchant} <b style={{ fontFamily: fonts.mono, fontWeight: 500 }}>
          {formatAmount(nextBill.amount, nextBill.currency)}
        </b>
        {nextBill.cadence ? ` · ${nextBill.cadence}` : ''}
      </>
    )
    : 'add the ones you know';

  const subsLine: ReactNode = subRows.length > 0
    ? (
      <>
        <b style={{ fontFamily: fonts.mono, fontWeight: 500 }}>{subRows.length}</b>
        {subRows.length === 1 ? ' tracked' : ' tracked'}
      </>
    )
    : 'none picked up yet';

  const txLine: ReactNode = txs.length > 0
    ? (
      <>
        <b style={{ fontFamily: fonts.mono, fontWeight: 500 }}>
          {formatAmount(txs[0]!.amount, txs[0]!.currency)}
        </b>
        {txs[0]!.merchant ? ` · ${txs[0]!.merchant}` : ''}
      </>
    )
    : "nothing logged yet — try 'spent $40 at sephora'";

  return (
    <Stack gap={48}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text scale="display">Finance</Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : (
        <Stack gap={40}>
          {/* HERO — this month total in DM Serif Display */}
          <MonthHero totals={monthTotals} hasData={hasData} />

          {/* AREA CARDS — expandable in-place */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <AreaCard
              first
              areaKey="bills"
              value={billsLine}
              open={openCard === 'bills'}
              onToggle={() => toggle('bills')}
            >
              {billRows.length === 0 ? (
                <EmptyLine text="no bills yet — try dumping 'netflix bill monthly'" />
              ) : (
                <DetailList>
                  {billRows.map((item) => (
                    <BillDetailRow
                      key={item.id}
                      item={item}
                      onRemove={() => void handleRemoveBill(item.id)}
                    />
                  ))}
                </DetailList>
              )}
            </AreaCard>

            <AreaCard
              areaKey="subscriptions"
              value={subsLine}
              open={openCard === 'subscriptions'}
              onToggle={() => toggle('subscriptions')}
            >
              {subRows.length === 0 ? (
                <EmptyLine text="no subscriptions yet — try dumping 'subscribed to spotify'" />
              ) : (
                <DetailList>
                  {subRows.map((item) => (
                    <SubDetailRow
                      key={item.id}
                      item={item}
                      onRemove={() => void handleRemoveSub(item.id)}
                    />
                  ))}
                </DetailList>
              )}
            </AreaCard>

            <AreaCard
              areaKey="recent transactions"
              value={txLine}
              open={openCard === 'recent transactions'}
              onToggle={() => toggle('recent transactions')}
            >
              {txs.length === 0 ? (
                <EmptyLine text="no transactions yet — try dumping 'paid rent' or 'spent $40 at sephora'" />
              ) : (
                <DetailList>
                  {txs.map((item) => (
                    <TxDetailRow
                      key={item.id}
                      item={item}
                      onRemove={() => void handleRemoveTx(item.id)}
                    />
                  ))}
                </DetailList>
              )}
            </AreaCard>
          </div>
        </Stack>
      )}
    </Stack>
  );
}

// ── hero ──────────────────────────────────────────────────────────────────

/**
 * MonthHero — the calm safe-to-spend stand-in.
 *
 * Sorts monthTotals biggest-first, anchors the dominant currency in a
 * large serif figure, and lists secondaries underneath in DM Mono mute.
 * Unknown-currency totals carry the umber ink — money-v2's "unaccounted".
 */
function MonthHero({
  totals,
  hasData,
}: {
  totals: MonthTotal[];
  hasData: boolean;
}): JSX.Element {
  if (totals.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={HERO_LEAD_STYLE}>this month</div>
        <div
          style={{
            marginTop: 18,
            fontFamily: fonts.serif,
            fontSize: 28,
            fontWeight: 400,
            color: colors.ink,
            letterSpacing: '-0.018em',
            textAlign: 'center',
            lineHeight: 1.35,
            maxWidth: 260,
          }}
        >
          {hasData
            ? 'nothing landed this month yet'
            : 'a few spends and ollie can work this out'}
        </div>
        <div style={{ marginTop: 14, ...HERO_CAPTION_STYLE }}>
          {hasData ? 'still a quiet ledger' : 'nothing logged yet'}
        </div>
      </div>
    );
  }

  // Biggest total anchors the hero; rest line up beneath it.
  const sorted = [...totals].sort((a, b) => b.total - a.total);
  const lead = sorted[0]!;
  const rest = sorted.slice(1);
  const isUnaccounted = lead.currency == null;
  const { symbol, body } = splitAmount(lead.total, lead.currency);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={HERO_LEAD_STYLE}>this month</div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'baseline',
          fontFamily: fonts.serif,
          fontSize: 72,
          fontWeight: 400,
          color: isUnaccounted ? UMBER : colors.ink,
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}
      >
        <span
          style={{
            fontFamily: fonts.mono,
            fontWeight: 400,
            fontSize: 44,
            color: isUnaccounted ? UMBER : colors.inkFaint,
            marginRight: 2,
          }}
        >
          {symbol}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{body}</span>
      </div>

      {/* horizon bar — a soft hairline that holds the eye even when empty */}
      <div
        style={{
          marginTop: 26,
          width: 188,
          height: 4,
          borderRadius: 3,
          background: colors.hairlineSoft,
        }}
        aria-hidden
      />

      {rest.length > 0 && (
        <div
          style={{
            marginTop: 13,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {rest.map((m) => {
            const muted = m.currency == null;
            return (
              <div
                key={m.currency ?? '_'}
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 13,
                  fontWeight: 500,
                  color: muted ? UMBER : colors.inkFaint,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatAmount(m.total, m.currency)}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: rest.length > 0 ? 10 : 13, ...HERO_CAPTION_STYLE }}>
        {lead.currency ?? 'unaccounted'}
        {' · '}
        {monthLabel(new Date())}
      </div>
    </div>
  );
}

// ── area card ─────────────────────────────────────────────────────────────

/**
 * AreaCard — the redesign's expandable info-row. Two states (collapsed /
 * expanded); the body slot carries our detail list and remove controls.
 * Top/bottom hairlines mirror money-v2 AreaCard so consecutive cards
 * stack cleanly without double rules.
 */
function AreaCard({
  areaKey,
  value,
  open,
  onToggle,
  first = false,
  children,
}: {
  areaKey: string;
  value: ReactNode;
  open: boolean;
  onToggle: () => void;
  first?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        borderTop: first ? `1px solid ${colors.hairline}` : undefined,
        borderBottom: `1px solid ${colors.hairline}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '19px 2px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 0,
          cursor: 'pointer',
          textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={AREA_KEY_STYLE}>{areaKey}</span>
        <span style={AREA_DOT_STYLE} aria-hidden>·</span>
        <span style={AREA_VALUE_STYLE}>{value}</span>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignSelf: 'center',
            marginLeft: 8,
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 180ms ease-out',
            color: colors.inkFaint,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div style={{ boxSizing: 'border-box', padding: '0 2px 22px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function DetailList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {children}
    </div>
  );
}

function EmptyLine({ text }: { text: string }): JSX.Element {
  return (
    <div
      style={{
        fontFamily: fonts.sans,
        fontSize: 13,
        fontWeight: 500,
        color: colors.inkFaint,
        letterSpacing: '0.01em',
      }}
    >
      {text}
    </div>
  );
}

// ── detail rows ───────────────────────────────────────────────────────────

function BillDetailRow({
  item,
  onRemove,
}: {
  item: FinanceBill;
  onRemove: () => void;
}): JSX.Element {
  const muted = item.currency == null && item.amount != null;
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <span style={DETAIL_K_STYLE}>
        {item.merchant}
        {item.cadence ? (
          <span style={{ color: colors.inkGhost, marginLeft: 6 }}>· {item.cadence}</span>
        ) : null}
      </span>
      <Row gap={8} align="baseline">
        <span style={{ ...DETAIL_V_STYLE, color: muted ? UMBER : colors.ink }}>
          {formatAmount(item.amount, item.currency)}
        </span>
        <RemoveButton onClick={onRemove} />
      </Row>
    </Row>
  );
}

function SubDetailRow({
  item,
  onRemove,
}: {
  item: FinanceSubscription;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <span style={DETAIL_K_STYLE}>{item.name}</span>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

function TxDetailRow({
  item,
  onRemove,
}: {
  item: FinanceTransaction;
  onRemove: () => void;
}): JSX.Element {
  const muted = item.currency == null && item.amount != null;
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <span style={DETAIL_K_STYLE}>{item.merchant ?? '—'}</span>
      <Row gap={8} align="baseline">
        <span style={{ ...DETAIL_V_STYLE, color: muted ? UMBER : colors.ink }}>
          {formatAmount(item.amount, item.currency)}
        </span>
        <RemoveButton onClick={onRemove} />
      </Row>
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

// ── formatting helpers ────────────────────────────────────────────────────

interface MonthTotal {
  currency: string | null;
  total: number;
}

/** Format an amount with currency prefix. Falls back to "—" if amount null. */
function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  const fixed = amount.toFixed(2);
  if (!currency) return `$${fixed}`;
  // Single-character symbols ($, €, £, ¥) prefix directly; ISO codes get
  // a space ("USD 15.00") so they read as letters not noise.
  if (currency.length === 1) return `${currency}${fixed}`;
  if (currency === 'USD') return `$${fixed}`;
  if (currency === 'EUR') return `€${fixed}`;
  if (currency === 'GBP') return `£${fixed}`;
  return `${currency} ${fixed}`;
}

/**
 * Split an amount into a mute-coloured currency symbol + body number so
 * the hero can render them at different sizes (money-v2 HeroNumber).
 */
function splitAmount(
  amount: number,
  currency: string | null,
): { symbol: string; body: string } {
  const fixed = amount.toFixed(2);
  if (!currency) return { symbol: '$', body: fixed };
  if (currency.length === 1) return { symbol: currency, body: fixed };
  if (currency === 'USD') return { symbol: '$', body: fixed };
  if (currency === 'EUR') return { symbol: '€', body: fixed };
  if (currency === 'GBP') return { symbol: '£', body: fixed };
  // For unknown ISO codes the symbol slot carries the code; the body
  // remains the numeric value so DM Serif still anchors the hero.
  return { symbol: currency, body: fixed };
}

/** Group transactions in the current calendar month and sum per currency. */
function sumThisMonth(rows: FinanceTransaction[]): MonthTotal[] {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const totals = new Map<string, MonthTotal>();
  for (const r of rows) {
    if (r.amount == null) continue;
    if (r.occurredAt < monthStart) continue;
    const key = r.currency ?? '_';
    const existing = totals.get(key);
    if (existing) {
      existing.total += r.amount;
    } else {
      totals.set(key, { currency: r.currency, total: r.amount });
    }
  }
  return [...totals.values()];
}

/** "May 2026" — used in the hero caption. */
function monthLabel(d: Date): string {
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' }).toLowerCase();
}
