/**
 * SortedToast — grocery-only routing confirmation popup.
 *
 * Replaces the generic chipFly + summary toast pair for grocery routes
 * with a single editorial confirmation. Composes the parsed
 * `GroceryRoutingResult` into one of four layouts:
 *
 *   • single — "milk · shopping"               (1 item)
 *   • short  — "milk, eggs · shopping"         (2 items, single target)
 *   • split  — "shopping: a, b · pantry: c, d" (mixed targets, the default
 *              for recipe expansions per spec open-question DEFAULT=split)
 *   • bulk   — "+6 items · shopping"           (3+ items, single target)
 *
 * DNA references (apps/web/src/design/tokens.css):
 *   item name  → `--font-editor`   (DM Serif Display, our Fraunces stand-in)
 *   category   → `--font-system`   (DM Sans, italic for kicker)
 *   surface    → `--paper`         (cream)
 *   accent rule → `--accent`       (sage, hairline left rule)
 *   action btn → `--water`         (sky, used only for the optional Undo)
 *
 * No ASCII arrows anywhere — the target separator is an inline SVG hairline.
 *
 * Auto-dismisses after `ttl` ms (default 3500, recipe-split bumps to 4500
 * so the second line has time to be read). `onUndo` is optional; when
 * present a sky-ink button surfaces inside the toast.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  GroceryRoutingResult,
  GroceryRoutedItem,
  GroceryRoutingSource,
  GroceryRoutingTarget,
} from '../hooks/useGroceryRouting';

// ─── Inline hairline arrow icon (replaces forbidden ASCII →) ──────────────────

interface HairlineArrowProps {
  size?: number;
  color?: string;
}

function HairlineArrow({ size = 12, color = 'currentColor' }: HairlineArrowProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.7 }}
    >
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14 6 20 12 14 18" />
    </svg>
  );
}

// ─── Layout selection ─────────────────────────────────────────────────────────

type Layout = 'single' | 'short' | 'split' | 'bulk';

function pickLayout(items: GroceryRoutedItem[]): Layout {
  if (items.length === 1) return 'single';
  const targets = new Set(items.map((i) => i.target));
  if (targets.size > 1) return 'split';
  if (items.length <= 2) return 'short';
  return 'bulk';
}

function groupByTarget(items: GroceryRoutedItem[]) {
  const shopping: GroceryRoutedItem[] = [];
  const pantry: GroceryRoutedItem[] = [];
  for (const it of items) {
    if (it.target === 'shopping') shopping.push(it);
    else pantry.push(it);
  }
  return { shopping, pantry };
}

// ─── Public props ─────────────────────────────────────────────────────────────

export interface SortedToastProps {
  result: GroceryRoutingResult;
  /** Optional undo handler. When present, surfaces a sky-ink "undo" button. */
  onUndo?: () => void;
  /** Auto-dismiss in ms. Default 3500 (4500 on split layouts). 0 disables. */
  ttl?: number;
  /** Called when the toast finishes its visible lifetime. */
  onDismiss?: () => void;
  /** Test/devtool: keep the toast mounted with no portal (inline). */
  inline?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SortedToast({
  result,
  onUndo,
  ttl,
  onDismiss,
  inline = false,
}: SortedToastProps) {
  const layout = pickLayout(result.items);
  const isError = !!result.error;
  const isFallback = result.source === 'fallback';

  const resolvedTtl = ttl ?? (layout === 'split' ? 4500 : 3500);
  const [visible, setVisible] = useState(true);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (resolvedTtl <= 0) return;
    const t = setTimeout(() => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      setVisible(false);
      onDismiss?.();
    }, resolvedTtl);
    return () => clearTimeout(t);
  }, [resolvedTtl, onDismiss]);

  if (!visible) return null;

  const body = (
    <div
      role="status"
      aria-live="polite"
      data-grocery-sorted-toast="true"
      data-layout={layout}
      data-source={result.source}
      data-error={isError ? 'true' : undefined}
      style={{
        position: inline ? 'relative' : 'fixed',
        bottom: inline ? undefined : 'calc(96px + env(safe-area-inset-bottom, 0px))',
        left: inline ? undefined : '50%',
        transform: inline ? undefined : 'translateX(-50%)',
        zIndex: inline ? undefined : 'var(--z-mast)' as unknown as number,

        // Cream surface, sage hairline rule on the leading edge.
        background: 'var(--paper)',
        borderLeft: '1.5px solid var(--accent)',
        borderTop: '1px solid var(--rule-soft)',
        borderRight: '1px solid var(--rule-soft)',
        borderBottom: '1px solid var(--rule-soft)',
        borderRadius: '2px', // sharp · brand
        boxShadow: 'var(--sh-md)',
        padding: '14px 18px 12px 16px',
        minWidth: '240px',
        maxWidth: 'min(440px, calc(100vw - 32px))',
        fontFamily: 'var(--font-system)',
        color: 'var(--ink)',
        animation: 'sortedToastIn var(--d-flick, 220ms) var(--e-calm-out, ease-out) both',
      }}
    >
      <SortedToastBody result={result} layout={layout} />

      {(isFallback || isError || onUndo) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginTop: '10px',
            paddingTop: '8px',
            borderTop: '1px solid var(--rule-soft)',
          }}
        >
          <SourceCaption source={result.source} error={result.error} />
          {onUndo && (
            <button
              type="button"
              onClick={() => {
                dismissedRef.current = true;
                onUndo();
                setVisible(false);
                onDismiss?.();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 8px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-meta)',
                letterSpacing: 'var(--ls-caps-small)',
                textTransform: 'uppercase',
                color: 'var(--water)',
              }}
            >
              undo
            </button>
          )}
        </div>
      )}

      {/* Inline keyframes — kept local so the toast carries its own animation
       *  contract without polluting animations.css. Honors prefers-reduced-motion
       *  via duration token (which collapses to 0ms under reduce). */}
      <style>{`
        @keyframes sortedToastIn {
          from { opacity: 0; transform: translate(-50%, 6px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );

  if (inline || typeof document === 'undefined') return body;
  return createPortal(body, document.body);
}

// ─── Body switch — picks the layout ───────────────────────────────────────────

interface SortedToastBodyProps {
  result: GroceryRoutingResult;
  layout: Layout;
}

function SortedToastBody({ result, layout }: SortedToastBodyProps) {
  const { items } = result;
  if (layout === 'single') return <SingleRow item={items[0]} />;
  if (layout === 'split') return <SplitRows items={items} />;
  if (layout === 'short') return <ShortRow items={items} />;
  return <BulkRow items={items} />;
}

// ─── Layout rows ──────────────────────────────────────────────────────────────

function ItemName({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-editor)',
        fontSize: 'var(--t-h3)',
        lineHeight: 'var(--lh-lede)',
        color: 'var(--ink)',
        letterSpacing: 'var(--ls-h2)',
      }}
    >
      {children}
    </span>
  );
}

function CategoryKicker({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-meta)',
        letterSpacing: 'var(--ls-caps-small)',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
      }}
    >
      {children}
    </span>
  );
}

function SingleRow({ item }: { item: GroceryRoutedItem }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
      <ItemName>{item.name}</ItemName>
      <HairlineArrow />
      <CategoryKicker>{item.target}</CategoryKicker>
    </div>
  );
}

function ShortRow({ items }: { items: GroceryRoutedItem[] }) {
  const target = items[0].target;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
      <ItemName>
        {items.map((it, i) => (
          <span key={i}>
            {it.name}
            {i < items.length - 1 ? ', ' : ''}
          </span>
        ))}
      </ItemName>
      <HairlineArrow />
      <CategoryKicker>{target}</CategoryKicker>
    </div>
  );
}

function BulkRow({ items }: { items: GroceryRoutedItem[] }) {
  const target = items[0].target;
  const recipeParent = items[0].recipe_parent;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <ItemName>
          {recipeParent ? recipeParent : `+${items.length} items`}
        </ItemName>
        <HairlineArrow />
        <CategoryKicker>{target}</CategoryKicker>
      </div>
      {recipeParent && (
        <div
          style={{
            marginTop: '4px',
            fontFamily: 'var(--font-system)',
            fontStyle: 'italic',
            fontSize: 'var(--t-caption)',
            color: 'var(--ink-soft)',
          }}
        >
          {items.length} items sorted
        </div>
      )}
    </div>
  );
}

function SplitRows({ items }: { items: GroceryRoutedItem[] }) {
  const { shopping, pantry } = groupByTarget(items);
  const recipeParent = items.find((it) => it.recipe_parent)?.recipe_parent;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {recipeParent && (
        <div
          style={{
            fontFamily: 'var(--font-editor)',
            fontSize: 'var(--t-h3)',
            lineHeight: 'var(--lh-lede)',
            color: 'var(--ink)',
            letterSpacing: 'var(--ls-h2)',
            marginBottom: '2px',
          }}
        >
          {recipeParent}
        </div>
      )}
      {shopping.length > 0 && (
        <SplitLine target="shopping" items={shopping} />
      )}
      {pantry.length > 0 && (
        <SplitLine target="pantry" items={pantry} />
      )}
    </div>
  );
}

function SplitLine({
  target,
  items,
}: {
  target: GroceryRoutingTarget;
  items: GroceryRoutedItem[];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-meta)',
          letterSpacing: 'var(--ls-caps-small)',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          minWidth: '64px',
        }}
      >
        {target}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-editor)',
          fontSize: 'var(--t-body)',
          lineHeight: 'var(--lh-lede)',
          color: 'var(--ink)',
        }}
      >
        {items.map((it, i) => (
          <span key={i}>
            {it.name}
            {i < items.length - 1 ? ', ' : ''}
          </span>
        ))}
      </span>
    </div>
  );
}

// ─── Source caption (cache / gemini / fallback / error) ───────────────────────

function SourceCaption({
  source,
  error,
}: {
  source: GroceryRoutingSource;
  error?: string;
}) {
  if (error) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-meta)',
          letterSpacing: 'var(--ls-caps-small)',
          textTransform: 'uppercase',
          color: 'var(--ink-soft)',
        }}
      >
        sorted locally · ai unavailable
      </span>
    );
  }
  if (source === 'fallback') {
    return (
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-meta)',
          letterSpacing: 'var(--ls-caps-small)',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        offline sort
      </span>
    );
  }
  // cache + gemini get no caption — the absence is the signal of "all good".
  return null;
}
