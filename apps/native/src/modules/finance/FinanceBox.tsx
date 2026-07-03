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

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  formatDays,
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row, Box } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts, radii, shadows } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateFinance } from './migrate';
import {
  assets as assetsRepo,
  bills as billsRepo,
  cadence as cadenceRepo,
  income as incomeRepo,
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
  type FinanceAsset,
  type FinanceBill,
  type FinanceIncome,
  type FinanceSubscription,
  type FinanceTransaction,
} from './types';

// ── visual constants ──────────────────────────────────────────────────────

/**
 * umber — money-v2's "unaccounted spend" ink. Native `colors` doesn't
 * surface it (per redesign tokens.css `--umber`) so it lives locally.
 */
const UMBER = '#8A4B2C';

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
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

type AreaKey = 'money in' | 'money out' | 'bills & recurring' | 'gift cards' | 'assets';

export function FinanceBox(): JSX.Element {
  const [txs, setTxs] = useState<FinanceTransaction[]>([]);
  const [billRows, setBillRows] = useState<FinanceBill[]>([]);
  const [subRows, setSubRows] = useState<FinanceSubscription[]>([]);
  const [incomeRows, setIncomeRows] = useState<FinanceIncome[]>([]);
  const [assetRows, setAssetRows] = useState<FinanceAsset[]>([]);
  const [merchantCadence, setMerchantCadence] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [openCard, setOpenCard] = useState<AreaKey | null>(null);

  const refresh = useCallback(async () => {
    const [t, b, s, inc, ast] = await Promise.all([
      txRepo.list(),
      billsRepo.list(),
      subsRepo.list(),
      incomeRepo.list(),
      assetsRepo.list(),
    ]);
    setTxs(t);
    setBillRows(b);
    setSubRows(s);
    setIncomeRows(inc);
    setAssetRows(ast);

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

  const { ready } = useModuleData({
    migrationKey: 'finance',
    migrate: migrateFinance,
    refresh,
  });

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
  const handleRemoveIncome = useCallback(
    async (id: string) => {
      await incomeRepo.remove(id);
      await refresh();
    },
    [refresh],
  );
  const handleAddAsset = useCallback(
    async (input: { name: string; note: string | null; value: number | null }) => {
      await assetsRepo.add(input);
      await refresh();
    },
    [refresh],
  );
  const handleRemoveAsset = useCallback(
    async (id: string) => {
      await assetsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  // Split income into spendable cash vs store credit (gift cards) so each
  // gets its own box (Serra's 5-box money layout, 2026-07-03).
  const cashIncome = useMemo(
    () => incomeRows.filter((r) => !isGiftCard(r.source)),
    [incomeRows],
  );
  const giftCards = useMemo(
    () => incomeRows.filter((r) => isGiftCard(r.source)),
    [incomeRows],
  );

  // Recurring detection — read-only surface. We re-derive on every tx
  // change rather than schedule a separate fetch since the detection is
  // a pure in-memory pass over the rows we already have.
  const suggestions = useMemo(() => detectFromTransactions(txs), [txs]);

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

  const incomeLine: ReactNode = cashIncome.length > 0
    ? (
      <>
        <b style={{ fontFamily: fonts.mono, fontWeight: 500 }}>
          {formatAmount(cashIncome[0]!.amount, cashIncome[0]!.currency)}
        </b>
        {cashIncome[0]!.source ? ` · ${cashIncome[0]!.source}` : ''}
      </>
    )
    : "nothing in yet — try 'dad sent me 500'";

  const giftLine: ReactNode = giftCards.length > 0
    ? (
      <>
        <b style={{ fontFamily: fonts.mono, fontWeight: 500 }}>
          {formatAmount(giftCards[0]!.amount, giftCards[0]!.currency)}
        </b>
        {giftCards[0]!.source ? ` · ${giftCards[0]!.source}` : ''}
      </>
    )
    : "none yet — try 'got a 10k zara gift card'";

  const assetsLine: ReactNode = assetRows.length > 0
    ? (
      <>
        <b style={{ fontFamily: fonts.mono, fontWeight: 500 }}>{assetRows.length}</b>
        {assetRows.length === 1 ? ' thing you hold' : ' things you hold'}
      </>
    )
    : 'nothing yet — add savings, gold, a car…';

  // Bills + subscriptions share one "bills & recurring" box — both are money
  // that repeats every month.
  const billsRecurringLine: ReactNode = billRows.length > 0 || subRows.length > 0
    ? (
      <>
        <b style={{ fontFamily: fonts.mono, fontWeight: 500 }}>{billRows.length + subRows.length}</b>
        {` recurring`}
      </>
    )
    : 'nothing recurring yet — try "netflix monthly" or "rent 18000 monthly"';

  return (
    <Stack gap={48}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text
          scale="title"
          color={colors.ink}
          style={{
            fontFamily: 'var(--ollie-font-sans)',
            fontSize: '26px',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          finance
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : (
        <Stack gap={40}>
          {/* TAP-TO-LOG — a quiet spend form so capture isn't dump-only. */}
          <LogSpendForm onLog={(i) => void handleLogTx(i)} />

          {/* MONEY in separate boxes (Serra 2026-07-03): in · out · bills &
              recurring · gift cards. Each a tap-to-open card. (Assets = step 2.) */}
          <Stack gap={12}>
            {/* MONEY IN — spendable cash only (gift cards get their own box) */}
            <AreaCard
              areaKey="money in"
              value={incomeLine}
              open={openCard === 'money in'}
              onToggle={() => toggle('money in')}
            >
              {cashIncome.length === 0 ? (
                <EmptyLine text="nothing in yet — try dumping 'dad sent me 500'" />
              ) : (
                <DetailList>
                  {cashIncome.map((item) => (
                    <IncomeDetailRow
                      key={item.id}
                      item={item}
                      onRemove={() => void handleRemoveIncome(item.id)}
                    />
                  ))}
                </DetailList>
              )}
            </AreaCard>

            {/* MONEY OUT — one-off spends (bills + subscriptions live below) */}
            <AreaCard
              areaKey="money out"
              value={txLine}
              open={openCard === 'money out'}
              onToggle={() => toggle('money out')}
            >
              {txs.length === 0 ? (
                <EmptyLine text="nothing out yet — try dumping 'spent $40 at sephora'" />
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

            {/* BILLS & RECURRING — bills + subscriptions, the monthly repeats */}
            <AreaCard
              areaKey="bills & recurring"
              value={billsRecurringLine}
              open={openCard === 'bills & recurring'}
              onToggle={() => toggle('bills & recurring')}
            >
              {billRows.length === 0 && subRows.length === 0 ? (
                <EmptyLine text="nothing recurring yet — try dumping 'rent 18000 monthly' or 'subscribed to spotify'" />
              ) : (
                <DetailList>
                  {billRows.map((item) => (
                    <BillDetailRow
                      key={item.id}
                      item={item}
                      onRemove={() => void handleRemoveBill(item.id)}
                    />
                  ))}
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

            {/* GIFT CARDS — store credit, kept apart from cash */}
            <AreaCard
              areaKey="gift cards"
              value={giftLine}
              open={openCard === 'gift cards'}
              onToggle={() => toggle('gift cards')}
            >
              {giftCards.length === 0 ? (
                <EmptyLine text="none yet — try dumping 'got a 10k zara gift card'" />
              ) : (
                <DetailList>
                  {giftCards.map((item) => (
                    <IncomeDetailRow
                      key={item.id}
                      item={item}
                      onRemove={() => void handleRemoveIncome(item.id)}
                    />
                  ))}
                </DetailList>
              )}
            </AreaCard>

            {/* ASSETS — things you own, value typed by you (no bank link) */}
            <AreaCard
              areaKey="assets"
              value={assetsLine}
              open={openCard === 'assets'}
              onToggle={() => toggle('assets')}
            >
              <Stack gap={14}>
                {assetRows.length > 0 && (
                  <DetailList>
                    {assetRows.map((item) => (
                      <AssetDetailRow
                        key={item.id}
                        item={item}
                        onRemove={() => void handleRemoveAsset(item.id)}
                      />
                    ))}
                  </DetailList>
                )}
                <AddAssetForm onAdd={(i) => void handleAddAsset(i)} />
              </Stack>
            </AreaCard>
          </Stack>

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
  background: colors.cream,
  border: 'none',
  borderRadius: radii.card,
  boxShadow: shadows.inset,
  padding: '11px 14px',
  fontFamily: fonts.sans,
  fontSize: 15,
  fontWeight: 500,
  color: colors.ink,
  outline: 'none',
};

// ── area card ─────────────────────────────────────────────────────────────

/**
 * AreaCard — the redesign's expandable info-row, now a raised neumorphic
 * card. Two states (collapsed / expanded); the body slot carries our detail
 * list and remove controls.
 */
function AreaCard({
  areaKey,
  value,
  open,
  onToggle,
  children,
}: {
  areaKey: string;
  value: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Box bg="cream" radius="card" shadow="raised" style={{ padding: '4px 16px' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '15px 2px',
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
        <div style={{ boxSizing: 'border-box', padding: '0 2px 18px' }}>
          {children}
        </div>
      )}
    </Box>
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

/** True when a logged income looks like store credit (a gift card) rather
 *  than spendable cash — keys off the source text the router captured. */
function isGiftCard(source: string | null): boolean {
  return source != null && /gift\s*card|gift$|\bgift\b/i.test(source);
}

function IncomeDetailRow({
  item,
  onRemove,
}: {
  item: FinanceIncome;
  onRemove: () => void;
}): JSX.Element {
  const muted = item.currency == null && item.amount != null;
  const gift = isGiftCard(item.source);
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <span style={DETAIL_K_STYLE}>
          {item.source ?? 'money in'}
          {gift ? (
            <span style={{ color: colors.inkGhost, marginLeft: 6 }}>· gift card</span>
          ) : null}
        </span>
        <Row gap={8} align="baseline">
          <span style={{ ...DETAIL_V_STYLE, color: muted ? UMBER : colors.ink }}>
            {formatAmount(item.amount, item.currency)}
          </span>
          <RemoveButton onClick={onRemove} />
        </Row>
      </Row>
      <WhenCaption ts={item.receivedAt} />
    </Stack>
  );
}

function AssetDetailRow({
  item,
  onRemove,
}: {
  item: FinanceAsset;
  onRemove: () => void;
}): JSX.Element {
  const muted = item.currency == null && item.value != null;
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <span style={DETAIL_K_STYLE}>
          {item.name}
          {item.note ? (
            <span style={{ color: colors.inkGhost, marginLeft: 6 }}>· {item.note}</span>
          ) : null}
        </span>
        <Row gap={8} align="baseline">
          {item.value == null ? (
            <span
              style={{
                fontFamily: fonts.sans,
                fontSize: 12,
                fontWeight: 500,
                color: colors.inkFaint,
                fontVariantCaps: 'all-small-caps',
                letterSpacing: '0.06em',
              }}
            >
              no value set
            </span>
          ) : (
            <span style={{ ...DETAIL_V_STYLE, color: muted ? UMBER : colors.ink }}>
              {formatAmount(item.value, item.currency)}
            </span>
          )}
          <RemoveButton onClick={onRemove} />
        </Row>
      </Row>
      <WhenCaption ts={item.createdAt} />
    </Stack>
  );
}

/**
 * AddAssetForm — a quiet "add something you own" inline form. Assets have no
 * dump routing yet, so this is how you list one: what it is, an optional
 * detail ("5g", "2019 clio"), and an optional value you type. Collapsed to a
 * single affordance so it doesn't shout.
 */
function AddAssetForm({
  onAdd,
}: {
  onAdd: (input: { name: string; note: string | null; value: number | null }) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [value, setValue] = useState('');

  const canAdd = name.trim().length > 0;
  const reset = () => {
    setName('');
    setNote('');
    setValue('');
  };
  const submit = () => {
    if (!canAdd) return;
    const cleaned = value.replace(/[^0-9.]/g, '');
    const v = cleaned === '' ? null : Number(cleaned);
    onAdd({
      name: name.trim(),
      note: note.trim() || null,
      value: v != null && Number.isFinite(v) ? v : null,
    });
    reset();
    setOpen(false);
  };

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
          color: colors.sage,
          fontFamily: fonts.sans,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.06em',
          fontVariantCaps: 'all-small-caps',
        }}
      >
        + add something you own
      </button>
    );
  }

  return (
    <Stack gap={10}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="what — savings, gold, car…"
        aria-label="asset name"
        style={FIELD_INPUT_STYLE}
      />
      <Row gap={8} align="center">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="detail — 5g, 2019 clio (optional)"
          aria-label="asset detail"
          style={{ ...FIELD_INPUT_STYLE, flex: 1 }}
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="value"
          aria-label="asset value"
          style={{ ...FIELD_INPUT_STYLE, maxWidth: 120, fontFamily: fonts.mono }}
        />
      </Row>
      <Row gap={8} align="center">
        <button
          type="button"
          onClick={submit}
          disabled={!canAdd}
          style={{
            background: canAdd ? colors.ink : 'transparent',
            color: canAdd ? colors.cream : colors.inkGhost,
            border: `1px solid ${canAdd ? colors.ink : colors.hairline}`,
            borderRadius: 8,
            padding: '8px 18px',
            cursor: canAdd ? 'pointer' : 'default',
            fontFamily: fonts.sans,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            fontVariantCaps: 'all-small-caps',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          add
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
