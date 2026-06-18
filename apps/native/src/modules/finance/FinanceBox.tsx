/**
 * FinanceBox · /box/finance screen.
 *
 * Visual port of `apps/web/src/modules/money-v2/screens/MoneyFace.tsx`
 * (the redesign/money-v2 branch). One serif hero number sits over three
 * expandable area-cards — bills / subscriptions / recent transactions —
 * each opening in place with a quiet key-value detail strip.
 *
 * The hero shows the current calendar month's TRUE burn — transactions
 * logged this month + monthly cost of every active subscription +
 * monthly-equivalent of every recurring bill — in DM Serif Display, with
 * the currency symbol carried in DM Mono mute (money-v2 HeroNumber). A
 * single quiet caption underneath unpacks the math:
 *   "$1200 spent · $15 subscriptions · $0 bills"
 * When the month carries multiple currencies the dominant one anchors
 * the hero and the rest line up as a small list beneath.
 *
 * Rows whose currency the router never resolved get rendered in umber
 * (#8A4B2C) — money-v2's "unaccounted" ink — captioned "no currency tag"
 * so the user can see at a glance what slipped through ledger parsing.
 *
 * Auto-refreshes on focus + every 6s so the screen catches additions
 * made from another tab / from a dump while the page is open.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  formatDays,
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateFinance } from './migrate';
import {
  bills as billsRepo,
  cadence as cadenceRepo,
  getMonthlyBurn,
  subscriptions as subsRepo,
  transactions as txRepo,
} from './repo';
import {
  detectFromTransactions,
  type RecurringSuggestion,
} from './recurring';
import {
  FINANCE_CATEGORIES,
  normaliseMerchant,
  type FinanceBill,
  type FinanceSubscription,
  type FinanceTransaction,
  type MonthlyBurn,
} from './types';

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
  const [burn, setBurn] = useState<MonthlyBurn[]>([]);
  const [merchantCadence, setMerchantCadence] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [ready, setReady] = useState(false);
  const [openCard, setOpenCard] = useState<AreaKey | null>(null);

  const refresh = useCallback(async () => {
    const [t, b, s, burnRows] = await Promise.all([
      txRepo.list(),
      billsRepo.list(),
      subsRepo.list(),
      getMonthlyBurn(),
    ]);
    setTxs(t);
    setBillRows(b);
    setSubRows(s);
    setBurn(burnRows);

    // Fan-out cadence reads — one per distinct merchant in the transaction
    // list. Keeps row render synchronous (no per-row async).
    const merchants = new Set<string>();
    for (const tx of t) {
      const key = normaliseMerchant(tx.merchant);
      if (key) merchants.add(key);
    }
    const pairs = await Promise.all(
      Array.from(merchants).map(
        async (m) => [m, await cadenceRepo.getMerchantCadenceFor(m)] as const,
      ),
    );
    setMerchantCadence(new Map(pairs));
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
  const handleLogTx = useCallback(
    async (input: {
      amount: number | null;
      merchant: string | null;
      category: string | null;
    }) => {
      await txRepo.add(input);
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

  const hasData = txs.length > 0 || billRows.length > 0 || subRows.length > 0;

  // Recurring detection — read-only surface. We re-derive on every tx
  // change rather than schedule a separate fetch since the detection is
  // a pure in-memory pass over the rows we already have.
  const suggestions = useMemo(() => detectFromTransactions(txs), [txs]);

  // Lead currency comes from the burn hero; we use it to format the
  // "$X recurring detected" caption so the unit matches what the eye
  // just landed on. Falls back to USD-style "$" when no burn is available.
  const recurringByLeadCurrency = useMemo(
    () => sumRecurringInLeadCurrency(suggestions, burn[0]?.currency ?? null),
    [suggestions, burn],
  );

  const toggle = useCallback((k: AreaKey) => {
    setOpenCard((cur) => (cur === k ? null : k));
  }, []);

  /**
   * Promote a suggestion to a real bill. The detected cadence
   * (monthly/yearly/weekly) maps straight onto a bill row — bills.add upserts
   * by (merchant, cadence) so a re-promote refreshes rather than duplicates.
   * Currency may be null when the router never resolved one; that's fine —
   * the bill row simply renders in umber ("no currency tag") like everywhere
   * else, and the math layer skips null-amount rows. After promotion we
   * refresh so the new bill lands in the Bills card; the suggestion naturally
   * stops nagging once the merchant's transactions stop being the only signal.
   */
  const handlePromoteSuggestion = useCallback(
    async (s: RecurringSuggestion) => {
      await billsRepo.add({
        merchant: s.merchant,
        amount: s.medianAmount,
        cadence: s.cadence,
      });
      await refresh();
    },
    [refresh],
  );

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
          {/* HERO — this month's true burn in DM Serif Display */}
          <MonthHero
            burn={burn}
            hasData={hasData}
            recurringDetected={recurringByLeadCurrency}
          />

          {/* TAP-TO-LOG — a quiet spend form so capture isn't dump-only. */}
          <LogSpendForm onLog={(i) => void handleLogTx(i)} />

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
                      cadence={
                        merchantCadence.get(
                          normaliseMerchant(item.merchant) ?? '',
                        )
                      }
                      onRemove={() => void handleRemoveTx(item.id)}
                    />
                  ))}
                </DetailList>
              )}
            </AreaCard>
          </div>

          {/* RECURRING SUGGESTIONS — silent unless detection found a pattern. */}
          {suggestions.length > 0 && (
            <RecurringList
              suggestions={suggestions}
              onPromote={(s) => void handlePromoteSuggestion(s)}
            />
          )}

          {/* LAYER-2 NOTICINGS — the watcher's soft pattern cards (doom-buying,
              duplicate, hyperfocus burst, cycle×spend …). Renders nothing when
              the watcher hasn't surfaced anything. */}
          <PatternCards module="finance" />
        </Stack>
      )}
    </Stack>
  );
}

// ── tap-to-log spend form ───────────────────────────────────────────────────

/**
 * LogSpendForm — a calm tap-to-log capture row so adding a spend isn't
 * brain-dump-only. Three fields: amount (DM Mono, numeric), merchant (where),
 * and a category picker (the preset chips + a freeform "other" path). No
 * budget bars, no remaining-balance, no shame — just "what did you spend".
 *
 * Starts collapsed as a single quiet "log a spend" affordance so it doesn't
 * compete with the hero; expands in place on tap. On submit it calls onLog
 * (which writes through the repo and mirrors into finance.records, carrying
 * the category the watchers need), then resets + collapses.
 *
 * The category is what unblocks the hyperfocus-burst + duplicate-by-category
 * watchers: every tap-logged spend can now carry one.
 */
function LogSpendForm({
  onLog,
}: {
  onLog: (input: {
    amount: number | null;
    merchant: string | null;
    category: string | null;
  }) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const reset = useCallback(() => {
    setAmount('');
    setMerchant('');
    setCategory(null);
  }, []);

  const parsedAmount = useMemo(() => {
    const cleaned = amount.replace(/[^0-9.]/g, '').trim();
    if (!cleaned) return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }, [amount]);

  // Something to log = at least one of amount / merchant / category is set.
  const canLog = parsedAmount != null || merchant.trim().length > 0 || category != null;

  const submit = useCallback(() => {
    if (!canLog) return;
    onLog({
      amount: parsedAmount,
      merchant: merchant.trim() || null,
      category,
    });
    reset();
    setOpen(false);
  }, [canLog, onLog, parsedAmount, merchant, category, reset]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: 'flex-start',
          background: 'none',
          border: 'none',
          padding: '4px 2px',
          cursor: 'pointer',
          color: colors.ink,
          fontFamily: fonts.sans,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.08em',
          fontVariantCaps: 'all-small-caps',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        + log a spend
      </button>
    );
  }

  return (
    <Stack gap={16}>
      {/* amount + merchant row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 120 }}>
          <span style={FIELD_LABEL_STYLE}>amount</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="amount"
            style={{ ...FIELD_INPUT_STYLE, fontFamily: fonts.mono, fontVariantNumeric: 'tabular-nums' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={FIELD_LABEL_STYLE}>where</span>
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="sephora, the gym…"
            aria-label="merchant"
            style={FIELD_INPUT_STYLE}
          />
        </label>
      </div>

      {/* category picker — preset chips, tap to (de)select */}
      <Stack gap={8}>
        <span style={FIELD_LABEL_STYLE}>category</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {FINANCE_CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(active ? null : c)}
                style={{
                  background: active ? colors.ink : 'transparent',
                  color: active ? colors.cream : colors.inkFaint,
                  border: `1px solid ${active ? colors.ink : colors.hairline}`,
                  borderRadius: 999,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  fontVariantCaps: 'all-small-caps',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'background 140ms ease-out, color 140ms ease-out',
                }}
              >
                {c}
              </button>
            );
          })}
        </div>
      </Stack>

      {/* actions */}
      <Row gap={8} align="center">
        <button
          type="button"
          onClick={submit}
          disabled={!canLog}
          style={{
            background: canLog ? colors.ink : 'transparent',
            color: canLog ? colors.cream : colors.inkGhost,
            border: `1px solid ${canLog ? colors.ink : colors.hairline}`,
            borderRadius: 8,
            padding: '8px 18px',
            cursor: canLog ? 'pointer' : 'default',
            fontFamily: fonts.sans,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            fontVariantCaps: 'all-small-caps',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          log it
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          style={{
            background: 'none',
            border: 'none',
            padding: '8px 8px',
            cursor: 'pointer',
            color: colors.inkFaint,
            fontFamily: fonts.sans,
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.08em',
            fontVariantCaps: 'all-small-caps',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          cancel
        </button>
      </Row>
    </Stack>
  );
}

const FIELD_LABEL_STYLE: CSSProperties = {
  fontFamily: fonts.sans,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  color: colors.inkFaint,
  fontVariantCaps: 'all-small-caps',
};

const FIELD_INPUT_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${colors.hairline}`,
  padding: '6px 2px',
  fontFamily: fonts.sans,
  fontSize: 15,
  fontWeight: 500,
  color: colors.ink,
  outline: 'none',
};

// ── hero ──────────────────────────────────────────────────────────────────

/**
 * MonthHero — the calm safe-to-spend stand-in.
 *
 * Sorts MonthlyBurn biggest-first, anchors the dominant currency's total
 * (transactions + subscriptions + bills) in a large serif figure, lists
 * the breakdown beneath as "$X spent · $Y subscriptions · $Z bills", then
 * any secondary currencies. Unknown-currency totals carry the umber ink
 * (money-v2's "no currency tag" rail) so currency-parse leakage stays
 * visible without lying about its meaning.
 */
function MonthHero({
  burn,
  hasData,
  recurringDetected,
}: {
  burn: MonthlyBurn[];
  hasData: boolean;
  /**
   * Sum of detected recurring monthly cost, expressed in the lead
   * currency. `null` when detection found nothing — caller computes; we
   * just render. Show as "$X recurring detected" under the breakdown.
   */
  recurringDetected: { amount: number; currency: string | null } | null;
}): JSX.Element {
  if (burn.length === 0) {
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

  const lead = burn[0]!;
  const rest = burn.slice(1);
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

      {/* breakdown — txns · subs · bills · (in the lead currency) */}
      <BurnBreakdown row={lead} />

      {/* recurring caption — only when detection found at least one pattern */}
      {recurringDetected && (
        <div
          style={{
            marginTop: 4,
            fontFamily: fonts.sans,
            fontSize: 11,
            fontWeight: 500,
            color: colors.inkFaint,
            letterSpacing: '0.06em',
            fontVariantCaps: 'all-small-caps',
            textAlign: 'center',
          }}
        >
          {`${formatAmount(recurringDetected.amount, recurringDetected.currency)} recurring detected`}
        </div>
      )}

      {/* horizon bar — a soft hairline that holds the eye even when empty */}
      <div
        style={{
          marginTop: 18,
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
                {muted ? ' · no currency tag' : ''}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: rest.length > 0 ? 10 : 13, ...HERO_CAPTION_STYLE }}>
        {lead.currency ?? 'no currency tag'}
        {' · '}
        {monthLabel(new Date())}
      </div>
    </div>
  );
}

/**
 * BurnBreakdown — the one-line "$1200 spent · $15 subscriptions · $0 bills"
 * caption that unpacks the headline. Stays under the hero number so the
 * eye lands on the total first; renders silent when ALL three components
 * are zero (the empty-state already speaks for that case).
 */
function BurnBreakdown({ row }: { row: MonthlyBurn }): JSX.Element | null {
  if (row.transactions === 0 && row.subscriptions === 0 && row.billsDue === 0) {
    return null;
  }
  const muted = row.currency == null;
  return (
    <div
      style={{
        marginTop: 10,
        fontFamily: fonts.mono,
        fontSize: 12,
        fontWeight: 500,
        color: muted ? UMBER : colors.inkFaint,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.01em',
        textAlign: 'center',
      }}
    >
      {`${formatAmount(row.transactions, row.currency)} spent`}
      {' · '}
      {`${formatAmount(row.subscriptions, row.currency)} subscriptions`}
      {' · '}
      {`${formatAmount(row.billsDue, row.currency)} bills`}
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
    <Stack gap={2}>
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
      <WhenCaption ts={item.addedAt} />
    </Stack>
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
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <span style={DETAIL_K_STYLE}>{item.name}</span>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={item.addedAt} />
    </Stack>
  );
}

function TxDetailRow({
  item,
  cadence,
  onRemove,
}: {
  item: FinanceTransaction;
  cadence?: CadenceEstimate | undefined;
  onRemove: () => void;
}): JSX.Element {
  const muted = item.currency == null && item.amount != null;
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <span style={DETAIL_K_STYLE}>
          {item.merchant ?? '—'}
          {item.category ? (
            <span style={{ color: colors.inkGhost, marginLeft: 6 }}>· {item.category}</span>
          ) : null}
        </span>
        <Row gap={8} align="baseline">
          <span style={{ ...DETAIL_V_STYLE, color: muted ? UMBER : colors.ink }}>
            {formatAmount(item.amount, item.currency)}
          </span>
          <RemoveButton onClick={onRemove} />
        </Row>
      </Row>
      <WhenCaption ts={item.occurredAt} />
      {cadence && item.merchant && (
        <CadenceHint estimate={cadence} subject={item.merchant} />
      )}
    </Stack>
  );
}

/**
 * Faint sub-line under a transaction row: "last sephora 4 days ago ·
 * usually every 7 days". Silent at low-data confidence — Serra's minimal
 * UI prefers nothing to a misleading prediction. One spend doesn't make a
 * pattern; we wait for the second.
 */
function CadenceHint({
  estimate,
  subject,
}: {
  estimate: CadenceEstimate;
  subject: string;
}): JSX.Element | null {
  if (estimate.confidence === 'low-data' || estimate.lastTs == null) {
    return null;
  }
  const now = Date.now();
  const since = daysSinceLast(estimate, now) ?? 0;
  const every = medianIntervalDays(estimate);
  const sinceLabel = formatDays(since);
  const everyLabel = every >= 1 ? formatDays(every) : 'less than a day';
  return (
    <span
      style={{
        fontFamily: fonts.sans,
        fontSize: 11,
        color: colors.inkFaint,
        fontWeight: 500,
        letterSpacing: '0.06em',
        fontVariantCaps: 'all-small-caps',
      }}
    >
      {`last ${subject} ${sinceLabel} ago · usually every ${everyLabel}`}
    </span>
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

// ── recurring suggestions ─────────────────────────────────────────────────

/**
 * The "looks recurring · promote?" strip that sits under the area-cards
 * once detection finds at least one pattern. Each row is a tiny prompt:
 *   "netflix · monthly · $15.99       looks recurring — promote?"
 * Tapping invokes onPromote(); the parent owns what that means (today: a
 * console hint; see the TODO on handlePromoteSuggestion).
 *
 * Renders nothing for an empty list — the caller already guards on it but
 * we mirror the guard so this component is safe to mount unconditionally.
 */
function RecurringList({
  suggestions,
  onPromote,
}: {
  suggestions: RecurringSuggestion[];
  onPromote: (s: RecurringSuggestion) => void;
}): JSX.Element | null {
  if (suggestions.length === 0) return null;
  return (
    <Stack gap={6}>
      <div
        style={{
          fontFamily: fonts.sans,
          fontSize: 11,
          fontWeight: 600,
          color: colors.inkFaint,
          letterSpacing: '0.08em',
          fontVariantCaps: 'all-small-caps',
        }}
      >
        looks recurring
      </div>
      <DetailList>
        {suggestions.map((s) => (
          <RecurringRow
            key={`${s.merchant}:${s.cadence}`}
            suggestion={s}
            onPromote={() => onPromote(s)}
          />
        ))}
      </DetailList>
    </Stack>
  );
}

function RecurringRow({
  suggestion,
  onPromote,
}: {
  suggestion: RecurringSuggestion;
  onPromote: () => void;
}): JSX.Element {
  const { merchant, cadence, medianAmount, currency, sampleSize } = suggestion;
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <span style={DETAIL_K_STYLE}>
        {merchant}
        <span style={{ color: colors.inkGhost, marginLeft: 6 }}>· {cadence}</span>
      </span>
      <Row gap={8} align="baseline">
        <span style={DETAIL_V_STYLE}>
          {formatAmount(medianAmount, currency)}
        </span>
        <span
          style={{
            fontFamily: fonts.sans,
            fontSize: 11,
            color: colors.inkFaint,
            fontWeight: 500,
            letterSpacing: '0.06em',
            fontVariantCaps: 'all-small-caps',
          }}
          aria-hidden
        >
          · {sampleSize} seen
        </span>
        <button
          type="button"
          onClick={onPromote}
          aria-label={`promote ${merchant} to ${cadence}`}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            color: colors.ink,
            cursor: 'pointer',
            fontFamily: fonts.sans,
            fontVariantCaps: 'all-small-caps',
            letterSpacing: '0.08em',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          promote
        </button>
      </Row>
    </Row>
  );
}

/**
 * Roll detection results into a single "recurring detected" caption value,
 * expressed in the lead currency from the burn. Currency-mismatched
 * suggestions are dropped from the sum (we don't fake an FX) — the user
 * still sees them as individual rows in the RecurringList below. When the
 * lead currency is unresolved (null), we sum any null-currency rows
 * together so the caption still reads sensibly under the "no currency
 * tag" hero.
 *
 * Returns `null` when nothing remains — caller renders nothing.
 */
function sumRecurringInLeadCurrency(
  suggestions: RecurringSuggestion[],
  leadCurrency: string | null,
): { amount: number; currency: string | null } | null {
  let total = 0;
  let counted = 0;
  for (const s of suggestions) {
    if (s.medianAmount == null) continue;
    if (s.currency !== leadCurrency) continue;
    // Express every cycle as a monthly-equivalent so the caption reads
    // consistently with the hero (which is already a per-month figure).
    const monthly = toMonthlyEquivalent(s.medianAmount, s.cadence);
    total += monthly;
    counted += 1;
  }
  if (counted === 0) return null;
  return { amount: total, currency: leadCurrency };
}

/** Convert a per-cycle amount into its monthly-equivalent. */
function toMonthlyEquivalent(
  amount: number,
  cadence: 'monthly' | 'weekly' | 'yearly',
): number {
  switch (cadence) {
    case 'monthly': return amount;
    case 'weekly':  return amount * (52 / 12);
    case 'yearly':  return amount / 12;
  }
}

// ── formatting helpers ────────────────────────────────────────────────────

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

/** "may 2026" — used in the hero caption. */
function monthLabel(d: Date): string {
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' }).toLowerCase();
}
