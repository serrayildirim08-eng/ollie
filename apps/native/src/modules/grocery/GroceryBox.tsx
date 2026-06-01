/**
 * GroceryBox · /box/grocery screen.
 *
 * Visual port of the redesign/money-v2 grocery face (GroceryFace + ShopView
 * + the ColdShop hero). Lays the box out as a calm, warm-paper editorial
 * surface — a kicker, a serif display title, a near-zero-chrome mode
 * switch (shop · pantry), a torn-paper list with circular ticks, and a
 * sage-dot honest note for the empty states.
 *
 * The functional surface is unchanged from the v0 of this box:
 *   - pantry + shopping data come from the live grocery repo
 *   - polls every 6s + refreshes on window focus
 *   - shopping "check off" is wired to `shopping.remove(id)` (we have no
 *     shelf-life pipeline in the box yet — once we do, this becomes a
 *     `checkOff` that moves the row into the pantry with a computed life)
 *   - pantry rows can be removed inline
 *   - DEV-only "insert test milk" button stays
 *
 * Idioms translated from the web v2 source:
 *   - Tailwind/inline web styles → inline styles using `colors` from theme
 *     tokens (sage / amber / hairline / inkSoft / inkFaint) so the box
 *     reads in both light + dark mode of the native shell.
 *   - The web's v2 palette constants (v2.accent / v2.line / v2.mute / etc.)
 *     map to ollie native role tokens (amber / hairline / inkFaint / etc.).
 *   - framer-motion / swipe gestures → click handlers + simple CSS opacity
 *     transitions via the Text primitive + button :hover.
 *   - iPhone safe-area-inset paddings are dropped (desktop-leaning Tauri).
 *   - Lottie / video / audio decorations are dropped.
 *   - Inline SVG glyphs (the IconCheck tick, the empty-note circles, the
 *     hairline list rules) are hand-rolled — no @drei / @phosphor deps.
 *
 * Visual elements intentionally dropped:
 *   - feed me is now wired — see FeedMeView. The 3rd tab calls into the
 *     live /feed-me/:user worker and renders the AI suggestion stack.
 *   - the ShelfBar fill + the critical/watching/stocked grouping (no
 *     shelf-life timestamps tracked on PantryItem yet)
 *   - the AmberButton "add" CTA (the box's add path is the Brain Dump
 *     surface, not an inline form — adding a button here would mislead)
 *   - the bottom drill rows (NavRow "recently bought" / "see the rest")
 *     which depend on `patterns` selectors not present in this repo
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  daysSinceLast,
  isOverdue,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateGrocery } from './migrate';
import {
  cadence as cadenceRepo,
  pantry as pantryRepo,
  shopping as shoppingRepo,
} from './repo';
import type { PantryItem, ShoppingItem } from './types';
import { FeedMeView } from './FeedMeView';
import { GroceryNow } from './GroceryNow';
import { ageOf, type AgingState } from './aging';
import { loadShelfLifeTable, lookupDays } from './shelfLifeCache';

// ─── style atoms ──────────────────────────────────────────────────────────

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;

type Mode = 'now' | 'shop' | 'pantry' | 'feed-me';

// ─── component ────────────────────────────────────────────────────────────

export function GroceryBox(): JSX.Element {
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<PantryItem[]>([]);
  const [predictedOutItems, setPredictedOutItems] = useState<PantryItem[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [cadenceByName, setCadenceByName] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [ready, setReady] = useState(false);
  // Pantry is the default — it's the surface you live in most of the time.
  // Shop mode is for the few minutes you're actually adding to the list.
  // Persisted in sessionStorage so a hot-reload / refresh keeps you on the
  // tab you were on (e.g. feed-me) instead of snapping back to pantry.
  const [mode, setModeState] = useState<Mode>(() => {
    const saved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('grocery:mode') : null;
    return saved === 'now' || saved === 'shop' || saved === 'pantry' || saved === 'feed-me'
      ? saved
      : 'now';
  });
  const setMode = useCallback((m: Mode) => {
    try {
      sessionStorage.setItem('grocery:mode', m);
    } catch {
      // sessionStorage unavailable (private mode / SSR) — non-fatal.
    }
    setModeState(m);
  }, []);
  // Bumps whenever the background shelf-life table finishes loading; lets
  // the pantry view recompute aging states without a poll cycle.
  const [shelfTableTick, setShelfTableTick] = useState(0);

  const refresh = useCallback(async () => {
    const [p, a, s, pred] = await Promise.all([
      pantryRepo.list(),
      pantryRepo.listArchived(),
      shoppingRepo.list(),
      pantryRepo.listPredictedOut(),
    ]);
    setPantryItems(p);
    setArchivedItems(a);
    setShoppingItems(s);
    setPredictedOutItems(pred);
    // Fan-out cadence reads in parallel — one per pantry name. Keeps the
    // pantry view a single state cycle (no per-row async in render).
    const pairs = await Promise.all(
      p.map(async (it) => [it.name, await cadenceRepo.getCadenceFor(it.name)] as const),
    );
    setCadenceByName(new Map(pairs));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateGrocery();
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      setReady(true);
      // Kick the shelf-life table load — non-blocking. When it resolves
      // we bump the tick so the pantry recomputes aging from the live table.
      void loadShelfLifeTable().then(() => {
        if (!cancelled) setShelfTableTick((n) => n + 1);
      });
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

  const handleRemovePantry = useCallback(
    async (id: string) => {
      await pantryRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  // "yes, still here" — reset the aging clock to now.
  const handleTouchPantry = useCallback(
    async (id: string) => {
      await pantryRepo.touch(id);
      await refresh();
    },
    [refresh],
  );

  // "gone" / auto-archive — move the row into the archived section.
  const handleArchivePantry = useCallback(
    async (id: string) => {
      await pantryRepo.archive(id);
      await refresh();
    },
    [refresh],
  );

  // "bring back" from the archived section.
  const handleUnarchivePantry = useCallback(
    async (id: string) => {
      await pantryRepo.unarchive(id);
      await refresh();
    },
    [refresh],
  );

  // ── auto-archive side-effect ────────────────────────────────────────────
  // Any active row that has aged past shelfLife × 2.0 leaves the active
  // list. We do this in an effect (not render) so we don't mutate state
  // during a render pass + we don't re-fire the archive call repeatedly.
  //
  // The set of "should archive" ids is computed from the snapshot the
  // effect closes over; once the archive calls resolve, `refresh()` pulls
  // fresh state and the cycle is naturally broken (those rows now have
  // archived_at_ms set and listActive() excludes them).
  useEffect(() => {
    if (!ready) return;
    // Re-read inside the effect to avoid re-running on shelfTableTick when
    // the table just became available but nothing else moved.
    void shelfTableTick;
    const now = Date.now();
    const toArchive = pantryItems.filter((it) => {
      const days = lookupDays(it.name);
      return ageOf(it.addedAt, days, now) === 'should_archive';
    });
    if (toArchive.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const it of toArchive) {
        await pantryRepo.archive(it.id);
        if (cancelled) return;
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [pantryItems, ready, refresh, shelfTableTick]);

  // Checking a shopping row off means the user just bought it — move it
  // from the shopping list into the pantry rather than just deleting.
  const handleCheckOffShopping = useCallback(
    async (id: string) => {
      const target = shoppingItems.find((it) => it.id === id);
      if (target) {
        await pantryRepo.add({
          name: target.name,
          quantity: target.quantity,
          unit: target.unit,
        });
      }
      await shoppingRepo.remove(id);
      await refresh();
    },
    [refresh, shoppingItems],
  );

  // Add a missing recipe ingredient (a "need" item from Feed Me) onto the
  // shopping list, then refresh so the shop view + "added" state reflect it.
  const handleAddToShop = useCallback(
    async (name: string, quantity?: number | null, unit?: string | null) => {
      await shoppingRepo.add({ name, quantity: quantity ?? null, unit: unit ?? null });
      await refresh();
    },
    [refresh],
  );

  // ── replenishment (Plan B · 2026-05-30) ─────────────────────────────────
  //
  // The "≈ likely needed" Shop section reads pantryRepo.listPredictedOut()
  // and renders an inline "add to list / still have" choice per row.
  //   - add to list  → shopping.add(name) + setPredictedOut(null) so the row
  //                    immediately leaves the ≈ section.
  //   - still have   → dismissPrediction(now) (bumps prediction +7d).
  // The per-row Pantry `remind`/`silent` toggle calls setRemindMe directly.
  const handleAddPredictedToList = useCallback(
    async (row: PantryItem) => {
      await shoppingRepo.add({
        name: row.name,
        quantity: row.quantity,
        unit: row.unit,
      });
      // Clearing predicted_out_at_ms makes the row vanish from the ≈ section
      // on the next read — the cadence layer / backend pod's predictOutAt()
      // will set a fresh prediction the next time it runs against the row.
      await pantryRepo.setPredictedOut(row.id, null);
      await refresh();
    },
    [refresh],
  );

  const handleStillHavePredicted = useCallback(
    async (row: PantryItem) => {
      await pantryRepo.dismissPrediction(row.id);
      await refresh();
    },
    [refresh],
  );

  const handleSetRemindMe = useCallback(
    async (id: string, remindMe: boolean) => {
      await pantryRepo.setRemindMe(id, remindMe);
      await refresh();
    },
    [refresh],
  );

  const shopNames = useMemo(
    () => new Set(shoppingItems.map((it) => it.name.toLowerCase())),
    [shoppingItems],
  );

  const openCount = shoppingItems.length;
  const pantryCount = pantryItems.length;

  return (
    <Stack gap={56}>
      {/* the kicker + serif title — the box hero. Suppressed on the Now
          surface, which carries its own clean heading (redesign parity). */}
      {mode !== 'now' && (
        <Stack gap={12}>
          <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
            box · grocery
          </Text>
          <Text scale="display">Grocery</Text>
          <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
            a list you talk to, a pantry that watches what you have.
          </Text>
        </Stack>
      )}

      {/* the near-zero-chrome mode switch — three calm text segments,
          active one underlined sage. Ports v2's ModeSwitch grammar. */}
      <ModeSwitch mode={mode} onChange={setMode} />

      {/* Layer-2 noticings — soft cards from the grocery watcher (restock
          drift, predicted run-outs, low-flag clustering). Renders nothing
          when there are no live pattern cards, so this top-of-content slot
          is safe across every mode (now · shop · pantry · feed me). */}
      <PatternCards module="grocery" />

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : mode === 'now' ? (
        <GroceryNow
          pantryItems={pantryItems}
          predictedOut={predictedOutItems}
          shopNames={shopNames}
          shelfTick={shelfTableTick}
          onGoCook={() => setMode('feed-me')}
          onStillGood={(id) => void handleTouchPantry(id)}
          onGone={(id) => void handleArchivePantry(id)}
        />
      ) : mode === 'shop' ? (
        <ShopList
          items={shoppingItems}
          openCount={openCount}
          predictedOut={predictedOutItems}
          shopNames={shopNames}
          onCheckOff={(id) => void handleCheckOffShopping(id)}
          onAddPredicted={(row) => void handleAddPredictedToList(row)}
          onStillHavePredicted={(row) => void handleStillHavePredicted(row)}
        />
      ) : mode === 'pantry' ? (
        <PantryList
          items={pantryItems}
          archivedItems={archivedItems}
          totalCount={pantryCount}
          cadenceByName={cadenceByName}
          shelfTick={shelfTableTick}
          onRemove={(id) => void handleRemovePantry(id)}
          onStillHere={(id) => void handleTouchPantry(id)}
          onGone={(id) => void handleArchivePantry(id)}
          onUnarchive={(id) => void handleUnarchivePantry(id)}
          onSetRemindMe={(id, v) => void handleSetRemindMe(id, v)}
        />
      ) : (
        <FeedMeView
          pantryItems={pantryItems}
          shopNames={shopNames}
          onAddToShop={(name, quantity, unit) => void handleAddToShop(name, quantity, unit)}
        />
      )}
    </Stack>
  );
}

// ─── mode switch ──────────────────────────────────────────────────────────

const MODE_LABELS: Record<Mode, string> = {
  now: 'now',
  shop: 'shop',
  pantry: 'pantry',
  'feed-me': 'feed me',
};
// Render order — `pantry` is the default voice (where the user lives),
// `shop` is on the left as the entry point when adding, `feed me` closes
// the row on the right as the action-oriented destination.
const MODE_ORDER: ReadonlyArray<Mode> = ['now', 'shop', 'pantry', 'feed-me'];

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}): JSX.Element {
  return (
    <Row gap={28} align="center" style={{ paddingBottom: 2 }}>
      {MODE_ORDER.map((m) => {
        const on = m === mode;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(m)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${on ? colors.sage : 'transparent'}`,
              padding: '0 0 7px 0',
              fontSize: 14,
              fontWeight: on ? 600 : 500,
              letterSpacing: '-0.01em',
              color: on ? colors.ink : colors.inkFaint,
              cursor: 'pointer',
              transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
            }}
          >
            {MODE_LABELS[m]}
          </button>
        );
      })}
    </Row>
  );
}

// ─── shop view ────────────────────────────────────────────────────────────

function ShopList({
  items,
  openCount,
  predictedOut,
  shopNames,
  onCheckOff,
  onAddPredicted,
  onStillHavePredicted,
}: {
  items: ShoppingItem[];
  openCount: number;
  predictedOut: PantryItem[];
  shopNames: Set<string>;
  onCheckOff: (id: string) => void;
  onAddPredicted: (row: PantryItem) => void;
  onStillHavePredicted: (row: PantryItem) => void;
}): JSX.Element {
  // Dedupe predicted-out rows against the active shopping list — never
  // show the same canonical in both sections (it would read as a bug to
  // the user). The shopNames set is normalised at the GroceryBox level.
  const predictedFiltered = useMemo(
    () => predictedOut.filter((p) => !shopNames.has(p.name.toLowerCase())),
    [predictedOut, shopNames],
  );

  if (items.length === 0 && predictedFiltered.length === 0) return <ColdShop />;

  return (
    <Stack gap={14}>
      {items.length > 0 && (
        <>
          {/* the running stat above the torn note */}
          <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
            <strong style={{ color: colors.ink, fontWeight: 600 }}>{openCount}</strong>
            {" on the list · tap one when it's in the basket"}
          </Text>

          {/* THE LIST — a torn-paper note, hairline rules, soft round tick */}
          <Stack gap={0}>
            {items.map((row, i) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onCheckOff(row.id)}
                aria-label={`check off ${row.name}`}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 15,
                  padding: '15px 2px',
                  borderTop: `1px solid ${colors.hairline}`,
                  borderBottom:
                    i === items.length - 1 ? `1px solid ${colors.hairline}` : 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  color: 'inherit',
                }}
              >
                <TickCircle />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 400,
                      letterSpacing: '-0.01em',
                      color: colors.ink,
                    }}
                  >
                    {row.name}
                  </span>
                  <WhenCaption ts={row.addedAt} />
                </span>
                {qtyLabel(row.quantity, row.unit) && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: '0.01em',
                      color: colors.inkFaint,
                      flexShrink: 0,
                    }}
                  >
                    {qtyLabel(row.quantity, row.unit)}
                  </span>
                )}
              </button>
            ))}
          </Stack>
        </>
      )}

      {predictedFiltered.length > 0 && (
        <LikelyNeededSection
          items={predictedFiltered}
          onAdd={onAddPredicted}
          onStillHave={onStillHavePredicted}
        />
      )}

      {/* the closing sage-dot honest note */}
      {items.length > 0 && (
        <SageNote>
          each thing you check off the list lands in the pantry — nothing to set up.
        </SageNote>
      )}
    </Stack>
  );
}

// ─── ≈ likely needed section ──────────────────────────────────────────────
//
// A second, quieter group below the active shopping list. Rows are rendered
// AS IF they were on the shop list (visual continuity), but with a smcp
// sage `≈ likely needed` section header and a tiny italic "predicted from
// your pattern" caption per row. One tap opens an inline `add to list` /
// `still have` choice — no chrome, no badges.

function LikelyNeededSection({
  items,
  onAdd,
  onStillHave,
}: {
  items: PantryItem[];
  onAdd: (row: PantryItem) => void;
  onStillHave: (row: PantryItem) => void;
}): JSX.Element {
  return (
    <Stack gap={0} style={{ marginTop: 16 }} aria-label="likely needed">
      {/* hairline rule above + 11px smcp sage section caption */}
      <div
        style={{
          borderTop: `1px solid ${colors.hairline}`,
          paddingTop: 16,
        }}
      >
        <span
          style={{
            ...SMCP_STYLE,
            fontSize: 11,
            color: colors.sage,
            letterSpacing: '0.08em',
            fontStyle: 'italic',
          }}
        >
          {'≈'} likely needed
        </span>
      </div>
      <Stack gap={0} style={{ marginTop: 12 }}>
        {items.map((row, i) => (
          <LikelyNeededRow
            key={row.id}
            row={row}
            isLast={i === items.length - 1}
            onAdd={onAdd}
            onStillHave={onStillHave}
          />
        ))}
      </Stack>
    </Stack>
  );
}

function LikelyNeededRow({
  row,
  isLast,
  onAdd,
  onStillHave,
}: {
  row: PantryItem;
  isLast: boolean;
  onAdd: (row: PantryItem) => void;
  onStillHave: (row: PantryItem) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderTop: `1px solid ${colors.hairline}`,
        borderBottom: isLast ? `1px solid ${colors.hairline}` : 'none',
        padding: '13px 2px',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${row.name} — likely needed`}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          color: 'inherit',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 16,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            color: colors.ink,
          }}
        >
          {row.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: colors.inkSoft,
            fontStyle: 'italic',
            letterSpacing: '0.02em',
          }}
        >
          {'≈'} predicted from your pattern
        </span>
      </button>
      {open && (
        <Row gap={16} align="baseline" style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => onAdd(row)}
            style={{
              ...SMCP_STYLE,
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 11,
              color: colors.sage,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
            }}
          >
            add to list
          </button>
          <button
            type="button"
            onClick={() => onStillHave(row)}
            style={{
              ...SMCP_STYLE,
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 11,
              color: colors.inkSoft,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
            }}
          >
            still have
          </button>
        </Row>
      )}
    </div>
  );
}

// ─── pantry view ──────────────────────────────────────────────────────────

function PantryList({
  items,
  archivedItems,
  totalCount,
  cadenceByName,
  shelfTick,
  onRemove,
  onStillHere,
  onGone,
  onUnarchive,
  onSetRemindMe,
}: {
  items: PantryItem[];
  archivedItems: PantryItem[];
  totalCount: number;
  cadenceByName: Map<string, CadenceEstimate>;
  /** Bumps when shelf-life table loads; included so memo recomputes. */
  shelfTick: number;
  onRemove: (id: string) => void;
  onStillHere: (id: string) => void;
  onGone: (id: string) => void;
  onUnarchive: (id: string) => void;
  onSetRemindMe: (id: string, remindMe: boolean) => void;
}): JSX.Element {
  // Compute aging state per row from the live shelf-life table. `shelfTick`
  // is in the dep list so the memo recomputes when the cache populates.
  const agingByName = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, AgingState>();
    for (const it of items) {
      const days = lookupDays(it.name);
      map.set(it.id, ageOf(it.addedAt, days, now));
    }
    // `shelfTick` referenced to satisfy the dep linter and to force the
    // recompute when the shelf-life cache hot-swaps in.
    void shelfTick;
    return map;
  }, [items, shelfTick]);

  if (items.length === 0 && archivedItems.length === 0) return <ColdPantry />;

  return (
    <Stack gap={14}>
      {items.length > 0 && (
        <>
          <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
            <strong style={{ color: colors.ink, fontWeight: 600 }}>{totalCount}</strong>
            {' in the pantry'}
          </Text>

          <Stack gap={0}>
            {items.map((item, i) => (
              <PantryRow
                key={item.id}
                item={item}
                aging={agingByName.get(item.id) ?? 'fresh'}
                cadence={cadenceByName.get(item.name)}
                isLast={i === items.length - 1}
                onRemove={onRemove}
                onStillHere={onStillHere}
                onGone={onGone}
                onSetRemindMe={onSetRemindMe}
              />
            ))}
          </Stack>
        </>
      )}

      {items.length > 0 && (
        <SageNote>
          the pantry fills on its own — each thing lands here when you check it
          off the shopping list.
        </SageNote>
      )}

      {archivedItems.length > 0 && (
        <ArchivedSection items={archivedItems} onUnarchive={onUnarchive} />
      )}
    </Stack>
  );
}

// ─── pantry row · aging-aware ─────────────────────────────────────────────

function PantryRow({
  item,
  aging,
  cadence,
  isLast,
  onRemove,
  onStillHere,
  onGone,
  onSetRemindMe,
}: {
  item: PantryItem;
  aging: AgingState;
  cadence: CadenceEstimate | undefined;
  isLast: boolean;
  onRemove: (id: string) => void;
  onStillHere: (id: string) => void;
  onGone: (id: string) => void;
  onSetRemindMe: (id: string, remindMe: boolean) => void;
}): JSX.Element {
  const [promptOpen, setPromptOpen] = useState(false);

  // Visual fade — 60% opacity from 'faded' onward. The "should_archive"
  // case never renders here (auto-archive effect moves it before paint).
  const faded = aging === 'faded' || aging === 'still_here_prompt';
  const showStillHere = aging === 'still_here_prompt';

  return (
    <Row
      gap={14}
      align="flex-start"
      justify="space-between"
      style={{
        padding: '15px 2px',
        borderTop: `1px solid ${colors.hairline}`,
        borderBottom: isLast ? `1px solid ${colors.hairline}` : 'none',
        opacity: faded ? 0.6 : 1,
        transition: 'opacity 240ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    >
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Row gap={10} align="baseline" style={{ flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 15,
              color: colors.ink,
              fontWeight: 500,
              letterSpacing: '-0.012em',
            }}
          >
            {item.name}
          </span>
          {item.lowFlag && (
            <span
              aria-hidden
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: colors.amber,
              }}
            >
              low
            </span>
          )}
          {showStillHere && (
            <StillHereAffordance
              open={promptOpen}
              onToggle={() => setPromptOpen((v) => !v)}
              onYes={() => {
                setPromptOpen(false);
                onStillHere(item.id);
              }}
              onGone={() => {
                setPromptOpen(false);
                onGone(item.id);
              }}
            />
          )}
        </Row>
        {qtyLabel(item.quantity, item.unit) && (
          <span
            style={{
              fontSize: 12,
              color: colors.inkFaint,
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            {qtyLabel(item.quantity, item.unit)}
          </span>
        )}
        <WhenCaption ts={item.addedAt} />
        <CadenceHint estimate={cadence} />
      </Stack>
      <Row gap={10} align="center" style={{ flexShrink: 0 }}>
        <RemindToggle
          remindMe={item.remindMe}
          onChange={(next) => onSetRemindMe(item.id, next)}
        />
        <RemoveButton onClick={() => onRemove(item.id)} />
      </Row>
    </Row>
  );
}

// ─── remind toggle ────────────────────────────────────────────────────────
//
// A single very small smcp text button that flips between `remind` (sage,
// active) and `silent` (inkSoft, inactive). No checkbox chrome, no switch
// widget — the text IS the indicator. Default state is seeded by the
// backend's isCriticalReminder() at insert; the UI just reads remind_me.

function RemindToggle({
  remindMe,
  onChange,
}: {
  remindMe: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={remindMe}
      aria-label={remindMe ? 'remind me when out' : 'silent — no reminder'}
      onClick={() => onChange(!remindMe)}
      style={{
        ...SMCP_STYLE,
        background: 'none',
        border: 'none',
        padding: '4px 6px',
        margin: 0,
        fontSize: 11,
        color: remindMe ? colors.sage : colors.inkFaint,
        cursor: 'pointer',
        fontFamily: 'inherit',
        flexShrink: 0,
        transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    >
      {remindMe ? 'remind' : 'silent'}
    </button>
  );
}

// ─── still-here affordance ────────────────────────────────────────────────
//
// Closed: a single smcp sage "still here?" trailing the item name.
// Open: the prompt swaps for two quiet text buttons — "yes, still here"
// (sage) and "gone" (inkSoft). No chrome, no bg, no border. The opacity
// + max-height tween is gentle (200ms) to honour editorial restraint.

function StillHereAffordance({
  open,
  onToggle,
  onYes,
  onGone,
}: {
  open: boolean;
  onToggle: () => void;
  onYes: () => void;
  onGone: () => void;
}): JSX.Element {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-label="still here?"
        style={{
          ...SMCP_STYLE,
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          fontSize: 11,
          color: colors.sage,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        still here?
      </button>
    );
  }
  return (
    <Row gap={12} align="baseline">
      <button
        type="button"
        onClick={onYes}
        style={{
          ...SMCP_STYLE,
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: 11,
          color: colors.sage,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        yes, still here
      </button>
      <button
        type="button"
        onClick={onGone}
        style={{
          ...SMCP_STYLE,
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: 11,
          color: colors.inkSoft,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        gone
      </button>
    </Row>
  );
}

// ─── archived section ─────────────────────────────────────────────────────
//
// A collapsed-by-default editorial drawer at the bottom of the pantry list.
// Header is a tiny smcp count framed by hairlines. Click expands; each
// archived row has a tiny smcp sage "bring back" action.

function ArchivedSection({
  items,
  onUnarchive,
}: {
  items: PantryItem[];
  onUnarchive: (id: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap={0} style={{ marginTop: 24 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          ...SMCP_STYLE,
          width: '100%',
          background: 'none',
          border: 'none',
          borderTop: `1px solid ${colors.hairline}`,
          borderBottom: `1px solid ${colors.hairline}`,
          padding: '10px 2px',
          fontSize: 11,
          color: colors.inkFaint,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {items.length} archived
      </button>
      {open && (
        <Stack gap={0}>
          {items.map((item, i) => (
            <Row
              key={item.id}
              gap={14}
              align="center"
              justify="space-between"
              style={{
                padding: '12px 2px',
                borderBottom:
                  i === items.length - 1 ? `1px solid ${colors.hairline}` : 'none',
                opacity: 0.6,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  color: colors.inkSoft,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {item.name}
              </span>
              <button
                type="button"
                onClick={() => onUnarchive(item.id)}
                style={{
                  ...SMCP_STYLE,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: 10,
                  color: colors.sage,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                bring back
              </button>
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ─── cold states ──────────────────────────────────────────────────────────

/** the bare torn-note hero — three hairline rules waiting for lines */
function EmptyNote(): JSX.Element {
  const STUBS = [96, 64, 78];
  return (
    <div
      aria-hidden
      style={{
        width: 188,
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 8,
      }}
    >
      {STUBS.map((w, i) => (
        <div
          key={w}
          style={{
            height: 46,
            borderBottom:
              i === STUBS.length - 1
                ? 'none'
                : `1px dashed ${colors.hairline}`,
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            padding: '0 4px',
          }}
        >
          <span
            style={{
              width: 21,
              height: 21,
              borderRadius: '50%',
              border: `1.6px solid ${colors.hairline}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: `0 0 ${w}px`,
              height: 6,
              borderRadius: 3,
              background: colors.hairline,
              opacity: 0.7,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function ColdShop(): JSX.Element {
  return (
    <Stack gap={20} align="center">
      <EmptyNote />
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        nothing on the list yet
      </Text>
      <Text
        scale="heading"
        style={{
          textAlign: 'center',
          maxWidth: 360,
          fontWeight: 300,
        }}
      >
        the list&rsquo;s empty — try dumping &ldquo;need pasta&rdquo;
      </Text>
      <SageNote style={{ maxWidth: 360, marginTop: 4 }}>
        grocery is a <strong style={{ fontWeight: 600 }}>2-mode tool</strong> —
        a shopping list you can just talk to, and a pantry that holds what you
        have.
      </SageNote>
    </Stack>
  );
}

function ColdPantry(): JSX.Element {
  return (
    <Stack gap={20}>
      <Text
        scale="heading"
        style={{
          maxWidth: 360,
          fontWeight: 300,
        }}
      >
        the pantry is empty — that&rsquo;s fine
      </Text>
      <SageNote>
        the pantry fills on its own — each thing lands here when you check it
        off the shopping list. nothing to set up.
      </SageNote>
    </Stack>
  );
}

// ─── tiny shared primitives ───────────────────────────────────────────────

/** the round amber/sage tick on the left of a shopping row */
function TickCircle(): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 23,
        height: 23,
        borderRadius: '50%',
        border: `1.8px solid ${colors.hairline}`,
        background: 'transparent',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    />
  );
}

/** the sage-dot honest note — a tiny round sage dot + a soft body line */
function SageNote({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <Row gap={10} align="flex-start" style={{ marginTop: 8, ...style }}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: colors.sage,
          flexShrink: 0,
          marginTop: 8,
        }}
      />
      <span
        style={{
          fontSize: 14,
          color: colors.inkSoft,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          lineHeight: 1.5,
        }}
      >
        {children}
      </span>
    </Row>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
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
        flexShrink: 0,
      }}
    >
      remove
    </button>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * One-line cadence prediction under a pantry row.
 *
 * Renders nothing when we don't yet have enough data ('low-data') — silence
 * beats a wrong prediction on Serra's minimal UI. When we do have an
 * estimate, the line reads one of three ways:
 *   · "out soon · usually every 7 days"             — past nextExpectedTs
 *   · "next around 7 days · usually weekly"         — upcoming
 *   · also marks rare/stable patterns with a faint sage dot
 */
function CadenceHint({ estimate }: { estimate: CadenceEstimate | undefined }): JSX.Element | null {
  if (!estimate || estimate.confidence === 'low-data' || estimate.lastTs == null) {
    return null;
  }
  const now = Date.now();
  const overdue = isOverdue(estimate, now);
  const sinceDays = daysSinceLast(estimate, now) ?? 0;
  const everyDays = medianIntervalDays(estimate);
  const everyLabel = everyDays >= 1 ? `every ${formatDays(everyDays)}` : 'multiple times a day';

  const text =
    overdue === true
      ? `might need ${pluralDays(Math.round(sinceDays - everyDays))} ago · usually ${everyLabel}`
      : `last bought ${formatDays(sinceDays)} ago · usually ${everyLabel}`;

  return (
    <span
      style={{
        fontSize: 11,
        color: overdue ? colors.amber : colors.inkFaint,
        fontWeight: 500,
        letterSpacing: '0.02em',
        fontVariantCaps: 'all-small-caps',
        marginTop: 2,
      }}
    >
      {text}
    </span>
  );
}

function formatDays(d: number): string {
  if (d < 1) return 'less than a day';
  const rounded = Math.round(d);
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

function pluralDays(d: number): string {
  if (d <= 0) return 'today';
  return `${d} day${d === 1 ? '' : 's'}`;
}

function qtyLabel(quantity: number | null, unit: string | null): string {
  if (quantity == null && !unit) return '';
  if (quantity != null && unit) return `${quantity} ${unit}`;
  if (quantity != null) return String(quantity);
  return unit ?? '';
}
