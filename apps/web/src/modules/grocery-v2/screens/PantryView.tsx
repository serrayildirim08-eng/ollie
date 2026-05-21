/**
 * grocery-v2 · PantryView — the `pantry` mode (grocery-pantry.html)
 *
 * The shelf-life-aware view of the kitchen. Items group onto 3 shelves by
 * remaining shelf life: critical (≤2d, umber), watching (≤7d, amber),
 * stocked (>7d, sage). Each item carries a fill-bar + an "N days / today"
 * label. The stocked shelf folds away. No cards, hairline-divided rows.
 *
 * The cold state shows an honest empty note — the pantry fills on its own
 * as the shopping list is checked off.
 */
import { useMemo, useState } from 'react';
import { IconChevronDown, v2 } from '../../money-v2/v2';
import { ShelfBar } from '../components/ShelfBar';
import { pantryVM } from '../selectors';
import type { GrocerySlices, PantryShelf, ShelfTier } from '../selectors';
import { ReplenishmentBadge } from '../../../components/ReplenishmentBadge';
import { staticEstimate } from '../../../hooks/useReplenishment';
import type { ReplenishmentEstimate } from '../../../hooks/useReplenishment';

export interface PantryViewProps {
  now: number;
  slices: GrocerySlices;
  /**
   * Per-canonical replenishment estimates, keyed by canonical name.
   * Caller (`GroceryFace`) sources from `useReplenishment`; the row
   * resolves with `staticEstimate(canonical)` when a key is absent.
   */
  estimates: Map<string, ReplenishmentEstimate>;
}

const SHELF_NAME_COLOR: Record<ShelfTier, string> = {
  critical: v2.umber,
  watching: v2.accent,
  stocked: v2.mute,
};

export function PantryView({ now, slices, estimates }: PantryViewProps) {
  const vm = useMemo(() => pantryVM(slices, now), [slices, now]);
  const [stockedFolded, setStockedFolded] = useState(false);

  if (vm.empty) {
    return (
      <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 30,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.025em',
            lineHeight: 1.25,
            maxWidth: 300,
          }}
        >
          the pantry is empty &mdash; that&rsquo;s fine
        </div>
        <div
          style={{
            marginTop: 22,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
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
            }}
          >
            the pantry fills on its own &mdash; each thing lands here when you
            check it off the shopping list, with a shelf life ollie estimates.
            nothing to set up.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginTop: 26,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        <b style={{ color: v2.ink, fontWeight: 600 }}>{vm.total}</b>
        {vm.lead.replace(/^\d+ /, ' ')}
      </div>

      {vm.shelves
        .filter((s) => s.rows.length > 0)
        .map((shelf) => (
          <Shelf
            key={shelf.tier}
            shelf={shelf}
            estimates={estimates}
            folded={shelf.tier === 'stocked' && stockedFolded}
            onToggleFold={
              shelf.tier === 'stocked'
                ? () => setStockedFolded((f) => !f)
                : undefined
            }
          />
        ))}

      {/* the closing note */}
      <div
        style={{
          marginTop: 26,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
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
          the pantry fills on its own &mdash; each thing lands here when you
          check it off the shopping list, with a shelf life ollie estimates.
        </span>
      </div>
    </div>
  );
}

// ─── one shelf ───────────────────────────────────────────────────────────────

interface ShelfProps {
  shelf: PantryShelf;
  /** the live replenishment estimates, keyed by canonical */
  estimates: Map<string, ReplenishmentEstimate>;
  /** true when the (stocked) shelf is collapsed */
  folded: boolean;
  /** present only for the stocked shelf — the fold toggle */
  onToggleFold?: () => void;
}

function Shelf({ shelf, estimates, folded, onToggleFold }: ShelfProps) {
  return (
    <div style={{ marginTop: 24 }}>
      {/* the shelf header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: SHELF_NAME_COLOR[shelf.tier],
          }}
        >
          {shelf.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {shelf.window}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: v2.mute,
            fontWeight: 600,
          }}
        >
          {shelf.rows.length}
        </span>
      </div>

      {/* the items — hidden when the shelf is folded */}
      {!folded &&
        shelf.rows.map((row, i) => {
          // resolve the row's replenishment estimate, falling back to the
          // static map when the worker has no observed history for it yet
          const estimate =
            estimates.get(row.canonical) ?? staticEstimate(row.canonical);
          return (
            <div
              key={row.id}
              style={{
                boxSizing: 'border-box',
                borderTop: `1px solid ${v2.line}`,
                borderBottom:
                  i === shelf.rows.length - 1 ? `1px solid ${v2.line}` : 'none',
                padding: '15px 2px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    color: v2.ink,
                    fontWeight: 500,
                    letterSpacing: '-0.012em',
                  }}
                >
                  {row.name}
                </span>
                <ShelfBar fill={row.fill} tier={row.tier} />
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 2,
                  minWidth: 64,
                  flexShrink: 0,
                  textAlign: 'right',
                }}
              >
                <ReplenishmentBadge estimate={estimate} />
                <small
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: v2.mute,
                    letterSpacing: '0.02em',
                  }}
                >
                  {/* pantry voice: "use it" / "left" caption — preserved */}
                  {row.daysSub}
                </small>
              </div>
            </div>
          );
        })}

      {/* the fold affordance — only the stocked shelf carries one */}
      {onToggleFold && (
        <button
          type="button"
          aria-expanded={!folded}
          onClick={onToggleFold}
          style={{
            boxSizing: 'border-box',
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 2px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              transform: folded ? 'rotate(0deg)' : 'rotate(180deg)',
            }}
          >
            <IconChevronDown size={13} weight={2} stroke={v2.mute} />
          </span>
          <span
            style={{
              fontSize: 12,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            {folded
              ? `show the ${shelf.rows.length} stocked`
              : `fold the ${shelf.rows.length} stocked away`}
          </span>
        </button>
      )}
    </div>
  );
}
