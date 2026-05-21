/**
 * grocery-v2 · ShopView — the `shop` mode (grocery.html / grocery-cold.html)
 *
 * The shopping LIST as a calm torn-note: each line is plain text on a
 * hairline rule, a soft round tick on the left. Tapping a line checks it
 * off — it strikes through and moves into the pantry with a computed
 * shelf life. One amber add floats under the list, then two quiet drill
 * rows (recently bought, and the sage observation row when a pattern is
 * live).
 *
 * The cold state (grocery.html empty + grocery-cold.html) shows a bare
 * torn-note hero with an honest "the list's empty" invitation and a
 * worked example of the 3 modes — never a blank page.
 */
import { useMemo } from 'react';
import {
  AmberButton,
  NavRow,
  IconPlus,
  IconCheck,
  IconBasket,
  IconJar,
  IconTarget,
  v2,
} from '../../money-v2/v2';
import { shopVM } from '../selectors';
import type { GrocerySlices } from '../selectors';
import type { GroceryActions } from '../useGroceryActions';
import { ReplenishmentBadge } from '../../../components/ReplenishmentBadge';
import { staticEstimate } from '../../../hooks/useReplenishment';
import type { ReplenishmentEstimate } from '../../../hooks/useReplenishment';

export interface ShopViewProps {
  now: number;
  slices: GrocerySlices;
  actions: GroceryActions;
  /**
   * Per-canonical replenishment estimates, keyed by canonical name.
   * The open shop rows show the badge so the reader sees how soon they
   * tend to need this item again. Falls back to `staticEstimate` per row
   * when the worker has no observed history yet.
   */
  estimates: Map<string, ReplenishmentEstimate>;
  onAdd: () => void;
  onPatterns: () => void;
}

export function ShopView({
  now,
  slices,
  actions,
  estimates,
  onAdd,
  onPatterns,
}: ShopViewProps) {
  const vm = useMemo(() => shopVM(slices, now), [slices, now]);

  if (vm.cold) return <ColdShop onAdd={onAdd} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* the list lead — the running stat */}
      <div
        style={{
          marginTop: 26,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        {vm.openCount > 0 ? (
          <>
            <b style={{ color: v2.ink, fontWeight: 600 }}>{vm.openCount}</b>
            {" on the list · tap one when it's in the basket"}
          </>
        ) : (
          'the list is clear · everything checked off'
        )}
      </div>

      {/* THE LIST — a torn-paper note */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
        {vm.rows.map((row, i) => (
          <button
            key={row.id}
            type="button"
            onClick={() => !row.got && actions.checkOff(row.id)}
            aria-label={row.got ? `${row.name}, in pantry` : `check off ${row.name}`}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 15,
              padding: '15px 2px',
              borderTop: `1px solid ${v2.line}`,
              borderBottom:
                i === vm.rows.length - 1 ? `1px solid ${v2.line}` : 'none',
              borderLeft: 'none',
              borderRight: 'none',
              background: 'transparent',
              cursor: row.got ? 'default' : 'pointer',
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{
                boxSizing: 'border-box',
                width: 23,
                height: 23,
                borderRadius: '50%',
                border: `1.8px solid ${row.got ? v2.accent : v2.line}`,
                background: row.got ? v2.accent : 'transparent',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {row.got && <IconCheck size={13} weight={3} stroke="#fff" />}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 17,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: row.got ? v2.mute : v2.ink,
                textDecoration: row.got ? 'line-through' : 'none',
                textDecorationColor: v2.line,
              }}
            >
              {row.name}
            </span>
            {/* the right-side column: replenishment badge above the qty
                line. The badge only shows on still-open rows — a checked-off
                row reads "in pantry" via the qty line below. */}
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 2,
                flexShrink: 0,
              }}
            >
              {!row.got && (
                <ReplenishmentBadge
                  estimate={
                    estimates.get(row.canonical) ?? staticEstimate(row.canonical)
                  }
                />
              )}
              {row.qty && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: row.got ? 600 : 500,
                    letterSpacing: '0.01em',
                    color: row.got ? v2.sage : v2.mute,
                  }}
                >
                  {row.qty}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* one amber add — the natural-language entry route */}
      <AmberButton
        icon={<IconPlus size={20} weight={2.4} />}
        onClick={onAdd}
        style={{ marginTop: 30, height: 50, borderRadius: 25 }}
      >
        add
      </AmberButton>

      {/* below, with air — the drill rows */}
      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column' }}>
        <NavRow
          first
          rowKey="recently bought"
          value={vm.recentValue}
          dim={vm.recentDim}
          last={!vm.patternLine}
          onOpen={onPatterns}
        />
        {vm.patternLine && (
          <NavRow
            flag
            last
            rowKey="see the rest"
            value={vm.patternLine}
            onOpen={onPatterns}
          />
        )}
      </div>
    </div>
  );
}

// ─── the cold shop state (grocery-cold.html) ─────────────────────────────────

interface ColdShopProps {
  onAdd: () => void;
}

/** the bare torn-note hero — three hairline rules waiting for lines */
function EmptyNote() {
  const STUBS = [96, 64, 78];
  return (
    <div
      aria-hidden
      style={{
        width: 188,
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 24,
      }}
    >
      {STUBS.map((w, i) => (
        <div
          key={w}
          style={{
            boxSizing: 'border-box',
            height: 46,
            borderBottom:
              i === STUBS.length - 1 ? 'none' : `1px dashed ${v2.line}`,
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
              border: `1.6px solid ${v2.line}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: `0 0 ${w}px`,
              height: 6,
              borderRadius: 3,
              background: v2.line,
              opacity: 0.55,
            }}
          />
        </div>
      ))}
    </div>
  );
}

const COLD_MODES: { name: string; what: string; glyph: 'shop' | 'pantry' | 'feed' }[] = [
  { name: 'shop', what: 'a list you talk to', glyph: 'shop' },
  { name: 'pantry', what: 'watches what turns soon', glyph: 'pantry' },
  { name: 'feed me', what: 'a meal from what you have', glyph: 'feed' },
];

function ColdShop({ onAdd }: ColdShopProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginTop: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <EmptyNote />

        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          nothing on the list yet
        </div>
        <div
          style={{
            marginTop: 9,
            fontSize: 30,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.025em',
            lineHeight: 1.25,
            textAlign: 'center',
            maxWidth: 290,
          }}
        >
          the list&rsquo;s empty &mdash; add the first thing
        </div>

        <div
          style={{
            marginTop: 22,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            maxWidth: 300,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: v2.sage,
              flexShrink: 0,
              marginTop: 6,
            }}
          />
          <span
            style={{
              fontSize: 14,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.5,
              textAlign: 'left',
            }}
          >
            grocery is a <b style={{ fontWeight: 600 }}>3-mode tool</b> &mdash; a
            shopping list you can just talk to, a pantry that watches what turns
            soon, and a <b style={{ fontWeight: 600 }}>feed me</b> that finds a
            meal from what you have.
          </span>
        </div>

        <AmberButton
          icon={<IconPlus size={18} weight={2.4} />}
          onClick={onAdd}
          style={{ marginTop: 30, height: 50, borderRadius: 25 }}
        >
          add the first thing
        </AmberButton>
      </div>

      {/* a worked example — the 3 modes, so the page is never barren */}
      <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          the 3 ways in
        </div>
        {COLD_MODES.map((m, i) => (
          <div
            key={m.name}
            style={{
              boxSizing: 'border-box',
              borderTop: `1px solid ${v2.line}`,
              borderBottom:
                i === COLD_MODES.length - 1 ? `1px solid ${v2.line}` : 'none',
              padding: '14px 2px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 20,
                height: 20,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {m.glyph === 'shop' && <IconBasket size={16} stroke={v2.mute} />}
              {m.glyph === 'pantry' && <IconJar size={16} stroke={v2.mute} />}
              {m.glyph === 'feed' && <IconTarget size={16} stroke={v2.mute} />}
            </span>
            <span
              style={{
                fontSize: 14,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                flexShrink: 0,
              }}
            >
              {m.name}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: v2.mute,
                fontWeight: 400,
                textAlign: 'right',
                letterSpacing: '-0.01em',
              }}
            >
              {m.what}
            </span>
          </div>
        ))}
      </div>

      {/* a quiet honest note */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: v2.line,
            flexShrink: 0,
            marginTop: 5,
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          the pantry and feed me fill in on their own &mdash; each thing you
          check off the list lands in the pantry with a shelf life, nothing to
          set up.
        </span>
      </div>
    </div>
  );
}
