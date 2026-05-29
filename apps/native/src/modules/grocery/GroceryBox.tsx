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

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
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
import { migrateGrocery } from './migrate';
import {
  cadence as cadenceRepo,
  pantry as pantryRepo,
  shopping as shoppingRepo,
} from './repo';
import type { PantryItem, ShoppingItem } from './types';
import { FeedMeView } from './FeedMeView';

// ─── style atoms ──────────────────────────────────────────────────────────

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;

type Mode = 'shop' | 'pantry' | 'feed-me';

// ─── component ────────────────────────────────────────────────────────────

export function GroceryBox(): JSX.Element {
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [cadenceByName, setCadenceByName] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [ready, setReady] = useState(false);
  // Pantry is the default — it's the surface you live in most of the time.
  // Shop mode is for the few minutes you're actually adding to the list.
  const [mode, setMode] = useState<Mode>('pantry');

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([pantryRepo.list(), shoppingRepo.list()]);
    setPantryItems(p);
    setShoppingItems(s);
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

  const openCount = shoppingItems.length;
  const pantryCount = pantryItems.length;

  return (
    <Stack gap={56}>
      {/* the kicker + serif title — the box hero */}
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box · grocery
        </Text>
        <Text scale="display">Grocery</Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          a list you talk to, a pantry that watches what you have.
        </Text>
      </Stack>

      {/* the near-zero-chrome mode switch — three calm text segments,
          active one underlined sage. Ports v2's ModeSwitch grammar. */}
      <ModeSwitch mode={mode} onChange={setMode} />

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : mode === 'shop' ? (
        <ShopList
          items={shoppingItems}
          openCount={openCount}
          onCheckOff={(id) => void handleCheckOffShopping(id)}
        />
      ) : mode === 'pantry' ? (
        <PantryList
          items={pantryItems}
          totalCount={pantryCount}
          cadenceByName={cadenceByName}
          onRemove={(id) => void handleRemovePantry(id)}
        />
      ) : (
        <FeedMeView pantryItems={pantryItems} />
      )}
    </Stack>
  );
}

// ─── mode switch ──────────────────────────────────────────────────────────

const MODE_LABELS: Record<Mode, string> = {
  shop: 'shop',
  pantry: 'pantry',
  'feed-me': 'feed me',
};
// Render order — `pantry` is the default voice (where the user lives),
// `shop` is on the left as the entry point when adding, `feed me` closes
// the row on the right as the action-oriented destination.
const MODE_ORDER: ReadonlyArray<Mode> = ['shop', 'pantry', 'feed-me'];

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
  onCheckOff,
}: {
  items: ShoppingItem[];
  openCount: number;
  onCheckOff: (id: string) => void;
}): JSX.Element {
  if (items.length === 0) return <ColdShop />;

  return (
    <Stack gap={14}>
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

      {/* the closing sage-dot honest note */}
      <SageNote>
        each thing you check off the list lands in the pantry — nothing to set up.
      </SageNote>
    </Stack>
  );
}

// ─── pantry view ──────────────────────────────────────────────────────────

function PantryList({
  items,
  totalCount,
  cadenceByName,
  onRemove,
}: {
  items: PantryItem[];
  totalCount: number;
  cadenceByName: Map<string, CadenceEstimate>;
  onRemove: (id: string) => void;
}): JSX.Element {
  if (items.length === 0) return <ColdPantry />;

  return (
    <Stack gap={14}>
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        <strong style={{ color: colors.ink, fontWeight: 600 }}>{totalCount}</strong>
        {' in the pantry'}
      </Text>

      <Stack gap={0}>
        {items.map((item, i) => (
          <Row
            key={item.id}
            gap={14}
            align="center"
            justify="space-between"
            style={{
              padding: '15px 2px',
              borderTop: `1px solid ${colors.hairline}`,
              borderBottom:
                i === items.length - 1 ? `1px solid ${colors.hairline}` : 'none',
            }}
          >
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 15,
                  color: colors.ink,
                  fontWeight: 500,
                  letterSpacing: '-0.012em',
                }}
              >
                {item.name}
                {item.lowFlag && (
                  <span
                    aria-hidden
                    style={{
                      marginLeft: 10,
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
              </span>
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
              <CadenceHint estimate={cadenceByName.get(item.name)} />
            </Stack>
            <RemoveButton onClick={() => onRemove(item.id)} />
          </Row>
        ))}
      </Stack>

      <SageNote>
        the pantry fills on its own — each thing lands here when you check it
        off the shopping list.
      </SageNote>
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
